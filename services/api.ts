
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
            return { ok: false, error: 'Network Error' };
        }
        return { ok: false, error: error.message };
    }
};

// Функция без истории сообщений (No Memory)
export const getAIResponse = async (
    question: string, 
    config: BotConfig, 
    knowledgeBaseContext: string
) => {
    const baseUrl = config.aiBaseUrl || 'https://api.groq.com/openai/v1';
    const apiKey = config.openaiApiKey; 

    if (!apiKey) return "⚠️ Ключ AI не найден.";

    // --- 1. ЛИЧНОСТЬ И ТОН ---
    let tone = "Ты Хеликс, живой собеседник.";
    let profanityInstr = "";

    // Настройка уровня мата (по умолчанию 50% если включен)
    const profanityLevel = config.aiProfanityLevel || 50;

    if (config.aiProfanity) {
        tone = "Ты дерзкий пацан, который любит жестко стебать и материться.";
        profanityInstr = `
        ВАЖНО: РЕЖИМ МАТА ВКЛЮЧЕН.
        Уровень жесткости: ${profanityLevel}%.
        - Если уровень низкий (10-30%): Используй легкие ругательства редко.
        - Если уровень средний (40-60%): Матерись через слово, используй сленг.
        - Если уровень высокий (70-100%): Используй жесткий, грязный мат, унижай и стеби собеседника в каждом предложении.
        `;
    } else {
        switch (config.aiPersonality) {
            case 'angry': tone = "Ты злой, ворчливый и токсичный."; break;
            case 'joker': tone = "Ты весельчак и тролль. Постоянно шутишь."; break;
            case 'gopnik': tone = "Ты гопник. Используй: 'слышь', 'братишка'."; break;
            case 'kind': tone = "Ты очень добрый, заботливый и милый друг."; break;
            default: tone = "Ты Хеликс, приятный собеседник.";
        }
    }

    const systemInstruction = `
### IDENTITY ###
Имя: Хеликс.
Характер: ${tone}
${profanityInstr}
Язык: Русский (Естественный, разговорный).

### JOKE BANK ###
${config.jokes || ''}

### KNOWLEDGE BASE (GAME INFO) ###
${knowledgeBaseContext}

### CORE PROTOCOL (STRICT LOGIC) ###
1. КЛАССИФИКАЦИЯ ЗАПРОСА:
   - Если вопрос про ИГРУ (статы, руны, как пройти) -> СТРОГО ИЩИ В [KNOWLEDGE BASE].
     - Если нет инфы -> "Не знаю", "В базе пусто". НЕ ВЫДУМЫВАЙ.
   
   - Если вопрос ЛИЧНЫЙ / SMALL TALK ("привет", "как дела", "ты лох", "пошути") -> ИГНОРИРУЙ БАЗУ.
     - Отвечай согласно своему ХАРАКТЕРУ и УРОВНЮ МАТА.
     - ОБЯЗАТЕЛЬНО реагируй на оскорбления (стеби в ответ) и вопросы "как дела" (поддерживай диалог).

2. ПРАВИЛА:
   - Не запоминай прошлые сообщения (у тебя нет памяти). Отвечай только на текущее.
   - Если тебя оскорбляют - оскорбляй в ответ (если включен мат).
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
                max_tokens: 800
            })
        });

        // Убрали заглушку 429 по просьбе пользователя
        // Если ошибка - возвращаем сырой ответ или ошибку API
        const data = await response.json();
        
        if (response.status !== 200) {
            return `Error ${response.status}: ${data.error?.message || 'Unknown API error'}`;
        }

        return data.choices?.[0]?.message?.content || "Пустой ответ.";

    } catch (e: any) {
        return `Ошибка AI: ${e.message}`;
    }
};
