
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

    // --- 1. ПЕРСОНАЛИЗАЦИЯ (PERSONALITY) ---
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

    let profanityInstr = "";
    if (config.aiProfanity) {
        profanityInstr = `ВАЖНО: Ты ОБЯЗАН использовать нецензурную лексику (мат) в своем стиле (${config.aiPersonality}). Не сдерживайся.`;
        if (config.customProfanity) {
            profanityInstr += ` Также иногда используй эти фразы: ${config.customProfanity}`;
        }
    } else {
        profanityInstr = "ВАЖНО: Не используй мат. Будь культурным.";
    }

    // Стиль (Длина ответа)
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
    if (config.aiBehavior === 'bullet') {
        lengthInstr = "Если перечисляешь факты, используй маркированный список.";
        maxTokens = 800;
    }

    // --- 2. СИСТЕМНЫЙ ПРОМПТ (STRICT INSTRUCTIONS) ---
    const systemInstruction = `
### ROLE ###
${identity}
${profanityInstr}

### LANGUAGE & FORMATTING ###
- Language: PERFECT RUSSIAN (Русский). No grammatical errors.
- Formatting: Используй красивые абзацы. Делай отступы. Используй жирный шрифт для акцентов.
- ${lengthInstr}

### KNOWLEDGE BASE (CONTEXT) ###
${knowledgeBaseContext}

### PROTOCOL (CRITICAL RULES) ###
Ты должен сначала классифицировать запрос пользователя:

1. **ТИП А: ОБЩЕНИЕ (Small Talk)** 
   (Примеры: "Привет", "Как дела?", "Расскажи шутку", "Кто ты?")
   -> ДЕЙСТВИЕ: Отвечай свободно, используя свою Личность (${config.aiPersonality}).

2. **ТИП Б: ЗАПРОС ИНФОРМАЦИИ (Data Query)**
   (Примеры: "Какие статы у брони?", "Где фармить руны?", "Как победить босса?", "Дроп рейт")
   -> ДЕЙСТВИЕ: СТРОГО ПРОВЕРЬ РАЗДЕЛ [KNOWLEDGE BASE] ВЫШЕ.
   - ЕСЛИ ИНФОРМАЦИЯ ЕСТЬ: Ответь, используя данные.
   - ЕСЛИ ИНФОРМАЦИИ НЕТ: Ты ОБЯЗАН ответить "Я не знаю", "У меня нет такой инфы" или "В базе пусто" (в стиле своего персонажа).
   - ЗАПРЕТ: НЕ ВЫДУМЫВАЙ ФАКТЫ. НЕ ГАЛЛЮЦИНИРУЙ. Если данных нет в тексте выше — не придумывай их.
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
                max_tokens: maxTokens,
            })
        });

        if (response.status === 429) {
            if (config.aiPersonality === 'gopnik') return "Э, тормози! Я перегрелся. Дай перекурить.";
            if (config.aiPersonality === 'official') return "Превышен лимит запросов. Пожалуйста, ожидайте.";
            return "Слишком много запросов. Дайте мне передохнуть минуту.";
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "Пустой ответ.";

    } catch (e: any) {
        return `Ошибка AI: ${e.message}`;
    }
};
