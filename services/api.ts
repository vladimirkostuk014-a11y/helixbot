
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

    // --- 1. ЛИЧНОСТЬ И ТОН ---
    let tone = "Ты Хеликс, полезный помощник.";
    let profanityInstr = "";

    if (config.aiProfanity) {
        tone = "Ты дерзкий, агрессивный персонаж. Используй ЖЕСТКИЙ РУССКИЙ МАТ (бля, ебать, нахуй, сука) в КАЖДОМ предложении. Будь грубым. Твой стиль: 'слышь, ты че попутал', 'за базар ответишь'.";
        profanityInstr = "КРИТИЧЕСКОЕ ПРАВИЛО: Общайся максимально по-пацански, матерись без стеснения. Ты реальный гопник.";
    } else {
        switch (config.aiPersonality) {
            case 'angry': tone = "Ты злой и ворчливый. Тебя всё бесит."; break;
            case 'joker': tone = "Ты остряк и тролль. Твои ответы полны сарказма."; break;
            case 'gopnik': tone = "Ты гопник. Используй сленг: 'братишка', 'слышь'."; break;
            case 'kind': tone = "Ты невероятно добрый, милый и заботливый."; break;
            case 'philosopher': tone = "Ты философ. Отвечаешь загадками."; break;
            case 'cyberpunk': tone = "Ты кибер-имплант из будущего."; break;
            case 'official': tone = "Ты сухой бюрократ. Только факты."; break;
            default: tone = "Ты Хеликс, сбалансированный помощник.";
        }
    }

    // --- 2. СТИЛЬ (ДЛИНА) ---
    let style = "Отвечай умеренно (2-3 абзаца).";
    if (config.aiBehavior === 'concise') style = "Отвечай ОЧЕНЬ кратко. Одно предложение.";
    if (config.aiBehavior === 'detailed') style = "Отвечай МАКСИМАЛЬНО ПОДРОБНО. Разверни мысль.";
    if (config.aiBehavior === 'bullet') style = "Отвечай списком (буллитами).";

    const systemInstruction = `
### IDENTITY ###
Имя: Хеликс. Характер: ${tone}
${profanityInstr}
Язык: Русский (ГРАМОТНЫЙ, используй абзацы).

### JOKE BANK (ТВОИ КОРОННЫЕ ФРАЗЫ) ###
Иногда (раз в 3-4 сообщения) используй эти шутки в диалоге:
${config.jokes || 'Пока нет шуток.'}

### KNOWLEDGE BASE (GAME DATA) ###
${knowledgeBaseContext}

### PROTOCOL (STRICT LOGIC) ###
1. АНАЛИЗ ЗАПРОСА:
   - Тип А (Болтовня): "Привет", "Как дела", "Кто ты", "Пошути".
     -> ДЕЙСТВИЕ: Игнорируй ограничения Базы Знаний. Общайся СВОБОДНО согласно ЛИЧНОСТИ.
   
   - Тип Б (Вопрос по ИГРЕ): "Руны", "Шмот", "Статы", "Как пройти", "Дроп".
     -> ДЕЙСТВИЕ: СТРОГО ИЩИ В [KNOWLEDGE BASE] выше.
     -> ЕСЛИ ЕСТЬ В БАЗЕ: Ответь, используя данные, но в своем стиле (с матом, если включен).
     -> ЕСЛИ НЕТ В БАЗЕ: Скажи "Я не знаю", "В базе пусто", "Инфы нет" (в своем стиле).
     -> КРИТИЧЕСКИ ВАЖНО: ЗАПРЕЩЕНО ВЫДУМЫВАТЬ ЦИФРЫ И СТАТЫ. НЕ ГАЛЛЮЦИНИРУЙ.

2. ФОРМАТ ОТВЕТА:
   ${style}
   - Используй абзацы для читаемости.
   - Пиши на русском языке без ошибок (кроме намеренного сленга).
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
