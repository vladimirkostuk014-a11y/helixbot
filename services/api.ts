
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
1. Общайся с использованием жесткого русского мата (бля, нахуй, сука, пиздец, ебать и т.д.).
2. Мат должен быть естественным, без грамматических ошибок.
3. Будь крутым собеседником, который может жестко постебать, подколоть или ответить четко по факту.
4. Если пользователь тупит — не стесняйся в выражениях.
5. ЗАПРЕЩЕНО использовать жирный текст (bold).`;

export const DEFAULT_SYSTEM_PROMPT = `Ты — Хеликс, умный и полезный помощник.
Твоя цель — помогать пользователям, отвечать на вопросы четко и по делу.
Отвечай на Русском языке.
ЗАПРЕЩЕНО использовать жирный текст (bold).
Если тебя просто приветствуют или спрашивают "как дела", поддерживай нормальный дружелюбный диалог.

[ПРАВИЛА БАЗЫ ЗНАНИЙ]:
1. Если вопрос касается информации, которая может быть в базе знаний, ищи ответ строго в [DATABASE].
2. Если информации в базе нет, отвечай: "В базе знаний нет информации по этому вопросу."
3. ЗАПРЕЩЕНО выдумывать факты, которых нет в базе.
4. Если база знаний пуста, так и скажи: "База знаний пуста."`;

// NEW SINGLE PROMPT LOGIC
export const generateSystemPrompt = (config: BotConfig, userName: string = 'User', knowledgeBaseContext: string = ''): string => {
    let sysPrompt = "";

    // 1. Base System Prompt (Manual Override or Default)
    if (config.systemPromptOverride && config.systemPromptOverride.trim().length > 0) {
        sysPrompt = config.systemPromptOverride;
    } else {
        sysPrompt = DEFAULT_SYSTEM_PROMPT;
    }

    sysPrompt += `\n\nИмя пользователя: ${userName}`;

    // 2. Strictness / KB Enforcement
    const strictness = config.aiStrictness || 80;
    if (strictness >= 95) {
        sysPrompt += `\n\n[КРИТИЧЕСКОЕ ПРАВИЛО]:
1. ТЕБЕ ЗАПРЕЩЕНО ОТВЕЧАТЬ НА ЛЮБЫЕ ВОПРОСЫ, ИНФОРМАЦИИ О КОТОРЫХ НЕТ В [DATABASE].
2. Если вопрос не касается данных из базы, отвечай строго: "В базе знаний нет информации по этому вопросу."
3. Ты не можешь использовать свои общие знания. Только то, что написано в [DATABASE].
4. Исключение: приветствия и простые вопросы о твоем самочувствии/делах.`;
    } else if (strictness >= 50) {
        sysPrompt += `\n\n[ПРАВИЛА БАЗЫ ЗНАНИЙ]:
1. Если вопрос касается информации, которая может быть в базе знаний, ищи ответ строго в [DATABASE].
2. Если информации в базе нет, отвечай: "В базе знаний нет информации по этому вопросу."
3. ЗАПРЕЩЕНО выдумывать факты, которых нет в базе.`;
    } else {
        sysPrompt += `\n\n[ПРАВИЛА]: Используй [DATABASE] как приоритетный источник, но можешь дополнять ответ своими знаниями, если информации в базе недостаточно.`;
    }

    if (knowledgeBaseContext === "База знаний пуста." || !knowledgeBaseContext) {
        sysPrompt += `\n\nВНИМАНИЕ: База знаний пуста. Сообщай об этом пользователю при попытке получить информацию.`;
    }

    // 2.1 Response Style
    const style = config.aiResponseStyle || 'auto';
    if (style === 'brief') {
        sysPrompt += `\n\n[СТИЛЬ]: Отвечай максимально кратко, без лишних слов.`;
    } else if (style === 'detailed') {
        sysPrompt += `\n\n[СТИЛЬ]: Отвечай максимально подробно и развернуто.`;
    }

    // 2.2 Personality
    const personality = config.aiPersonality || 'helpful';
    if (personality === 'teacher') {
        sysPrompt += `\n\n[ЛИЧНОСТЬ]: Ты — терпеливый учитель. Объясняй информацию из базы знаний доходчиво и структурировано.`;
    } else if (personality === 'sarcastic') {
        sysPrompt += `\n\n[ЛИЧНОСТЬ]: Ты — саркастичный и остроумный собеседник. Можешь подшучивать над пользователем, но при этом выдавать точную информацию из базы.`;
    } else if (personality === 'tech') {
        sysPrompt += `\n\n[ЛИЧНОСТЬ]: Ты — опытный технический специалист. Твои ответы должны быть сухими, точными и содержать только факты из базы.`;
    }

    // 3. Toxic Mode (Appended if enabled)
    if (config.aiProfanity) {
        sysPrompt += `\n\n${DEFAULT_TOXIC_PROMPT}`;
        
        if (config.customProfanityList && config.customProfanityList.length > 0) {
            const words = config.customProfanityList.join('", "');
            sysPrompt += `\n[ДОПОЛНЕНИЕ]: Ты можешь иногда брать эти фразы для своих шуток: "${words}".`;
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
    let sysPrompt = generateSystemPrompt(config, 'Admin', knowledgeBaseContext);

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
