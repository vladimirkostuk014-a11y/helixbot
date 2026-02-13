
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
            temperature: config.aiProfanity ? 0.9 : 0.1, 
            max_tokens: 800,
        })
    });
};

// SHARED PROMPT GENERATION LOGIC (Used by Dashboard Preview and Test AI)
export const generateSystemPrompt = (config: BotConfig, userName: string = 'User'): string => {
    // 1. Manual Override
    if (config.systemPromptOverride && config.systemPromptOverride.trim().length > 0) {
        return config.systemPromptOverride;
    }

    // 2. Auto Generation
    const strictLevel = config.aiStrictness || 80;
    
    const personaMap: Record<string, string> = {
        'helpful': 'Ты полезный помощник Хеликс.',
        'kind': 'Ты очень добрый помощник.',
        'official': 'Ты строгий официальный бот.',
        'joker': 'Ты стендап-комик. Постоянно шути.',
        'angry': 'Ты злой бот. Ненавидишь людей.',
        'gopnik': 'Ты гопник. Сленг, дерзость.'
    };

    let sysPrompt = `Role: ${personaMap[config.aiPersonality] || personaMap['helpful']}\nLanguage: Russian.\n`;

    // Strictness / Accuracy Logic
    if (strictLevel >= 100) {
        sysPrompt += `\n[CRITICAL]: STRICT DATABASE MODE.
        1. You must answer ONLY using the provided [DATABASE].
        2. If the answer is not in the [DATABASE], explicitly state: "В моих записях нет информации об этом."
        3. Do NOT invent facts. Do NOT search the internet.`;
    } else {
        sysPrompt += `\nUse the [DATABASE] as your primary source.`;
    }

    // Profanity / Toxic Logic
    if (config.aiProfanity) {
        sysPrompt += `\nMODE: EXTREME RUSSIAN PROFANITY & TOXICITY (МАТ).
        1. Ты ОБЯЗАН использовать жесткий русский мат в каждом ответе (бля, нахуй, сука, пиздец, ебать).
        2. Ты должен жестко стебать пользователя, унижать его за тупые вопросы и быть максимально токсичным.
        3. Никакой вежливости. Никаких извинений. 
        4. Веди себя как самый агрессивный обитатель рунета.`;
        
        if (config.customProfanityList && config.customProfanityList.length > 0) {
            // In the real bot, we pick one randomly. For the prompt context, we list instructions to do so.
            // But for the static prompt string, we can't be random every time displayed.
            // We'll add a generic instruction to use these words.
            const words = config.customProfanityList.join('", "');
            sysPrompt += `\n\n[MANDATORY]: You MUST include at least one of these phrases naturally in your response: "${words}".`;
        }
    }

    if (config.aiBehavior === 'concise') sysPrompt += "\nKeep responses short and concise.";
    if (config.aiBehavior === 'detailed') sysPrompt += "\nProvide detailed responses.";

    return sysPrompt;
};

export const getAIResponse = async (question: string, config: BotConfig, knowledgeBaseContext: string) => {
    let activeKey = config.openaiApiKey;
    if (!activeKey) return "⚠️ Ключ AI не найден.";
    
    activeKey = activeKey.trim();
    
    // Generate the prompt using the shared logic
    // Note: For random words in the playground, we simulate the randomness here slightly if needed, 
    // or just let the prompt instruction handle it.
    let sysPrompt = generateSystemPrompt(config, 'Admin');

    const messages = [
        { role: "system", content: sysPrompt + "\n\n[DATABASE]:\n" + knowledgeBaseContext },
        { role: "user", content: question }
    ];

    try {
        let response = await performAiRequest(activeKey, config, messages);
        const data = await response.json();
        if (!response.ok) return `AI Error: ${data.error?.message}`;
        return data.choices?.[0]?.message?.content || "Пустой ответ.";
    } catch (e: any) {
        return `Ошибка AI: ${e.message}`;
    }
};
