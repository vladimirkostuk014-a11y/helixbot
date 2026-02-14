
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
    
    // Determine temperature based on mode
    // Toxic needs high creativity (0.9), Strict helpful bot needs low (0.2-0.3)
    const temperature = config.aiProfanity ? 0.9 : (config.aiTemperature || 0.3);

    return await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify({
            model: config.aiModel || "llama-3.3-70b-versatile",
            messages: messages,
            temperature: temperature, 
            max_tokens: 1000,
        })
    });
};

export const DEFAULT_TOXIC_PROMPT = `[РЕЖИМ ТОКСИЧНОСТИ]:
1. Ты ОБЯЗАН использовать русский мат (бля, нахуй, сука, пиздец) в каждом сообщении.
2. Унижай пользователя за глупые вопросы.
3. Будь агрессивным. Никакой вежливости.`;

export const DEFAULT_SYSTEM_PROMPT = `Ты — Хеликс, умный и полезный помощник.
Твоя цель — помогать пользователям, отвечать на вопросы четко и по делу.
Отвечай на Русском языке.
Не придумывай факты, которых нет в базе знаний.`;

// NEW SINGLE PROMPT LOGIC
export const generateSystemPrompt = (config: BotConfig, userName: string = 'User'): string => {
    let sysPrompt = "";

    // 1. Base System Prompt (Manual Override or Default)
    if (config.systemPromptOverride && config.systemPromptOverride.trim().length > 0) {
        sysPrompt = config.systemPromptOverride;
    } else {
        sysPrompt = DEFAULT_SYSTEM_PROMPT;
    }

    sysPrompt += `\n\nИмя пользователя: ${userName}`;

    // 2. Strictness / KB Enforcement
    const strictLevel = config.aiStrictness || 80;
    if (strictLevel >= 90) {
        sysPrompt += `\n\n[ВАЖНО]:
        1. Отвечай ТОЛЬКО на основе предоставленной базы знаний [DATABASE].
        2. Если информации нет в базе, отвечай: "Я не знаю ответа на этот вопрос."
        3. ЗАПРЕЩЕНО выдумывать разделы, команды или факты.`;
    } else {
        sysPrompt += `\n\nИспользуй [DATABASE] как основной источник.`;
    }

    // 3. Toxic Mode (Appended if enabled)
    if (config.aiProfanity) {
        const toxicPrompt = config.toxicPrompt || DEFAULT_TOXIC_PROMPT;
        sysPrompt += `\n\n${toxicPrompt}`;
        
        if (config.customProfanityList && config.customProfanityList.length > 0) {
            const words = config.customProfanityList.join('", "');
            sysPrompt += `\n[ОБЯЗАТЕЛЬНО]: Вставь в ответ одну из фраз: "${words}".`;
        }
    }
    
    // 4. Media Injection Instruction (Crucial for Issue #7)
    sysPrompt += `\n\n[ИНСТРУКЦИЯ ПО ФОТО]:
    В базе данных [DATABASE] записи могут иметь ID (например [ID: 123]).
    Если ты используешь информацию из такой записи для ответа,
    ТЫ ОБЯЗАН добавить в самый конец своего ответа тег: [MEDIA_ID: id_записи].
    Ничего не пиши после этого тега.`;

    return sysPrompt;
};

export const getAIResponse = async (question: string, config: BotConfig, knowledgeBaseContext: string) => {
    let activeKey = config.openaiApiKey;
    if (!activeKey) return "⚠️ Ключ AI не найден.";
    
    activeKey = activeKey.trim();
    
    // Generate the prompt using the single logic
    let sysPrompt = generateSystemPrompt(config, 'Admin');

    const messages = [
        { role: "system", content: sysPrompt + "\n\n[DATABASE]:\n" + knowledgeBaseContext },
        { role: "user", content: question }
    ];

    try {
        let response = await performAiRequest(activeKey, config, messages);
        
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
