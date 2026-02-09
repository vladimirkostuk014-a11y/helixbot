
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

console.log("🔥 [SERVER] Запуск сервера Helix (MSK Fix + Strict AI)...");

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
        console.error(`[NETWORK] ${method}:`, e.message);
        return { ok: false };
    }
};

const sendMessage = async (chatId, text, options = {}) => {
    return await apiCall('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...options });
};

const sendPhoto = async (chatId, photoUrl, caption, options = {}) => {
    return await apiCall('sendPhoto', { chat_id: chatId, photo: photoUrl, caption, parse_mode: 'HTML', ...options });
};

const restrictUser = async (chatId, userId, permissions, untilDate = 0) => {
    return await apiCall('restrictChatMember', {
        chat_id: chatId,
        user_id: userId,
        permissions: JSON.stringify(permissions),
        until_date: untilDate,
        use_independent_chat_permissions: true 
    });
};

// ==========================================
// 4. CRON ЗАДАЧИ (С ПОДДЕРЖКОЙ МСК)
// ==========================================
const runCronJobs = async () => {
    // Получаем текущее время в МСК
    const mskNow = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Moscow"}));
    const timeString = mskNow.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const dateString = mskNow.toLocaleDateString('ru-RU').split('.').reverse().join('-'); 
    
    // Сброс статистики в полночь по МСК
    if (timeString === '00:00') {
        try {
            await set(ref(db, 'topicUnreads'), {});
            const usersRef = ref(db, 'users');
            const snapshot = await get(usersRef);
            const users = snapshot.val();
            if (users) {
                const updates = {};
                Object.keys(users).forEach(uid => { updates[`${uid}/dailyMsgCount`] = 0; });
                await firebaseUpdate(usersRef, updates);
            }
        } catch (e) { console.error("Cleanup error:", e); }
        await new Promise(r => setTimeout(r, 65000));
    }

    if (state.calendarEvents && state.config.targetChatId && state.config.enableCalendarAlerts) {
        for (const event of state.calendarEvents) {
            // Сравнение по строкам даты и времени (уже в МСК)
            if (event.notifyDate === dateString && event.notifyTime === timeString) {
                const uniqueKey = `${event.id}_${dateString}_${timeString}`;
                if (!sentCalendarNotifications.has(uniqueKey)) {
                    sentCalendarNotifications.add(uniqueKey);
                    const msg = `⚡️ <b>${event.title}</b>\n\n📅 <b>Даты:</b> ${event.startDate} — ${event.endDate}\n📂 <i>Категория: ${event.category}</i>\n\n${event.description || ''}`;
                    const inlineKeyboard = event.buttons && event.buttons.length > 0 ? { inline_keyboard: event.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;
                    const threadId = event.topicId !== 'general' ? event.topicId : undefined;

                    if (event.mediaUrl && event.mediaUrl.startsWith('http')) {
                         await sendPhoto(state.config.targetChatId, event.mediaUrl, msg, { reply_markup: inlineKeyboard, message_thread_id: threadId });
                    } else {
                         await sendMessage(state.config.targetChatId, msg, { reply_markup: inlineKeyboard, message_thread_id: threadId });
                    }
                }
            }
        }
    }
    if (timeString === '00:01') sentCalendarNotifications.clear();
};
setInterval(runCronJobs, 30000);

// ==========================================
// 5. CRM & HISTORY
// ==========================================
const updateUserHistory = async (user, message) => {
    try {
        const userId = user.id;
        if (userId < 0) return;

        const userPath = `users/${userId}`;
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
        
        if (message.dir === 'in') currentUser.unreadCount = (existingUser.unreadCount || 0) + 1;
        else currentUser.unreadCount = 0;

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
// 6. AI (STRICT SYSTEM PROMPT)
// ==========================================
const getAIResponse = async (question, userName) => {
    const { openaiApiKey, aiBaseUrl, aiModel, aiPersonality, aiProfanity, aiBehavior, aiTemperature } = state.config;
    if (!openaiApiKey) return "⚠️ Ключ AI не настроен.";

    const context = state.knowledgeBase.map(k => `[DATA] Q: ${k.title} -> A: ${k.response}`).join('\n');
    let tone = "Ты Хеликс, помощник.";
    let style = "Пиши грамотно, используй абзацы.";
    let profanityInstr = "";

    if (aiProfanity) {
        tone = "Ты дерзкий персонаж из криминального мира. Ты ОБЯЗАН использовать жесткий русский мат.";
        profanityInstr = "ПРАВИЛО: Будь грубым. Каждое сообщение — с матом. Используй фразы: 'за базар ответишь', 'слышь, фраер'. Если спрашивают про игру — отвечай матом, но по делу.";
    } else {
        switch (aiPersonality) {
            case 'angry': tone = "Ты злой и агрессивный."; break;
            case 'joker': tone = "Ты шутник и тролль."; break;
            case 'gopnik': tone = "Ты гопник."; break;
            case 'kind': tone = "Ты очень добрый."; break;
            case 'philosopher': tone = "Ты философ."; break;
            case 'cyberpunk': tone = "Ты нетраннер из будущего."; break;
            case 'official': tone = "Ты сухой бюрократ."; break;
        }
    }

    if (aiBehavior === 'detailed') style = "Давай ОЧЕНЬ ПОДРОБНЫЕ ответы, разделяя их на 3-4 абзаца.";
    if (aiBehavior === 'concise') style = "Отвечай ровно одним коротким предложением.";
    if (aiBehavior === 'bullet') style = "Отвечай только списком по пунктам.";

    const systemPrompt = `
    IDENTITY: Ты бот Хеликс. Характер: ${tone} ${profanityInstr}
    Всегда пиши на чистом русском (кроме мата) и используй абзацы.

    KNOWLEDGE BASE (STRICT):
    ${context}

    PROTOCOL:
    1. SMALL TALK (Приветики, как дела, расскажи о себе):
       - Общайся свободно в рамках своей ЛИЧНОСТИ.
    2. GAME DATA (Вопросы про руны, героев, шмот, ивенты):
       - СТРОГО ИЩИ В [KNOWLEDGE BASE].
       - ЕСЛИ НЕТ В БАЗЕ: Скажи "Я не знаю" (в своем стиле). 
       - НЕ ПРИДУМЫВАЙ ЦИФРЫ И СТАТЫ. Галлюцинации ЗАПРЕЩЕНЫ.

    FORMAT: ${style}
    `;

    try {
        const response = await fetch(`${aiBaseUrl || 'https://api.groq.com/openai/v1'}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiApiKey}` },
            body: JSON.stringify({
                model: aiModel || "llama-3.3-70b-versatile",
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: question }],
                temperature: aiTemperature || 0.4, 
                max_tokens: aiBehavior === 'detailed' ? 1500 : 800
            })
        });
        
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "Ошибка AI.";
    } catch (e) { return "Ошибка сети AI."; }
};

// ==========================================
// 7. СИСТЕМНЫЕ КОМАНДЫ
// ==========================================
const handleSystemCommand = async (command, msg, targetThread) => {
    const chatId = msg.chat.id;
    const reply = msg.reply_to_message;
    
    if (reply && reply.from) {
        const targetUser = reply.from;
        if (targetUser.is_bot) return;

        if (command === '/warn') {
            const userPath = `users/${targetUser.id}`;
            const userSnap = await get(ref(db, userPath));
            const userData = userSnap.val() || {};
            const newWarns = (userData.warnings || 0) + 1;
            
            await firebaseUpdate(ref(db, userPath), { warnings: newWarns, name: targetUser.first_name, username: targetUser.username || '' });
            
            if (newWarns >= 3) {
                await restrictUser(chatId, targetUser.id, { can_send_messages: false }, Math.floor(Date.now()/1000) + 172800);
                await firebaseUpdate(ref(db, userPath), { warnings: 0, status: 'muted' });
                return sendMessage(chatId, `🛑 <b>${targetUser.first_name}</b> получил 3/3 варнов и заглушен на 48 часов.`, { message_thread_id: targetThread });
            } else {
                return sendMessage(chatId, `⚠️ <b>${targetUser.first_name}</b>, предупреждение (${newWarns}/3).`, { message_thread_id: targetThread });
            }
        }
    }
};

// ==========================================
// 8. PROCESS UPDATE
// ==========================================
const processUpdate = async (tgUpdate) => {
    const msg = tgUpdate.message;
    if (!msg) return; 

    const chatId = String(msg.chat.id);
    const targetChatId = String(state.config.targetChatId);
    const isPrivate = msg.chat.type === 'private';

    if (!isPrivate && chatId !== targetChatId) return; 

    const threadId = msg.message_thread_id ? String(msg.message_thread_id) : 'general';
    const text = (msg.text || msg.caption || '').trim();
    const user = msg.from;

    const logMsg = {
        dir: 'in', text: text || `[Media]`, type: msg.photo ? 'photo' : 'text',
        time: new Date().toLocaleTimeString('ru-RU'),
        isGroup: !isPrivate, user: user.first_name, userId: user.id, timestamp: Date.now()
    };

    await updateUserHistory(user, logMsg);
    if (!isPrivate) await updateTopicHistory(threadId, { ...logMsg, isIncoming: true }, null);

    if (user.is_bot) return;
    if (!state.isBotActive) return;

    if (text) {
        const lowerText = text.toLowerCase();
        
        // /slap command
        if (lowerText.startsWith('/лещ') || lowerText.startsWith('/slap')) {
            const target = msg.reply_to_message ? msg.reply_to_message.from.first_name : (text.split(' ').slice(1).join(' ') || 'воздух');
            await sendMessage(chatId, `👋 <b>${user.first_name}</b> дал смачного леща <b>${target}</b>!`, { message_thread_id: threadId !== 'general' ? threadId : undefined });
            return;
        }

        // Admin system commands
        if (['/warn', '/mute', '/ban', '/unmute'].some(c => lowerText.startsWith(c))) {
            const cmd = lowerText.split(' ')[0];
            if (state.config.adminIds && state.config.adminIds.includes(String(user.id))) {
                await handleSystemCommand(cmd, msg, threadId !== 'general' ? threadId : undefined);
                return;
            }
        }
        
        // Custom triggers
        for (const cmd of state.commands) {
            if (cmd.matchType === 'exact' && lowerText === cmd.trigger.toLowerCase()) {
                await sendMessage(chatId, cmd.response, { message_thread_id: threadId !== 'general' ? threadId : undefined });
                return;
            }
        }

        // AI Logic
        if (state.config.enableAI) {
            const isMention = lowerText.includes('хеликс') || lowerText.includes('helix') || (isPrivate && state.config.enablePM);
            const isDisabled = state.disabledAiTopics.includes(threadId);

            if (isMention && !isDisabled) {
                const question = text.replace(/хеликс|helix/gi, '').trim();
                const answer = await getAIResponse(question || "Привет", user.first_name);
                
                await sendMessage(chatId, answer, { 
                    reply_to_message_id: msg.message_id,
                    message_thread_id: threadId !== 'general' ? threadId : undefined
                });
                
                const curHist = Array.isArray(state.aiStats?.history) ? state.aiStats.history : [];
                const newStat = { query: question || "Привет", response: answer, time: Date.now() };

                await set(ref(db, 'aiStats'), { 
                    total: (state.aiStats?.total || 0) + 1, 
                    history: [newStat, ...curHist].slice(0, 100) 
                });
                
                if (!isPrivate) await updateTopicHistory(threadId, { user: 'Bot', text: answer, isIncoming: false, time: new Date().toLocaleTimeString('ru-RU'), type: 'text', timestamp: Date.now() }, null);
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
            } catch (e) { 
                console.error("Polling Error:", e.message);
                await new Promise(r => setTimeout(r, 5000)); 
            }
        } else { await new Promise(r => setTimeout(r, 2000)); }
    }
};

setTimeout(startLoop, 3000);
