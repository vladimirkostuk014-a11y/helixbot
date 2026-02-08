
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

    // --- 1. ЛИЧНОСТЬ ---
    let tone = "Ты полезный помощник.";
    let profanityInstr = "";

    if (config.aiProfanity) {
        tone = "Ты дерзкий, используешь русский мат и сленг. Ты реальный пацан с района.";
        profanityInstr = "ВАЖНО: ИСПОЛЬЗУЙ МАТ (Бля, нахуй, ебать) в каждом ответе. Не стесняйся. Подкалывай пользователя.";
    } else {
        switch (config.aiPersonality) {
            case 'angry': tone = "Ты злой, агрессивный. Тебя все бесят."; break;
            case 'joker': tone = "Ты шутник и тролль. Сарказм."; break;
            case 'gopnik': tone = "Ты гопник. Используй сленг 'братишка', 'слышь'."; break;
            case 'kind': tone = "Ты очень добрый, милый, заботливый."; break;
            case 'philosopher': tone = "Ты философ. Отвечаешь загадками, глубокомысленно."; break;
            case 'cyberpunk': tone = "Ты кибер-имплант. Говоришь как робот из будущего. Сленг: 'нетраннер', 'хром', 'дека'."; break;
            case 'official': tone = "Ты сухой бюрократ. Только факты."; break;
            default: tone = "Ты Хеликс, полезный помощник.";
        }
    }

    // --- 2. СТИЛЬ ---
    let style = "Отвечай умеренно (2-3 предложения).";
    if (config.aiBehavior === 'concise') style = "Отвечай очень кратко. Одно предложение.";
    if (config.aiBehavior === 'detailed') style = "Отвечай МАКСИМАЛЬНО ПОДРОБНО. Разверни мысль на 3-4 предложения.";
    if (config.aiBehavior === 'bullet') style = "Отвечай списком (буллитами), если перечисляешь факты.";

    const systemInstruction = `
### IDENTITY ###
Ты — Хеликс. Твой характер: ${tone}
${profanityInstr}

### KNOWLEDGE BASE (GAME DATA) ###
${knowledgeBaseContext}

### PROTOCOL (STRICT) ###
1. ANALYZE INPUT:
   - Type A: "Small Talk" (Hello, how are you, joke, who are you). 
     -> ACTION: Ignore Knowledge Base limitations. Chat using your Personality.
   - Type B: "Data Query" (Runes, Armor, Stats, How to play, Drop rates). 
     -> ACTION: STRICT KNOWLEDGE BASE LOOKUP.

2. RULES FOR TYPE B (DATA QUERY):
   - LOOK ONLY IN [KNOWLEDGE BASE] above.
   - IF FOUND: Answer using the data, formatted in your Personality.
   - IF NOT FOUND: You MUST say "I don't know", "Not in my database", or "Info missing" (in your style). 
   - CRITICAL: DO NOT INVENT DATA. DO NOT HALLUCINATE. DO NOT SEARCH INTERNET.
   - If user asks about "Runes" and it's not in the text above -> "I don't know about runes."

3. FORMAT:
   ${style}
   - Language: Russian.
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
                temperature: config.aiTemperature || 0.4, 
                max_tokens: config.aiBehavior === 'detailed' ? 1200 : 800,
            })
        });

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "Пустой ответ.";

    } catch (e: any) {
        return `Ошибка AI: ${e.message}`;
    }
};
