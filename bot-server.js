
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

console.log("🔥 [SERVER] Helix Node Started (Strict MSK + Hard AI)...");

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

// HEARTBEAT (VPS CONNECTION STATUS)
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
// 4. CRON ЗАДАЧИ (STRICT MSK TIME)
// ==========================================
const runCronJobs = async () => {
    // Получаем текущее время СТРОГО в MSK
    const mskDateString = new Date().toLocaleString("en-US", {timeZone: "Europe/Moscow"});
    const mskNow = new Date(mskDateString);
    
    // Форматируем для сравнения с базой (HH:mm и YYYY-MM-DD)
    const timeString = mskNow.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const dateString = mskNow.toLocaleDateString('ru-RU').split('.').reverse().join('-'); 
    
    // Очистка в 00:00 по МСК
    if (timeString === '00:00') {
        try {
            await set(ref(db, 'topicHistory'), {});
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
        await new Promise(r => setTimeout(r, 60000));
    }

    // Календарь
    if (state.calendarEvents && state.config.targetChatId && state.config.enableCalendarAlerts) {
        for (const event of state.calendarEvents) {
            // Сравниваем строки даты и времени
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
    // Очистка кеша уведомлений каждую минуту, чтобы не спамить
    if (timeString.endsWith('01')) sentCalendarNotifications.clear();
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
// 6. AI (FIXED LOGIC)
// ==========================================
const getAIResponse = async (question) => {
    const { openaiApiKey, aiBaseUrl, aiModel, aiPersonality, aiProfanity, aiBehavior, aiTemperature, jokes } = state.config;
    if (!openaiApiKey) return "⚠️ Ключ AI не настроен.";

    const context = state.knowledgeBase.map(k => `[DATA] Q: ${k.title} -> A: ${k.response}`).join('\n');
    let tone = "Ты Хеликс, помощник.";
    let profanity = "";

    if (aiProfanity) {
        tone = "Ты дерзкий пацан. Твоя речь на 50% состоит из жесткого русского мата (бля, ебать, нахуй). Стиль: агрессивный.";
        profanity = "ОБЯЗАТЕЛЬНО: Используй мат в каждом предложении. Никакой цензуры. Будь грубым.";
    } else {
        switch (aiPersonality) {
            case 'angry': tone = "Ты злой и ворчливый."; break;
            case 'joker': tone = "Ты остряк и тролль."; break;
            case 'kind': tone = "Ты добряк."; break;
        }
    }

    const systemPrompt = `
    IDENTITY: Ты Хеликс. Твой характер: ${tone}
    ${profanity}

    JOKE BANK (Твои фразы):
    ${jokes || 'Нет шуток.'}

    KNOWLEDGE BASE (GAME DATA ONLY):
    ${context}

    PROTOCOL:
    1. Если вопрос "Привет", "Как дела" (Small Talk) -> Отвечай свободно по Характеру (используй шутки). Игнорируй базу.
    2. Если вопрос про ИГРУ (Руны, Статы) -> СТРОГО ищи в KNOWLEDGE BASE. 
       - Если нет в базе -> Скажи "Не знаю" (в своем стиле).
       - ЗАПРЕЩЕНО ВЫДУМЫВАТЬ ЦИФРЫ.

    Язык: Русский. Используй абзацы.
    `;

    try {
        const response = await fetch(`${aiBaseUrl || 'https://api.groq.com/openai/v1'}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiApiKey}` },
            body: JSON.stringify({
                model: aiModel || "llama-3.3-70b-versatile",
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: question }],
                temperature: aiTemperature || 0.5,
                max_tokens: 800
            })
        });
        
        if (response.status === 429) return "Братишка, я устал (лимиты), приду в себя через пару минут.";
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
            
            await firebaseUpdate(ref(db, userPath), { 
                warnings: newWarns, 
                name: targetUser.first_name, 
                username: targetUser.username || '' 
            });
            
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
// 8. ОБРАБОТКА
// ==========================================
const processUpdate = async (tgUpdate) => {
    const msg = tgUpdate.message;
    if (!msg) return; 

    // FILTER CHATS
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
        isGroup: !isPrivate, user: user.first_name, userId: user.id
    };

    await updateUserHistory(user, logMsg);
    if (!isPrivate) await updateTopicHistory(threadId, { ...logMsg, isIncoming: true }, null);

    if (user.is_bot) return;
    if (!state.isBotActive) return;

    if (text) {
        const lowerText = text.toLowerCase();
        
        if (lowerText.startsWith('/лещ') || lowerText.startsWith('/slap')) {
            const target = msg.reply_to_message ? msg.reply_to_message.from.first_name : (text.split(' ').slice(1).join(' ') || 'воздух');
            const replyText = `👋 <b>${user.first_name}</b> дал смачного леща <b>${target}</b>!`;
            await sendMessage(chatId, replyText, { message_thread_id: threadId !== 'general' ? threadId : undefined });
            return;
        }

        if (['/warn', '/mute'].some(c => lowerText.startsWith(c))) {
            const cmd = lowerText.split(' ')[0];
            if (state.config.adminIds && state.config.adminIds.includes(String(user.id))) {
                await handleSystemCommand(cmd, msg, threadId !== 'general' ? threadId : undefined);
                return;
            }
        }
        
        // AI Logic
        if (state.config.enableAI) {
            const isMention = lowerText.includes('хеликс') || lowerText.includes('helix') || (isPrivate && state.config.enablePM);
            const isDisabled = state.disabledAiTopics.includes(threadId);

            if (isMention && !isDisabled) {
                const question = text.replace(/хеликс|helix/gi, '').trim();
                const answer = await getAIResponse(question || "Привет");
                
                await sendMessage(chatId, answer, { 
                    reply_to_message_id: msg.message_id,
                    message_thread_id: threadId !== 'general' ? threadId : undefined
                });
                
                const curHistRaw = state.aiStats?.history;
                const curHist = Array.isArray(curHistRaw) ? curHistRaw : [];
                const newStat = { query: question || "Привет", response: answer, time: Date.now() };

                await set(ref(db, 'aiStats'), { 
                    total: (state.aiStats?.total || 0) + 1, 
                    history: [newStat, ...curHist].slice(0, 100) 
                });
                
                if (!isPrivate) await updateTopicHistory(threadId, { user: 'Bot', text: answer, isIncoming: false, time: new Date().toLocaleTimeString('ru-RU'), type: 'text' }, null);
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
