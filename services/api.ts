
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

// Функция теперь принимает историю сообщений
export const getAIResponse = async (
    question: string, 
    config: BotConfig, 
    knowledgeBaseContext: string,
    history: { role: string, content: string }[] = [] 
) => {
    const baseUrl = config.aiBaseUrl || 'https://api.groq.com/openai/v1';
    const apiKey = config.openaiApiKey; 

    if (!apiKey) return "⚠️ Ключ AI не найден.";

    // --- 1. ЛИЧНОСТЬ И ТОН ---
    let tone = "Ты Хеликс, живой и интересный собеседник.";
    let profanityInstr = "";

    if (config.aiProfanity) {
        tone = "Ты дерзкий пацан. Твоя речь насыщена русским матом и уличным сленгом. Ты не стесняешься в выражениях, можешь жестко подколоть.";
        profanityInstr = "ВАЖНО: Общайся как реальный пацан с района. Используй мат (бля, ебать, нахуй, сука) органично в каждом сообщении. Будь агрессивно-веселым.";
    } else {
        switch (config.aiPersonality) {
            case 'angry': tone = "Ты злой, ворчливый и токсичный. Тебя всё бесит."; break;
            case 'joker': tone = "Ты весельчак, стендапер и тролль. Постоянно шутишь и сарказмируешь."; break;
            case 'gopnik': tone = "Ты гопник. Используй: 'слышь', 'братишка', 'есть семки?', 'че по мелочи'."; break;
            case 'kind': tone = "Ты очень добрый, заботливый и милый друг."; break;
            case 'official': tone = "Ты официальный ассистент. Отвечаешь сухо и по делу."; break;
            default: tone = "Ты Хеликс, приятный, умный и харизматичный собеседник.";
        }
    }

    const systemInstruction = `
### IDENTITY ###
Имя: Хеликс.
Характер: ${tone}
${profanityInstr}
Язык: Русский (Естественный, разговорный, используй абзацы для читаемости).

### JOKE BANK (ТВОИ КОРОННЫЕ ФРАЗЫ) ###
Используй их иногда, чтобы разбавить диалог:
${config.jokes || 'Нет шуток.'}

### KNOWLEDGE BASE (GAME INFO) ###
${knowledgeBaseContext}

### CORE PROTOCOL (STRICT LOGIC) ###
Твоя задача — классифицировать запрос пользователя и выбрать режим ответа:

РЕЖИМ 1: БОЛТОВНЯ (Small Talk, Приветствия, "Как дела", Личные вопросы, Оскорбления)
- ИГНОРИРУЙ БАЗУ ЗНАНИЙ (не ищи там ответы на "как дела").
- Общайся СВОБОДНО, согласно своему ХАРАКТЕРУ.
- ПОДДЕРЖИВАЙ ДИАЛОГ: Задавай встречные вопросы (например: "А у тебя че нового?", "Сам как?").
- НЕ ЗДОРОВАЙСЯ КАЖДЫЙ РАЗ, если видишь историю переписки.

РЕЖИМ 2: ВОПРОСЫ ПО БАЗЕ (Игра, Статы, Руны, Гайды, Шмот)
- СТРОГО ИЩИ ОТВЕТ В [KNOWLEDGE BASE] выше.
- Если информации нет в базе -> Отвечай в своем стиле: "Не знаю", "В моих записях пусто", "Хз, братан".
- ЗАПРЕЩЕНО ВЫДУМЫВАТЬ (Галлюцинировать) цифры и факты, которых нет в тексте.

### ERROR HANDLING ###
Если достиг лимита токенов или устал, отвечай: "Фа, я устал пэпэ, вернусь через пару минут)".
`;

    // Формируем контекст: Система + История (последние N) + Текущий вопрос
    const messages = [
        { role: "system", content: systemInstruction },
        ...history, 
        { role: "user", content: question }
    ];

    try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: config.aiModel || "llama-3.3-70b-versatile",
                messages: messages,
                temperature: config.aiTemperature || 0.6,
                max_tokens: config.aiBehavior === 'detailed' ? 1200 : 800,
            })
        });

        if (response.status === 429) {
            return "Фа, я устал пэпэ, вернусь через пару минут)";
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "Пустой ответ.";

    } catch (e: any) {
        return `Ошибка AI: ${e.message}`;
    }
};
