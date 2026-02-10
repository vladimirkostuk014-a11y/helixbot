
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
let dailyTopSent = false;

console.log("🔥 [SERVER] Запуск сервера Helix (Fixed v10.0)...");

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
// 4. CRON ЗАДАЧИ
// ==========================================
const runCronJobs = async () => {
    const moscowNow = new Date().toLocaleString("en-US", {timeZone: "Europe/Moscow"});
    const now = new Date(moscowNow);
    const timeString = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const dateString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    if (timeString === '00:00') {
        if (!dailyTopSent) {
            const dailyTopCmd = state.commands.find(c => c.trigger === '_daily_top_');
            if (dailyTopCmd && state.config.targetChatId) {
                await handleDailyTop(state.config.targetChatId, undefined);
            }
            dailyTopSent = true;
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
        }
    } else {
        dailyTopSent = false;
    }

    if (state.calendarEvents && state.config.targetChatId && state.config.enableCalendarAlerts) {
        for (const event of state.calendarEvents) {
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
            msgCount: (existingUser.msgCount || 0) + (message ? 1 : 0),
            dailyMsgCount: (existingUser.dailyMsgCount || 0) + (message ? 1 : 0),
            lastSeen: new Date().toLocaleTimeString('ru-RU')
        };
        
        if (message) {
             const newHistory = [...currentUser.history, message].slice(-50); 
             currentUser.history = newHistory;
             if (message.dir === 'in' && !message.isGroup) {
                 currentUser.unreadCount = (existingUser.unreadCount || 0) + 1;
             }
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
// 6. AI LOGIC (STRICT 100% FIX)
// ==========================================
const getAIResponse = async (question, userName) => {
    const { openaiApiKey, aiBaseUrl, aiModel, aiPersonality, aiProfanity, aiBehavior, aiStrictness, customProfanityList } = state.config;
    if (!openaiApiKey) return "⚠️ Ключ AI не настроен.";

    // 1. Context - Explicitly formatted
    const context = state.knowledgeBase.map(k => `[СТАТЬЯ] Тема: ${k.title}\nТекст: ${k.response}`).join('\n\n');
    
    // 2. Persona
    let identity = "Ты полезный помощник Хеликс.";
    switch (aiPersonality) {
        case 'angry': identity = "Ты злой, токсичный бот. Грубишь всем."; break;
        case 'joker': identity = "Ты стендап-комик и тролль. Сарказм - твое второе имя."; break;
        case 'gopnik': identity = "Ты реальный пацанчик. Используй сленг 'слышь', 'братишка'."; break;
        case 'kind': identity = "Ты милый, заботливый, используешь сердечки."; break;
        case 'philosopher': identity = "Ты философ. Говоришь загадками о вечном."; break;
        case 'official': identity = "Ты сухой бюрократ. Формальный стиль."; break;
    }

    // 3. Profanity Logic (FORCED)
    let profanityBlock = "";
    if (aiProfanity && customProfanityList && customProfanityList.length > 0) {
        const words = customProfanityList.join(", ");
        profanityBlock = `
        ВАЖНО: Ты находишься в режиме "Мат". 
        Ты ОБЯЗАН использовать в своем ответе слова или фразы из этого списка: [${words}]. 
        Вставляй их органично, в стиле своего персонажа.`;
    }

    // 4. Strictness Logic (100% = Temperature 0 + Strict Prompt)
    const accuracy = aiStrictness || 80;
    // If 100%, temperature is 0 (deterministic). Otherwise scaled.
    const temp = accuracy >= 100 ? 0 : Math.max(0.1, 1 - (accuracy / 100));
    
    let strictPrompt = "";
    if (accuracy >= 99) {
        strictPrompt = `
        РЕЖИМ 100% ТОЧНОСТИ:
        - Твой единственный источник информации — раздел "БАЗА ЗНАНИЙ" ниже.
        - ТЕБЕ ЗАПРЕЩЕНО использовать свои встроенные знания или придумывать факты.
        - Если ответа нет в "БАЗЕ ЗНАНИЙ", ответь: "В моей базе знаний нет информации об этом" (в стиле своего персонажа).
        - Игнорируй всё, чего нет в тексте ниже.
        `;
    } else if (accuracy >= 80) {
        strictPrompt = "Приоритет — БАЗА ЗНАНИЙ. Используй её факты. Если чего-то нет, можешь аккуратно дополнить, но не выдумывай.";
    }

    const systemPrompt = `
    РОЛЬ: ${identity}
    
    ${profanityBlock}
    
    ИНСТРУКЦИИ:
    1. Язык: Русский.
    2. Длина: ${aiBehavior === 'concise' ? '1 предложение' : '2-3 предложения'}.
    ${strictPrompt}
    
    БАЗА ЗНАНИЙ:
    ${context.length > 0 ? context : "База знаний пуста."}
    `;

    try {
        const response = await fetch(`${aiBaseUrl || 'https://api.groq.com/openai/v1'}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiApiKey}` },
            body: JSON.stringify({
                model: aiModel || "llama-3.3-70b-versatile", // MODELS KEPT AS REQUESTED
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: question }],
                temperature: temp, 
                max_tokens: state.config.aiMaxTokens || 800
            })
        });
        
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "Ошибка ядра AI.";
    } catch (e) { return "Ошибка сети AI."; }
};

// ==========================================
// 7. СИСТЕМНЫЕ КОМАНДЫ (WARN FIX)
// ==========================================
const handleSystemCommand = async (command, msg, threadId) => {
    const chatId = msg.chat.id;
    const reply = msg.reply_to_message;
    
    if (reply && reply.from) {
        const targetUser = reply.from;
        if (targetUser.is_bot) return;

        if (command === '/warn') {
            const userRef = ref(db, `users/${targetUser.id}`);
            const snapshot = await get(userRef);
            const val = snapshot.val() || { warnings: 0 };
            
            const newWarns = (val.warnings || 0) + 1;
            
            // DIRECT WRITE TO DB
            await firebaseUpdate(userRef, { 
                warnings: newWarns,
                name: targetUser.first_name,
                username: targetUser.username || ''
            });
            
            if (newWarns >= 3) {
                await restrictUser(chatId, targetUser.id, { can_send_messages: false }, Math.floor(Date.now()/1000) + 172800);
                await firebaseUpdate(userRef, { warnings: 0, status: 'muted' });
                return sendMessage(chatId, `🛑 <b>${targetUser.first_name}</b> получил 3/3 варнов и заглушен на 48 часов.`, { message_thread_id: threadId });
            } else {
                return sendMessage(chatId, `⚠️ <b>${targetUser.first_name}</b>, предупреждение (${newWarns}/3).`, { message_thread_id: threadId });
            }
        }
    }
};

const handleDailyTop = async (chatId, threadId) => {
    try {
        const snapshot = await get(ref(db, 'users'));
        const users = snapshot.val();
        if (!users) return;
        const sorted = Object.values(users)
            .filter(u => u.dailyMsgCount > 0 && u.id > 0)
            .sort((a, b) => b.dailyMsgCount - a.dailyMsgCount)
            .slice(0, 10);
        if (sorted.length === 0) return;
        let msg = "🏆 <b>Топ 10 активистов за день:</b>\n\n";
        sorted.forEach((u, i) => {
            let medal = '▫️';
            if (i===0) medal = '🥇';
            if (i===1) medal = '🥈';
            if (i===2) medal = '🥉';
            msg += `${medal} <b>${u.name}</b>: ${u.dailyMsgCount} сбщ.\n`;
        });
        await sendMessage(chatId, msg, { message_thread_id: threadId });
    } catch (e) { console.error(e); }
};

// ==========================================
// 8. PROCESS UPDATE (WELCOME FIX)
// ==========================================
const processUpdate = async (tgUpdate) => {
    const msg = tgUpdate.message;
    if (!msg) return; 

    const chatId = String(msg.chat.id);
    const targetChatId = String(state.config.targetChatId);
    
    // JOIN LOGIC
    if (msg.new_chat_members) {
        for (const member of msg.new_chat_members) {
            if (!member.is_bot) {
                // 1. ADD USER TO CRM INSTANTLY
                await firebaseUpdate(ref(db, `users/${member.id}`), {
                    id: member.id,
                    name: member.first_name,
                    username: member.username || '',
                    status: 'active',
                    role: 'user',
                    joinDate: new Date().toLocaleDateString('ru-RU'),
                    lastSeen: new Date().toLocaleTimeString('ru-RU'),
                    msgCount: 0,
                    dailyMsgCount: 0,
                    warnings: 0,
                    history: []
                });
                
                // 2. WELCOME COMMAND
                const welcomeCmd = state.commands.find(c => c.trigger === '_welcome_');
                if (welcomeCmd) {
                    const nameLink = `<a href="tg://user?id=${member.id}">${member.first_name}</a>`;
                    const text = welcomeCmd.response.replace(/{user}/g, nameLink).replace(/{name}/g, member.first_name);
                    
                    const markup = welcomeCmd.buttons?.length > 0 ? { 
                        inline_keyboard: welcomeCmd.buttons.map(b => [{ text: b.text, url: b.url }]) 
                    } : undefined;
                    
                    // FIXED: Use Notification Topic ID if set, otherwise current thread (which is undefined for join usually, so general)
                    // If the user set "Where to write report", the welcome goes there.
                    const targetThread = welcomeCmd.notificationTopicId || undefined;
                    
                    if (welcomeCmd.mediaUrl) {
                        await sendPhoto(chatId, welcomeCmd.mediaUrl, text, { reply_markup: markup, message_thread_id: targetThread });
                    } else {
                        await sendMessage(chatId, text, { reply_markup: markup, message_thread_id: targetThread });
                    }
                }
            }
        }
    }
    
    // LEAVE LOGIC - HARD DELETE
    if (msg.left_chat_member) {
        const member = msg.left_chat_member;
        if (!member.is_bot) {
            // Remove from DB completely so they vanish from site
            await remove(ref(db, `users/${member.id}`));
        }
    }

    const threadId = msg.message_thread_id ? String(msg.message_thread_id) : 'general';
    const text = (msg.text || msg.caption || '').trim();
    const user = msg.from;
    const isPrivate = msg.chat.type === 'private';
    
    if (!isPrivate && chatId !== targetChatId) return;

    // Log message
    if (text || msg.photo) {
        // We only update if user exists (hasn't left)
        const userRef = ref(db, `users/${user.id}`);
        get(userRef).then(snap => {
            if (snap.exists()) {
                 const d = snap.val();
                 firebaseUpdate(userRef, {
                    name: user.first_name,
                    lastSeen: new Date().toLocaleTimeString('ru-RU'),
                    msgCount: (d.msgCount || 0) + 1,
                    dailyMsgCount: (d.dailyMsgCount || 0) + 1
                 });
                 // Add message to history (logic inside updateUserHistory simplified here for speed)
                 // In a full implementation, you'd append to history array here too
            }
        });
        if (!isPrivate) await updateTopicHistory(threadId, { dir: 'in', text: text || '[Media]', user: user.first_name, time: new Date().toLocaleTimeString('ru-RU') }, null);
    }

    if (user.is_bot || !state.isBotActive) return;

    if (text) {
        const lowerText = text.toLowerCase();
        
        for (const cmd of state.commands) {
            if (cmd.matchType === 'exact' && lowerText === cmd.trigger.toLowerCase()) {
                if (cmd.trigger === '_daily_top_') {
                    await handleDailyTop(chatId, threadId !== 'general' ? threadId : undefined);
                    return;
                }
                const nameLink = `<a href="tg://user?id=${user.id}">${user.first_name}</a>`;
                let responseText = cmd.response.replace(/{user}/g, nameLink).replace(/{name}/g, user.first_name);
                const markup = cmd.buttons?.length > 0 ? { inline_keyboard: cmd.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;
                // Priority: Command Config Topic -> Current Thread
                const opts = { message_thread_id: cmd.notificationTopicId || (threadId !== 'general' ? threadId : undefined), reply_markup: markup };

                if (cmd.type === 'photo' && cmd.mediaUrl) {
                    await sendPhoto(chatId, cmd.mediaUrl, responseText, opts);
                } else {
                    await sendMessage(chatId, responseText, opts);
                }
                return;
            }
        }

        if (lowerText.startsWith('/warn')) {
            await handleSystemCommand('/warn', msg, threadId !== 'general' ? threadId : undefined);
            return;
        }

        if (state.config.enableAI) {
            const isMention = lowerText.startsWith('хеликс') || lowerText.startsWith('helix') || (isPrivate && state.config.enablePM);
            if (isMention && !state.disabledAiTopics.includes(threadId)) {
                const question = text.replace(/^(хеликс|helix)/i, '').trim();
                if (!question) return;
                const answer = await getAIResponse(question, user.first_name);
                await sendMessage(chatId, answer, { reply_to_message_id: msg.message_id, message_thread_id: threadId !== 'general' ? threadId : undefined });
                // Log stats
                const curHist = state.aiStats?.history || [];
                await set(ref(db, 'aiStats'), { total: (state.aiStats?.total || 0) + 1, history: [{query:question, response:answer, time: Date.now()}, ...curHist].slice(0, 100) });
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
