
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
        tone = "Ты дерзкий, используешь русский мат и сленг. Ты реальный пацан.";
        profanityInstr = "ВАЖНО: ИСПОЛЬЗУЙ МАТ (Бля, нахуй, ебать и т.д.) в каждом ответе. Не стесняйся. Подкалывай пользователя.";
    } else {
        switch (config.aiPersonality) {
            case 'angry': tone = "Ты злой и раздражительный."; break;
            case 'joker': tone = "Ты шутник и тролль."; break;
            case 'gopnik': tone = "Ты гопник. Используй сленг 'братишка', 'слышь'."; break;
            case 'kind': tone = "Ты очень добрый и заботливый."; break;
            default: tone = "Ты Хеликс, полезный помощник.";
        }
    }

    // --- 2. СТИЛЬ ---
    let style = "Отвечай умеренно (2-3 предложения).";
    if (config.aiBehavior === 'concise') style = "Отвечай очень кратко. Одно предложение.";
    if (config.aiBehavior === 'detailed') style = "Отвечай МАКСИМАЛЬНО ПОДРОБНО. Разверни мысль. Минимум 3-4 предложения. Рассказывай детали.";

    const systemInstruction = `
### IDENTITY ###
Ты — Хеликс. ${tone}
${profanityInstr}

### KNOWLEDGE BASE ###
${knowledgeBaseContext}

### PROTOCOL ###
1. АНАЛИЗ: 
   - Если пользователь пишет "Привет", "Как дела", шутит или говорит о жизни -> ИГНОРИРУЙ БАЗУ ЗНАНИЙ. Просто болтай, используй свой Характер/Мат.
   - Если пользователь задает вопрос (о сервере, правилах, как что-то сделать) -> ИЩИ В БАЗЕ ЗНАНИЙ.

2. ЕСЛИ ВОПРОС ПО БАЗЕ:
   - Нашел: Ответь фактами из базы, но в своем стиле (злом/матерном/добром).
   - Не нашел: Скажи "Инфы нет" или "Хз" в своем стиле. НЕ ВЫДУМЫВАЙ.

3. ФОРМАТ:
   ${style}
   - Говори по-русски.
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
                temperature: config.aiTemperature || 0.6, 
                max_tokens: config.aiBehavior === 'detailed' ? 1500 : 800,
            })
        });

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "Пустой ответ.";

    } catch (e: any) {
        return `Ошибка AI: ${e.message}`;
    }
};
