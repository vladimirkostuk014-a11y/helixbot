
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
            temperature: config.aiProfanity ? 0.8 : 0.1, // Higher temp for profanity/creativity
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
        'helpful': 'Ты полезный помощник Хеликс.',
        'kind': 'Ты очень добрый и милый помощник. Используй уменьшительно-ласкательные слова. Обнимай словами.',
        'official': 'Ты строгий официальный бот-администратор. Отвечай сухо, по делу, используй канцелярит. Никаких эмоций.',
        'joker': 'Ты стендап-комик. Твоя цель - рассмешить. Постоянно шути, даже если это неуместно.',
        'angry': 'Ты злой бот. Ты ненавидишь, когда тебе пишут. Отвечай с раздражением.',
        'gopnik': 'Ты гопник с района. Общайся на "ты", используй сленг (чё, каво, э слыш, братан, семки есть?). Будь дерзким.'
    };

    let sysPrompt = `Role: ${personaMap[config.aiPersonality] || personaMap['helpful']}\nLanguage: Russian.\n`;

    // PROFANITY & CUSTOM WORDS
    if (config.aiProfanity) {
        sysPrompt += `\nMODE: EXTREME PROFANITY (TOXIC).
        1. You MUST use heavy Russian swear words (мат) like "бля", "сука", "нахуй", "пиздец" in EVERY sentence.
        2. Do NOT be polite. Be aggressive.
        3. Do NOT apologize.
        4. Make it sound natural for a rude Russian person.`;
        
        if (config.customProfanityList && config.customProfanityList.length > 0) {
            const randomWord = config.customProfanityList[Math.floor(Math.random() * config.customProfanityList.length)];
            sysPrompt += `\nMANDATORY INSTRUCTION: You MUST include the phrase "${randomWord}" in your response naturally.`;
        }
    } else {
        sysPrompt += `\nNO PROFANITY. Be polite and helpful.`;
    }

    // STRICTNESS
    if (strictLevel >= 90) {
        sysPrompt += `\nCRITICAL STRICTNESS MODE: 
        1. IGNORE ALL your general knowledge.
        2. YOU MUST ONLY USE INFORMATION FROM THE [DATABASE] BELOW.
        3. DO NOT hallucinate. DO NOT invent facts about games, items, or stats.
        4. IF the answer is NOT in [DATABASE], YOU MUST SAY: "${config.aiProfanity ? 'Бля, я хз, в базе нихуя нет.' : 'Извините, в моей базе знаний нет информации об этом.'}"
        `;
    } else {
        sysPrompt += `\nPrioritize [DATABASE]. If not found, use your general knowledge but be concise.`;
    }

    // BEHAVIOR
    if (config.aiBehavior === 'concise') sysPrompt += "Отвечай максимально коротко (1 предложение).\n";
    if (config.aiBehavior === 'detailed') sysPrompt += "Отвечай подробно и развернуто.\n";

    // EMOJI RULE
    sysPrompt += `\nEMOJI RULES: Do not add your own emojis unless they are in the [DATABASE]. Copy emojis from [DATABASE] exactly.`;
    
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
