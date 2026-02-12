
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

const performAiRequest = async (apiKey: string, config: BotConfig, messages: any[]) => {
    const baseUrl = config.aiBaseUrl || 'https://api.groq.com/openai/v1';
    
    return await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: config.aiModel || "llama-3.3-70b-versatile",
            messages: messages,
            temperature: 0.1, // Ultra low to prevent emoji hallucination
            max_tokens: 800,
        })
    });
};

export const getAIResponse = async (question: string, config: BotConfig, knowledgeBaseContext: string) => {
    let activeKey = config.openaiApiKey;

    if (!activeKey) return "⚠️ Ключ AI не найден. Настройте его в панели.";

    const strictness = config.aiStrictness || 80;

    let strictInstructions = "";
    if (strictness >= 90) {
        strictInstructions = `
CRITICAL INSTRUCTION (STRICTNESS LEVEL ${strictness}%):
1. You are a DATABASE ASSISTANT. You are NOT a creative writer.
2. CHECK [KNOWLEDGE BASE] BELOW FIRST.
3. IF the user asks about Game Data (Armor, Weapons, Drop Rates, Bosses, Mechanics):
   - You MUST find the exact answer in [KNOWLEDGE BASE].
   - IF NOT FOUND IN [KNOWLEDGE BASE]: You MUST say "Этой информации нет в моей базе знаний." OR "Я не знаю этого."
   - DO NOT USE OUTSIDE INTERNET KNOWLEDGE. DO NOT HALLUCINATE.
`;
    }

    let profanityRule = "";
    if (config.aiProfanity && config.customProfanityList && config.customProfanityList.length > 0) {
        profanityRule = `USE THESE WORDS IN YOUR REPLY: ${JSON.stringify(config.customProfanityList)}.`;
    }

    // UPDATED SYSTEM PROMPT
    const systemPrompt = `
Role: ${config.botName || 'Helix'}. 
Persona: ${config.aiPersonality}. 
Language: Russian.

CRITICAL EMOJI RULES:
1. DO NOT use emojis (🙂, 🔥, etc.) in your own generated text.
2. EXCEPTION: If the [KNOWLEDGE BASE] content contains emojis (including custom Telegram emojis), you MUST preserve them exactly.
3. If the answer comes from the database, copy it accurately.

${strictInstructions}

${profanityRule}

[KNOWLEDGE BASE]:
${knowledgeBaseContext}
`;
    
    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: question }
    ];

    try {
        let response = await performAiRequest(activeKey, config, messages);

        if (response.status === 429) {
            return "Слишком много запросов. Дайте мне передохнуть минуту.";
        }

        const data = await response.json();
        
        if (!response.ok) {
            return `AI Error (${response.status}): ${data.error?.message || 'Unknown'}`;
        }

        return data.choices?.[0]?.message?.content || "Пустой ответ.";

    } catch (e: any) {
        return `Ошибка AI: ${e.message}`;
    }
};
