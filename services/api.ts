
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
        case 'angry': identity = "Ты злой, токсичный и агрессивный бот. Тебя все раздражают. Ты грубишь."; break;
        case 'joker': identity = "Ты стендап-комик и тролль. Ты отвечаешь с сарказмом и постоянно шутишь."; break;
        case 'gopnik': identity = "Ты реальный пацанчик с района. Ты гопник. Используешь сленг: 'слышь', 'братишка', 'в натуре'."; break;
        case 'kind': identity = "Ты очень милый, заботливый и любвеобильный помощник. Ты используешь много эмодзи сердечек."; break;
        case 'philosopher': identity = "Ты мудрый философ. Ты отвечаешь загадками и глубокими мыслями о бытие."; break;
        case 'official': identity = "Ты сухой бюрократ. Ты отвечаешь максимально формально, как в официальных документах."; break;
    }

    // --- 2. PROFANITY INJECTION (FORCED) ---
    let profanityInstr = "";
    if (config.aiProfanity) {
        const words = config.customProfanityList && config.customProfanityList.length > 0 ? config.customProfanityList.join(", ") : "бля, сука, нахуй";
        profanityInstr = `
        ВАЖНО: РЕЖИМ МАТА ВКЛЮЧЕН.
        Ты ОБЯЗАН использовать в ответе слова из этого списка: [${words}].
        Вставляй их естественно.`;
    }

    // --- 3. STRICTNESS LOGIC (100% = TEMP 0) ---
    const accuracy = config.aiStrictness || 80;
    // Temp 0 makes it deterministic (good for 100% strictness)
    const temp = accuracy >= 100 ? 0 : Math.max(0.1, 1 - (accuracy / 100));

    let strictRule = "";
    if (accuracy >= 99) {
        strictRule = `
        РЕЖИМ 100% ТОЧНОСТИ (ONLY FACTS):
        - Источник информации: ТОЛЬКО раздел [KNOWLEDGE BASE] ниже.
        - ЗАПРЕЩЕНО использовать внешние знания.
        - Если информации нет в [KNOWLEDGE BASE], ответь: "Информации нет в базе".
        `;
    } else if (accuracy >= 80) {
        strictRule = "Приоритет - База Знаний. Если чего-то нет, можешь дополнить, но аккуратно.";
    }

    let lengthInstr = "Отвечай средним объемом (2-3 предложения).";
    let maxTokens = 600;
    if (config.aiBehavior === 'concise') { lengthInstr = "Отвечай ОЧЕНЬ кратко. Максимум 1 предложение."; maxTokens = 150; }
    if (config.aiBehavior === 'detailed') { lengthInstr = "Отвечай подробно, развернуто. Используй абзацы."; maxTokens = 1500; }

    const systemInstruction = `
### ROLE ###
${identity}
${profanityInstr}
${strictRule}

### LANGUAGE & FORMATTING ###
- Language: PERFECT RUSSIAN (Русский).
- Formatting: Используй красивые абзацы.
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
                temperature: temp, 
                max_tokens: maxTokens,
            })
        });

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "Пустой ответ.";

    } catch (e: any) {
        return `Ошибка AI: ${e.message}`;
    }
};
