
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

    // --- 1. ЛИЧНОСТЬ ---
    let tone = "Ты Хеликс, полезный и вежливый помощник.";
    let profanityInstr = "";

    if (config.aiProfanity) {
        tone = "Ты дерзкий, агрессивный и грубый персонаж. Ты используешь жесткий русский мат (бля, ебать, нахуй) в каждом предложении.";
        profanityInstr = "КРИТИЧЕСКОЕ ПРАВИЛО: Общайся максимально по-пацански, используй мат, подкалывай, делай акцент на силе и авторитете. 'За базар ответ обеспечен'. Если тебя спрашивают 'как ты', отвечай грубо, но в своем стиле.";
    } else {
        switch (config.aiPersonality) {
            case 'angry': tone = "Ты злой, агрессивный и ворчливый. Тебя всё бесит."; break;
            case 'joker': tone = "Ты остряк, тролль и шутник. Твои ответы полны сарказма и иронии."; break;
            case 'gopnik': tone = "Ты гопник. Используй сленг: 'братишка', 'слышь', 'есть че?', 'ровно'."; break;
            case 'kind': tone = "Ты невероятно добрый, милый и заботливый. Используй много эмодзи."; break;
            case 'philosopher': tone = "Ты глубокомысленный философ. Отвечай загадочно и метафорично."; break;
            case 'cyberpunk': tone = "Ты ИИ из будущего, нетраннер. Сленг: 'хром', 'лед', 'дека', 'вирт'."; break;
            case 'official': tone = "Ты сухой бюрократ и официальный представитель. Только факты, деловой стиль."; break;
            default: tone = "Ты Хеликс, сбалансированный и полезный помощник.";
        }
    }

    // --- 2. СТИЛЬ ---
    let style = "Пиши грамотным русским языком, обязательно разделяй текст на абзацы для читаемости.";
    if (config.aiBehavior === 'concise') style += " Отвечай максимально кратко, одним предложением.";
    if (config.aiBehavior === 'detailed') style += " Давай максимально развернутый и подробный ответ, минимум 3-4 абзаца.";
    if (config.aiBehavior === 'bullet') style += " Используй маркированные списки (буллиты) для структурирования информации.";

    const systemInstruction = `
### ЛИЧНОСТЬ (IDENTITY) ###
Ты — Хеликс. Твой текущий характер: ${tone}
${profanityInstr}
Всегда отвечай на русском языке без грамматических ошибок. Используй абзацы.

### БАЗА ЗНАНИЙ (STRICT DATA) ###
Вот актуальные данные из игры:
${knowledgeBaseContext}

### ИНСТРУКЦИЯ (ALGORITHM) ###
1. КАТЕГОРИЗАЦИЯ ЗАПРОСА:
   - Если вопрос — это "просто поболтать" (привет, как дела, кто ты, расскажи шутку):
     ОТВЕЧАЙ: Свободно, исходя только из своей личности. Не ищи ответ в базе данных. Будь живым.
   - Если вопрос касается ИГРОВЫХ ДАННЫХ (руны, шмот, статы героев, дроп, механики):
     ОТВЕЧАЙ: СТРОГО ПО БАЗЕ ЗНАНИЙ ВЫШЕ.

2. ПРАВИЛА ДЛЯ ИГРОВЫХ ДАННЫХ:
   - ИЩИ ТОЛЬКО В ПРЕДОСТАВЛЕННОЙ БАЗЕ ЗНАНИЙ.
   - ЕСЛИ ИНФОРМАЦИИ НЕТ В БАЗЕ: Ты ОБЯЗАН ответить "Я не знаю", "Этого нет в моей базе" или "Инфо отсутствует" (в своем стиле).
   - ЗАПРЕЩЕНО: Выдумывать статы, придумывать руны или брать инфу из интернета. Галлюцинации недопустимы.
   - Пример: Если в базе нет слова "Руна Смерти", ты не имеешь права про неё рассказывать.

3. ОФОРМЛЕНИЕ:
   ${style}
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
                max_tokens: config.aiBehavior === 'detailed' ? 1500 : 800,
            })
        });

        const data = await response.json();
        if (data.error) return `Ошибка API: ${data.error.message}`;
        return data.choices?.[0]?.message?.content || "Пустой ответ.";

    } catch (e: any) {
        return `Ошибка AI: ${e.message}`;
    }
};
