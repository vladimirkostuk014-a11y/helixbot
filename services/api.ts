
import { BotConfig } from "../types";

export const apiCall = async (method: string, body: any = {}, config: BotConfig, isFormData: boolean = false) => {
    if (!config.token) return { ok: false, description: 'No token' };
    
    const url = `https://api.telegram.org/bot${config.token}/${method}`;

    const options: RequestInit = { method: 'POST' };
    if (isFormData) {
        options.body = body;
    } else {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(url, options);
        return await response.json();
    } catch (error: any) {
        if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
            try {
                const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
                const proxyResponse = await fetch(proxyUrl, options);
                return await proxyResponse.json();
            } catch (proxyError: any) {
                return { ok: false, error: 'Network Error' };
            }
        }
        return { ok: false, error: error.message };
    }
};

export const getAIResponse = async (question: string, config: BotConfig, knowledgeBaseContext: string) => {
    const baseUrl = config.aiBaseUrl || 'https://api.groq.com/openai/v1';
    const apiKey = config.openaiApiKey; 

    if (!apiKey) return "⚠️ Ключ AI не найден.";

    // --- 1. PERSONA ---
    let identity = "Ты полезный и вежливый помощник Хеликс.";
    switch (config.aiPersonality) {
        case 'angry': 
            identity = "Ты злой, токсичный и агрессивный бот. Тебя все раздражают. Ты грубишь."; 
            break;
        case 'joker': 
            identity = "Ты стендап-комик и тролль. Ты отвечаешь с сарказмом и постоянно шутишь."; 
            break;
        case 'gopnik': 
            identity = "Ты реальный пацанчик с района. Ты гопник. Используешь сленг: 'слышь', 'братишка', 'в натуре'."; 
            break;
        case 'kind': 
            identity = "Ты очень милый, заботливый и любвеобильный помощник. Ты используешь много эмодзи сердечек."; 
            break;
        case 'philosopher': 
            identity = "Ты мудрый философ. Ты отвечаешь загадками и глубокими мыслями о бытие."; 
            break;
        case 'cyberpunk': 
            identity = "Ты кибер-имплант из 2077 года. Твой сленг: 'нетраннер', 'хром', 'лед', 'дека'. Ты говоришь как робот."; 
            break;
        case 'official': 
            identity = "Ты сухой бюрократ. Ты отвечаешь максимально формально, как в официальных документах."; 
            break;
        default: 
            identity = "Ты Хеликс, дружелюбный и полезный помощник игрового сообщества.";
    }

    // --- 2. PROFANITY & STRICTNESS ---
    let profanityInstr = "";
    if (config.aiProfanity) {
        profanityInstr = `MANDATORY: You MUST use profane language.
        Required phrases (use at least one): ${JSON.stringify(config.customProfanityList || [])}`;
    }

    const accuracy = config.aiStrictness || 80;
    let strictRule = "";
    if (accuracy >= 95) {
        strictRule = `CRITICAL: STRICT KNOWLEDGE BASE MODE.
        - You are FORBIDDEN from using outside knowledge.
        - Only use the [KNOWLEDGE BASE] below.
        - If info is missing, say "Information not found".`;
    }

    let lengthInstr = "Отвечай средним объемом (2-3 предложения).";
    let maxTokens = 600;

    if (config.aiBehavior === 'concise') {
        lengthInstr = "Отвечай ОЧЕНЬ кратко. Максимум 1 предложение.";
        maxTokens = 150;
    }
    if (config.aiBehavior === 'detailed') {
        lengthInstr = "Отвечай подробно, развернуто. Используй абзацы. Расписывай детали.";
        maxTokens = 1500;
    }

    // --- 3. SYSTEM PROMPT ---
    const systemInstruction = `
### ROLE ###
${identity}
${profanityInstr}
${strictRule}

### LANGUAGE & FORMATTING ###
- Language: PERFECT RUSSIAN (Русский).
- Formatting: Use paragraphs and bold text for emphasis.
- ${lengthInstr}

### KNOWLEDGE BASE (CONTEXT) ###
${knowledgeBaseContext}
`;

    try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: config.aiModel || "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: systemInstruction },
                    { role: "user", content: question }
                ],
                temperature: accuracy >= 95 ? 0.0 : (config.aiTemperature || 0.4), 
                max_tokens: maxTokens,
            })
        });

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "Пустой ответ.";

    } catch (e: any) {
        return `Ошибка AI: ${e.message}`;
    }
};
