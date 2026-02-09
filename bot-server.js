
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, update as firebaseUpdate, get, remove } from "firebase/database";
import fetch from 'node-fetch';

// ==========================================
// 1. КОНФИГУРАЦИЯ
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyAMs9_3wy03yA1bYL4zXTAAIKBxPRWqA_E",
  authDomain: "helixbotdb.firebaseapp.com",
  databaseURL: "https://helixbotdb-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "helixbotdb",
  storageBucket: "helixbotdb.firebasestorage.app",
  messagingSenderId: "173821251695",
  appId: "1:173821251695:web:3c0fd97a79a6982df4bd9a"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let state = {
    config: {},
    users: {},
    groups: {},
    commands: [],
    knowledgeBase: [],
    topicNames: {},
    aiStats: { total: 0, history: [] },
    disabledAiTopics: [],
    calendarEvents: [],
    isBotActive: true 
};

let lastUpdateId = 0;
const processedUpdates = new Set();
const sentCalendarNotifications = new Set();

console.log("🔥 [SERVER] Helix v8.0 Started (Memory + Strict Mode + Anti-Crash)...");

// ==========================================
// 2. СИНХРОНИЗАЦИЯ С FIREBASE
// ==========================================
const sync = (path, key, isArray = false) => {
    onValue(ref(db, path), (snapshot) => {
        const val = snapshot.val();
        if (isArray) {
            state[key] = val ? Object.values(val) : [];
        } else {
            state[key] = val || (key === 'config' ? {} : {});
        }
    });
};

sync('config', 'config');
sync('users', 'users');
sync('groups', 'groups');
sync('commands', 'commands', true);
sync('knowledgeBase', 'knowledgeBase', true);
sync('topicNames', 'topicNames');
sync('aiStats', 'aiStats');
sync('disabledAiTopics', 'disabledAiTopics', true);
sync('calendarEvents', 'calendarEvents', true);

onValue(ref(db, 'status/active'), (snap) => {
    state.isBotActive = snap.val() !== false; 
});

// HEARTBEAT
setInterval(() => {
    set(ref(db, 'status/heartbeat'), Date.now()).catch(() => {});
}, 30000);

// ==========================================
// 3. API TELEGRAM
// ==========================================
const apiCall = async (method, body) => {
    if (!state.config.token) return;
    try {
        const response = await fetch(`https://api.telegram.org/bot${state.config.token}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return await response.json();
    } catch (e) {
        return { ok: false };
    }
};

const sendMessage = async (chatId, text, options = {}) => {
    return await apiCall('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...options });
};

const leaveChat = async (chatId) => {
    return await apiCall('leaveChat', { chat_id: chatId });
};

// ==========================================
// 4. CRM & HISTORY
// ==========================================
const updateUserHistory = async (user, message) => {
    try {
        const userId = user.id;
        if (userId < 0) return;

        const userPath = `users/${userId}`;
        // ВАЖНО: Читаем актуальное состояние перед записью
        const snapshot = await get(ref(db, userPath));
        const existingUser = snapshot.val() || {};

        let currentUser = {
            id: userId,
            name: user.first_name || 'Unknown',
            username: user.username || '', 
            role: state.config.adminIds?.includes(String(userId)) ? 'admin' : (existingUser.role || 'user'),
            status: existingUser.status || 'active', 
            warnings: existingUser.warnings || 0,
            history: Array.isArray(existingUser.history) ? existingUser.history : [],
            msgCount: (existingUser.msgCount || 0) + 1,
            dailyMsgCount: (existingUser.dailyMsgCount || 0) + 1,
            lastSeen: new Date().toLocaleTimeString('ru-RU')
        };

        const newHistory = [...currentUser.history, message].slice(-50); 
        currentUser.history = newHistory;
        
        // Логика Unread: Если сообщение входящее (от юзера), увеличиваем счетчик.
        // Если исходящее (от админа) - сбрасываем.
        if (message.dir === 'in') {
            currentUser.unreadCount = (existingUser.unreadCount || 0) + 1;
        } else {
            currentUser.unreadCount = 0;
        }

        await set(ref(db, userPath), currentUser);
    } catch (e) { console.error("CRM Update Error:", e); }
};

const updateTopicHistory = async (topicId, message, topicNameRaw) => {
    try {
        const tId = topicId || 'general';
        const path = `topicHistory/${tId}`;
        
        const currentName = state.topicNames[tId];
        const newName = topicNameRaw || (currentName ? currentName : `Topic ${tId}`);
        if (tId !== 'general' && (!currentName || (topicNameRaw && currentName !== topicNameRaw))) {
            await firebaseUpdate(ref(db, 'topicNames'), { [tId]: newName });
        }

        const snapshot = await get(ref(db, path));
        const currentHistory = snapshot.val() || [];
        const updatedHistory = [...(Array.isArray(currentHistory) ? currentHistory : []), message].slice(-50);
        await set(ref(db, path), updatedHistory);

        if (message.dir === 'in') {
            const unreadRef = ref(db, `topicUnreads/${tId}`);
            const unreadSnap = await get(unreadRef);
            await set(unreadRef, (unreadSnap.val() || 0) + 1);
        }
    } catch (e) { console.error("Topic Update Error:", e); }
};

// ==========================================
// 5. AI (С ПАМЯТЬЮ И ИСТОРИЕЙ)
// ==========================================
const getAIResponse = async (question, userId) => {
    const { openaiApiKey, aiBaseUrl, aiModel, aiPersonality, aiProfanity, aiTemperature, jokes } = state.config;
    if (!openaiApiKey) return "⚠️ Ключ AI не настроен.";

    // 1. Получаем историю переписки для контекста (Memory)
    let history = [];
    if (userId) {
        try {
            const userSnap = await get(ref(db, `users/${userId}/history`));
            const userHistory = userSnap.val();
            if (Array.isArray(userHistory)) {
                // Берем последние 10 сообщений, фильтруем только текст
                history = userHistory
                    .slice(-10)
                    .filter(msg => msg.type === 'text' && msg.text)
                    .map(msg => ({
                        role: msg.dir === 'in' ? 'user' : 'assistant',
                        content: msg.text
                    }));
            }
        } catch (e) {}
    }

    const context = state.knowledgeBase.map(k => `[DATA] ${k.title}: ${k.response}`).join('\n');
    let tone = "Ты Хеликс, живой собеседник.";
    let profanity = "";

    if (aiProfanity) {
        tone = "Ты дерзкий пацан. Твоя речь насыщена русским матом (бля, ебать, нахуй). Стиль: агрессивно-веселый.";
        profanity = "ОБЯЗАТЕЛЬНО: Используй мат в каждом предложении. Не стесняйся.";
    } else {
        switch (aiPersonality) {
            case 'angry': tone = "Ты злой и ворчливый."; break;
            case 'joker': tone = "Ты остряк и тролль. Постоянно шутишь."; break;
            case 'kind': tone = "Ты добряк."; break;
            case 'gopnik': tone = "Ты гопник."; break;
        }
    }

    const systemPrompt = `
    IDENTITY: Ты Хеликс. Характер: ${tone}
    ${profanity}

    JOKE BANK:
    ${jokes || ''}

    KNOWLEDGE BASE (GAME DATA):
    ${context}

    PROTOCOL (STRICT):
    1. РЕЖИМ БОЛТОВНИ (Small Talk): Если вопрос личный ("привет", "как дела", "кто ты") -> Отвечай СВОБОДНО по характеру.
       - Поддерживай диалог, задавай встречные вопросы.
       - НЕ ЗДОРОВАЙСЯ КАЖДЫЙ РАЗ, если видишь историю переписки.
    
    2. РЕЖИМ БАЗЫ (Game Questions): Если вопрос по ИГРЕ -> СТРОГО ищи в KNOWLEDGE BASE. 
       - Если нет в базе -> Скажи "Не знаю" / "В моих записях этого нет".
       - ЗАПРЕЩЕНО ВЫДУМЫВАТЬ ЦИФРЫ.

    Язык: Русский.
    `;

    try {
        const messages = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: question }
        ];

        const response = await fetch(`${aiBaseUrl || 'https://api.groq.com/openai/v1'}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiApiKey}` },
            body: JSON.stringify({
                model: aiModel || "llama-3.3-70b-versatile",
                messages: messages,
                temperature: aiTemperature || 0.6,
                max_tokens: 800
            })
        });
        
        if (response.status === 429) return "Фа, я устал пэпэ, вернусь через пару минут)";
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "Ошибка AI.";
    } catch (e) { return "Ошибка сети AI."; }
};

// ==========================================
// 6. ОБРАБОТКА ОБНОВЛЕНИЙ
// ==========================================
const processUpdate = async (tgUpdate) => {
    const msg = tgUpdate.message;
    if (!msg) return; 

    const chatId = String(msg.chat.id);
    const targetChatId = String(state.config.targetChatId);
    const isPrivate = msg.chat.type === 'private';
    const user = msg.from;
    
    // ANTI-CRASH & FILTERING: Игнорируем левые чаты
    if (!isPrivate && chatId !== targetChatId) {
        console.log(`[Security] Leaving unknown chat: ${chatId} (${msg.chat.title})`);
        await leaveChat(chatId);
        return;
    }

    if (user.is_bot) return;

    const threadId = msg.message_thread_id ? String(msg.message_thread_id) : 'general';
    const text = (msg.text || msg.caption || '').trim();

    // Логируем
    const logMsg = {
        dir: 'in', 
        text: text || `[Media]`, 
        type: msg.photo ? 'photo' : 'text',
        time: new Date().toLocaleTimeString('ru-RU'),
        isGroup: !isPrivate, 
        user: user.first_name, 
        userId: user.id
    };

    await updateUserHistory(user, logMsg);
    if (!isPrivate) await updateTopicHistory(threadId, { ...logMsg, isIncoming: true }, null);

    if (!state.isBotActive) return;

    if (text) {
        const lowerText = text.toLowerCase();
        
        // AI Logic
        if (state.config.enableAI) {
            const isMention = lowerText.includes('хеликс') || lowerText.includes('helix') || (isPrivate && state.config.enablePM);
            const isDisabled = state.disabledAiTopics.includes(threadId);

            if (isMention && !isDisabled) {
                const question = text.replace(/хеликс|helix/gi, '').trim();
                // Передаем UserID для подтягивания истории
                const answer = await getAIResponse(question || "Привет", user.id);
                
                await sendMessage(chatId, answer, { 
                    reply_to_message_id: msg.message_id,
                    message_thread_id: threadId !== 'general' ? threadId : undefined
                });
                
                // Сохраняем ответ бота в историю (чтобы бот помнил свои ответы)
                const aiMsg = { 
                    dir: 'out', 
                    text: answer, 
                    type: 'text', 
                    time: new Date().toLocaleTimeString('ru-RU'), 
                    isGroup: !isPrivate, 
                    user: 'Bot' 
                };
                await updateUserHistory(user, aiMsg);

                // Stats
                const curHistRaw = state.aiStats?.history;
                const curHist = Array.isArray(curHistRaw) ? curHistRaw : [];
                const newStat = { query: question || "Привет", response: answer, time: Date.now() };

                await set(ref(db, 'aiStats'), { 
                    total: (state.aiStats?.total || 0) + 1, 
                    history: [newStat, ...curHist].slice(0, 100) 
                });
            }
        }
    }
};

const startLoop = async () => {
    while (true) {
        if (state.config.token) {
            try {
                const updates = await apiCall('getUpdates', { offset: lastUpdateId + 1, timeout: 30 });
                if (updates && updates.ok && updates.result.length > 0) {
                    for (const u of updates.result) {
                        lastUpdateId = u.update_id;
                        if (!processedUpdates.has(u.update_id)) {
                            processedUpdates.add(u.update_id);
                            await processUpdate(u);
                        }
                    }
                    if (processedUpdates.size > 5000) processedUpdates.clear();
                }
            } catch (e) { await new Promise(r => setTimeout(r, 5000)); }
        } else { await new Promise(r => setTimeout(r, 2000)); }
    }
};

setTimeout(startLoop, 3000);
