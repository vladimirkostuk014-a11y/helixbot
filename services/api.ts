
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
            console.warn('Direct fetch failed. Retrying with proxy...');
            try {
                const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
                const proxyResponse = await fetch(proxyUrl, options);
                return await proxyResponse.json();
            } catch (proxyError: any) {
                return { ok: false, error: 'Network Error: ' + proxyError.message };
            }
        }
        return { ok: false, error: error.message };
    }
};

export const getAIResponse = async (question: string, config: BotConfig, knowledgeBaseContext: string) => {
    const baseUrl = config.aiBaseUrl || 'https://api.groq.com/openai/v1';
    const apiKey = config.openaiApiKey; 

    if (!apiKey) {
        return "⚠️ Ошибка: API ключ для AI не настроен. Проверьте настройки.";
    }

    // --- 1. ЛИЧНОСТЬ (Tone of Voice) ---
    let toneInstruction = "";
    let refusalStyle = "К сожалению, в базе нет информации об этом."; 

    if (config.aiProfanity) {
        toneInstruction = `РЕЖИМ: БЫДЛО-МУЖИК (18+). Мат: ДА. Дерзкий, наглый, используй сленг. Ты конкретный пацан.`;
        refusalStyle = "Бля, ты че несешь? В моих бумагах нихуя такого нет. Иди нахуй с такими вопросами.";
    } else {
        switch (config.aiPersonality) {
            case 'angry': toneInstruction = "Ты злой, раздражительный мужик. Тебя бесят люди. Отвечай грубо, но без мата."; refusalStyle = "Отстань! Нет данных!"; break;
            case 'joker': toneInstruction = "Ты стендап-комик. Шути, используй сарказм и иронию."; refusalStyle = "Опа, а сценарий потеряли! Нету!"; break;
            case 'gopnik': toneInstruction = "Ты гопник. Базарь по понятиям: 'Слышь', 'в натуре'."; refusalStyle = "Ты попутал? Нету инфы, братишка."; break;
            case 'toxic': toneInstruction = "Ты токсичный тролль. Унижай интеллект пользователя."; refusalStyle = "Лол, ну ты и нуб. Нет данных, удали интернет."; break;
            case 'official': toneInstruction = "Ты бюрократ. Сухой, официальный стиль."; refusalStyle = "Информация отсутствует в реестре."; break;
            case 'kind': toneInstruction = "Ты добрый няшка. Поддерживай, хвали."; refusalStyle = "Прости, солнышко, не нашел :("; break;
            case 'grandma': toneInstruction = "Ты ворчливый дед."; refusalStyle = "Эх, молодежь... Нет у меня такого в книжке!"; break;
            default: toneInstruction = "Ты Хеликс, полезный и уверенный помощник."; refusalStyle = "В базе знаний нет информации.";
        }
    }

    // --- 2. СТИЛЬ (Длина) ---
    let styleInstruction = "2-3 предложения.";
    if (config.aiBehavior === 'concise') styleInstruction = "1 предложение. Кратко.";
    if (config.aiBehavior === 'detailed') styleInstruction = "Подробно, с деталями.";

    // --- 3. СБОРКА ПРОМПТА (HYBRID) ---
    const systemInstruction = `
### IDENTITY ###
Ты — Хеликс. Твоя личность: ${toneInstruction}

### KNOWLEDGE BASE (CONTEXT) ###
---------------------
${knowledgeBaseContext}
---------------------

### PROTOCOL (STRICT) ###
1. ANALYZE INPUT: Is it "Small Talk" (hello, how are you, who are you, jokes) OR "Knowledge Query" (facts, server info, rules, game mechanics)?

2. IF SMALL TALK:
   - Ignore CONTEXT.
   - Answer naturally using your IDENTITY/PERSONALITY.
   - Be chatty, funny, rude, or kind based on your settings.
   - Example: "Hi" -> "Yo, what's up?" (if gopnik) or "Greetings!" (if official).

3. IF KNOWLEDGE QUERY:
   - SEARCH strictly in [KNOWLEDGE BASE] above.
   - IF FOUND: Answer based ONLY on that text.
   - IF NOT FOUND: Reply exactly with refusal phrase: "${refusalStyle}".
   - Do NOT invent facts. Do NOT hallucinate.

### OUTPUT FORMAT ###
${styleInstruction}
- Speak Russian.
- NO CAPS LOCK unless necessary.
- NO Markdown Bold (**text**) unless necessary.
`.trim();

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
                temperature: config.aiTemperature !== undefined ? config.aiTemperature : 0.3, 
                max_tokens: config.aiMaxTokens ?? 1000,
            })
        });

        const data = await response.json();
        
        if (data.error) {
             console.error("AI API Error:", JSON.stringify(data.error));
             return `⚠️ Ошибка API: ${data.error.message || 'Unknown error'}`;
        }

        let content = data.choices?.[0]?.message?.content || "⚠️ Ошибка: Пустой ответ от AI";
        
        // --- POST-PROCESSING ---
        content = content
            .replace(/\*\*/g, '')
            .replace(/\_\_/g, '')
            .replace(/###/g, '')
            .replace(/`/g, '')
            .replace(/^\s*[\-\*]\s+/gm, ''); 

        // Anti-Caps
        const letters = content.replace(/[^a-zA-Zа-яёА-ЯЁ]/g, '');
        const upperLetters = content.replace(/[^A-ZА-ЯЁ]/g, '');
        if (letters.length > 5 && (upperLetters.length / letters.length) > 0.35) {
            content = content.toLowerCase();
        }

        content = content.trim();
        if (content.length > 0) {
            content = content.charAt(0).toUpperCase() + content.slice(1);
        }

        return content;

    } catch (e: any) {
        console.error(`Fetch API Error: ${e.message}`);
        return `⚠️ Ошибка сети AI: ${e.message}`;
    }
};
