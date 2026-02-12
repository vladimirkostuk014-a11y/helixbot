
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
            temperature: config.aiProfanity ? 0.7 : 0.1, // Higher temp for profanity/creativity
            max_tokens: 800,
        })
    });
};

export const getAIResponse = async (question: string, config: BotConfig, knowledgeBaseContext: string) => {
    let activeKey = config.openaiApiKey;

    if (!activeKey) return "⚠️ Ключ AI не найден. Настройте его в панели.";
    
    activeKey = activeKey.trim();

    const strictLevel = config.aiStrictness || 80;

    // PERSONALITY MAP
    const personaMap: Record<string, string> = {
        'helpful': 'Ты полезный помощник Хеликс. Ты вежлив и краток.',
        'kind': 'Ты очень добрый и милый помощник. Используй уменьшительно-ласкательные слова.',
        'official': 'Ты строгий официальный бот. Отвечай сухо, по делу, канцеляритом.',
        'joker': 'Ты стендап-комик. Постоянно шути, даже если это неуместно.',
        'angry': 'Ты злой бот. Ты ненавидишь отвечать на вопросы, но отвечаешь.',
        'gopnik': 'Ты гопник с района. Общайся на ты, используй сленг (чё, каво, э слыш).'
    };

    let sysPrompt = `Role: ${personaMap[config.aiPersonality] || personaMap['helpful']}\nLanguage: Russian.\n`;

    // BEHAVIOR
    if (config.aiBehavior === 'concise') sysPrompt += "Отвечай максимально коротко (1 предложение).\n";
    if (config.aiBehavior === 'detailed') sysPrompt += "Отвечай подробно и развернуто.\n";

    // STRICTNESS
    if (strictLevel >= 90) {
        sysPrompt += `\nCRITICAL STRICTNESS MODE: 
        1. YOU MUST ONLY USE INFORMATION FROM THE [DATABASE] BELOW.
        2. DO NOT use your own internet knowledge about games, items, or stats.
        3. IF the answer is not in [DATABASE], YOU MUST SAY: "Извините, в моей базе знаний нет информации об этом."
        4. NEVER HALLUCINATE OR INVENT FACTS.`;
    } else {
        sysPrompt += `\nPrioritize [DATABASE]. If not found, use your general knowledge but be concise.`;
    }

    // PROFANITY & CUSTOM WORDS
    if (config.aiProfanity) {
        sysPrompt += `\nMODE: UNFILTERED/PROFANITY.
        1. You are rude and toxic.
        2. Use heavy Russian swear words (мат) naturally.
        3. Do not apologize.`;
        
        if (config.customProfanityList && config.customProfanityList.length > 0) {
            const randomWord = config.customProfanityList[Math.floor(Math.random() * config.customProfanityList.length)];
            sysPrompt += `\nINSTRUCTION: Try to fit the phrase "${randomWord}" naturally into your response.`;
        }
    } else {
        sysPrompt += `\nNO PROFANITY. BE POLITE.`;
    }

    // EMOJI RULE
    sysPrompt += `\nEMOJI RULES: Do not add your own emojis. Only copy emojis if they are in the [DATABASE].`;
    
    const messages = [
        { role: "system", content: sysPrompt + "\n\n[DATABASE]:\n" + knowledgeBaseContext },
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
