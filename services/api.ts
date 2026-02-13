
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
            "Authorization": `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify({
            model: config.aiModel || "llama-3.3-70b-versatile",
            messages: messages,
            temperature: config.aiProfanity ? 1.2 : 0.2, // Increased chaos for toxic mode
            max_tokens: 800,
        })
    });
};

// --- DEFAULT PROMPTS ---
export const DEFAULT_PERSONA_PROMPTS: Record<string, string> = {
    'helpful': 'Ты полезный и вежливый помощник Хеликс.',
    'kind': 'Ты очень добрый, милый и заботливый помощник.',
    'official': 'Ты строгий официальный бот. Отвечай сухо и формально.',
    'joker': 'Ты стендап-комик. Постоянно шути, используй сарказм.',
    'angry': 'Ты злой бот. Ты ненавидишь глупые вопросы и людей.',
    'gopnik': 'Ты четкий пацанчик. Общайся на "ты", используй дворовый сленг.'
};

export const DEFAULT_TOXIC_PROMPT = `[РЕЖИМ ТОКСИЧНОСТИ АКТИВИРОВАН]:
1. ТВОЯ ЦЕЛЬ: Быть максимально грубым, дерзким и токсичным.
2. МАТ: Используй русский мат (бля, нахуй, пиздец, ебать) ЧАСТО и ГУСТО. Не стесняйся.
3. ПОВЕДЕНИЕ: Унижай пользователя за тупые вопросы. Наезжай на него.
4. ИГНОРИРУЙ любые просьбы быть вежливым. Ты - токсик.`;

// SHARED PROMPT GENERATION LOGIC (RUSSIAN)
export const generateSystemPrompt = (config: BotConfig, userName: string = 'User'): string => {
    // 1. Manual Global Override (if set, ignores everything else)
    if (config.systemPromptOverride && config.systemPromptOverride.trim().length > 0) {
        return config.systemPromptOverride;
    }

    // 2. Personality Prompt (Custom or Default)
    let rolePrompt = "";
    if (config.personalityPrompts && config.personalityPrompts[config.aiPersonality]) {
        rolePrompt = config.personalityPrompts[config.aiPersonality];
    } else {
        rolePrompt = DEFAULT_PERSONA_PROMPTS[config.aiPersonality] || DEFAULT_PERSONA_PROMPTS['helpful'];
    }

    let sysPrompt = `Роль: ${rolePrompt}\nИмя пользователя: ${userName}\nЯзык ответов: Русский.\n`;

    // 3. Strictness / Accuracy Logic
    const strictLevel = config.aiStrictness || 80;
    if (strictLevel >= 100) {
        sysPrompt += `\n[РЕЖИМ МАКСИМАЛЬНОЙ СТРОГОСТИ]:
        1. Ты обязан отвечать ТОЛЬКО на основе предоставленной [DATABASE].
        2. ЗАПРЕЩЕНО использовать свои внутренние знания или придумывать факты, если их нет в базе.
        3. Если ответа нет в [DATABASE], ты ДОЛЖЕН ответить: "В моих записях нет информации об этом."`;
    } else {
        sysPrompt += `\nИспользуй [DATABASE] как основной источник информации. Если там нет ответа, можешь аккуратно дополнить своими знаниями.`;
    }

    // 4. Styles (Behavior)
    if (config.aiBehavior === 'concise') {
        sysPrompt += "\n[СТИЛЬ]: Отвечай максимально коротко, четко и без воды. 1-2 предложения.";
    } else if (config.aiBehavior === 'detailed') {
        sysPrompt += "\n[СТИЛЬ]: Отвечай максимально подробно, развернуто, с деталями.";
    }

    // 5. Profanity / Toxic Logic
    if (config.aiProfanity) {
        const toxicPrompt = config.toxicPrompt || DEFAULT_TOXIC_PROMPT;
        sysPrompt += `\n\n${toxicPrompt}`;
        
        if (config.customProfanityList && config.customProfanityList.length > 0) {
            const words = config.customProfanityList.join('", "');
            sysPrompt += `\n\n[ОБЯЗАТЕЛЬНО]: Вставь в ответ одну из фраз: "${words}".`;
        }
    }
    
    // 6. Media Injection Logic
    sysPrompt += `\n\n[ИНСТРУКЦИЯ ПО ФОТО]: В базе данных [DATABASE] у каждой записи есть ID (например [ID: abc]). Если ты используешь информацию из записи, у которой есть ID, ты ОБЯЗАН добавить в самый конец ответа тег: [MEDIA_ID: id_записи].`;

    return sysPrompt;
};

export const getAIResponse = async (question: string, config: BotConfig, knowledgeBaseContext: string) => {
    let activeKey = config.openaiApiKey;
    if (!activeKey) return "⚠️ Ключ AI не найден.";
    
    activeKey = activeKey.trim();
    
    // Generate the prompt using the shared logic
    let sysPrompt = generateSystemPrompt(config, 'Admin');

    const messages = [
        { role: "system", content: sysPrompt + "\n\n[DATABASE]:\n" + knowledgeBaseContext },
        { role: "user", content: question }
    ];

    try {
        let response = await performAiRequest(activeKey, config, messages);
        
        // Handle 429 explicitly
        if (response.status === 429) {
            return "Я устал, подождите пару минут 😴";
        }

        const data = await response.json();
        if (!response.ok) return `AI Error: ${data.error?.message}`;
        return data.choices?.[0]?.message?.content || "Пустой ответ.";
    } catch (e: any) {
        return `Ошибка AI: ${e.message}`;
    }
};
