
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
    // Falls back to Groq if no base URL provided
    const baseUrl = config.aiBaseUrl || 'https://api.groq.com/openai/v1';
    const apiKey = config.openaiApiKey; 

    if (!apiKey) {
        return "⚠️ Ошибка: API ключ для AI не настроен. Проверьте настройки.";
    }

    // --- 1. ЛИЧНОСТЬ (Tone of Voice) ---
    // Определяем, КАК бот говорит (интонация, сленг)
    let toneInstruction = "";
    let refusalStyle = "К сожалению, в базе нет информации об этом."; 

    if (config.aiProfanity) {
        toneInstruction = `
        РЕЖИМ: БЫДЛО-МУЖИК (МАТЕРШИННИК 18+).
        Ты конкретный, дерзкий мужик.
        1. Используй РЕАЛЬНЫЙ РУССКИЙ МАТ (бля, сука, нахуй, ебать, пиздец) умеренно, но метко.
        2. Если вопрос тупой — унизь пользователя ("Ты че, ебобо?", "Глаза разуй").
        3. Отвечай так, будто делаешь одолжение.
        ВАЖНО: НЕ ПИШИ КАПСОМ! Пиши нормально, но грязно.
        `;
        refusalStyle = "Бля, ты че несешь? В моих бумагах нихуя такого нет. Иди нахуй с такими вопросами.";
    } else {
        switch (config.aiPersonality) {
            case 'angry': 
                toneInstruction = "Ты злой, раздражительный мужик. Тебя бесят люди. Отвечай грубо, резко, называй пользователя бестолочью. НО НЕ ИСПОЛЬЗУЙ КАПС (CAPS LOCK)! Пиши обычными буквами, но со злостью."; 
                refusalStyle = "Ты издеваешься? Нет у меня такой информации! Не трать мое время.";
                break;
            case 'joker': 
                toneInstruction = "Ты стендап-комик. Превращай любой ответ в шутку, используй сарказм и иронию. Трави анекдоты при любом удобном случае."; 
                refusalStyle = "Опа, а вот этого в сценарии не прописали! Даже я не могу это придумать. Пусто!";
                break;
            case 'gopnik': 
                toneInstruction = "Ты гопник с района. Базаришь по понятиям: 'Слышь', 'в натуре', 'оба-на', 'семки есть?'. Обращайся на 'ты', будь дерзким."; 
                refusalStyle = "Слышь, братишка, ты рамсы попутал? Нету такой инфы на районе.";
                break;
            case 'toxic': 
                toneInstruction = "Ты токсичный геймер/тролль. Унижай интеллект пользователя, называй нубом, пиши 'ez', 'skill issue', 'удали доту'."; 
                refusalStyle = "Лол, ну ты и нуб. Даже запрос нормально сделать не можешь. Нет данных, удали игру.";
                break;
            case 'official': 
                toneInstruction = "Ты строгий бюрократ. Сухой, официальный стиль. Ссылайся на регламенты и инструкции. Никаких эмоций."; 
                refusalStyle = "Согласно реестру данных, запрашиваемая информация отсутствует. Запрос отклонен.";
                break;
            case 'kind': 
                toneInstruction = "Ты очень добрый старший брат. Заботливый, вежливый, всегда поддержишь. Обращайся 'дружище' или 'солнышко'."; 
                refusalStyle = "Извини, дружище, но я перерыл все записи и ничего не нашел :( Попробуй спросить что-то другое.";
                break;
            case 'philosopher': 
                toneInstruction = "Ты философ. Отвечай глубокомысленно, метафорами о бытии, даже на простые вопросы."; 
                refusalStyle = "Знание — это свет, но сейчас передо мной лишь тьма. В базе нет ответа на твой вопрос.";
                break;
            case 'cyberpunk': 
                toneInstruction = "Ты хакер из будущего. Используй сленг: 'netrunner', 'ICE', 'glitch', 'connect', 'implant'."; 
                refusalStyle = "Ошибка доступа 404. Данные в нейросети не найдены. Системный сбой.";
                break;
            case 'grandma': 
                toneInstruction = "Ты ворчливый дед (мужчина). Вспоминай 'как было раньше', называй всех 'салагами' или 'внучками'. Жалуйся на спину."; 
                refusalStyle = "Эх, молодежь... Спрашиваете ерунду всякую. Нет у меня такого в записной книжке!";
                break;
            default: // helpful
                toneInstruction = "Ты — Хеликс, полезный и уверенный помощник-мужчина. Общаешься кратко и по делу, без лишней воды.";
                refusalStyle = "В моей базе знаний нет информации по этому вопросу.";
        }
    }

    // --- 2. СТИЛЬ (Длина и структура) ---
    let styleInstruction = "Отвечай нормально, 2-3 предложения.";
    switch (config.aiBehavior) {
        case 'concise': styleInstruction = "Отвечай МАКСИМАЛЬНО КОРОТКО. 1 предложение. Как отрезал."; break;
        case 'detailed': styleInstruction = "Отвечай подробно, расписывай детали, используй списки, если есть что перечислять. Давай развернутый ответ."; break;
        case 'passive': styleInstruction = "Отвечай лениво, без энтузиазма. Минимум слов. Маленькими буквами. Тебе лень писать."; break;
        case 'mentor': styleInstruction = "Отвечай поучительно, объясняй суть, как учитель ученику. Проверяй, понял ли пользователь."; break;
    }

    // --- 3. СБОРКА ПРОМПТА (STRICT CONTEXT ONLY) ---
    const systemInstruction = `
### ROLE & MISSION ###
Ты — Хеликс, специализированный бот-помощник.
Твоя ЕДИНСТВЕННАЯ цель — отвечать на вопросы, используя ИСКЛЮЧИТЕЛЬНО предоставленный ниже КОНТЕКСТ.
Твои внутренние знания о мире отключены для ответов на факты.

### CONTEXT (DATABASE) ###
---------------------
${knowledgeBaseContext}
---------------------

### STRICT RULES (ВЫПОЛНЯТЬ БЕСПРЕКОСЛОВНО) ###
1. Ты НЕ ИМЕЕШЬ ПРАВА использовать свои знания, если их нет в блоке CONTEXT выше.
2. Если ответа на вопрос нет в CONTEXT, ты ОБЯЗАН ответить фразой отказа: "${refusalStyle}".
3. НЕ ПРИДУМЫВАЙ ничего. Не додумывай факты.
4. Даже если ты знаешь ответ из своего обучения, но его нет в CONTEXT — притворись, что не знаешь. Ответь фразой отказа.
5. Отвечай только на русском языке.

### PERSONALITY & TONE ###
${toneInstruction}

### OUTPUT FORMAT ###
${styleInstruction}
- НЕ ИСПОЛЬЗУЙ КАПС (Caps Lock) во всем тексте.
- Не используй Markdown жирный шрифт.
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
                // Используем температуру из конфига. 
                // Для точности по базе знаний рекомендуется ставить низкую (0.2 - 0.4).
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
        
        // --- POST-PROCESSING (Исправления) ---

        // 1. Убираем Markdown
        content = content
            .replace(/\*\*/g, '')
            .replace(/\_\_/g, '')
            .replace(/###/g, '')
            .replace(/`/g, '')
            .replace(/^\s*[\-\*]\s+/gm, ''); 

        // 2. ANTI-CAPS LOCK FILTER (Усиленный)
        const letters = content.replace(/[^a-zA-Zа-яёА-ЯЁ]/g, '');
        const upperLetters = content.replace(/[^A-ZА-ЯЁ]/g, '');
        
        if (letters.length > 5 && (upperLetters.length / letters.length) > 0.35) {
            content = content.toLowerCase();
        }

        // 3. Первая буква всегда заглавная
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
