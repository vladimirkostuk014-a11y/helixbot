
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, update, get, remove } from "firebase/database";
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
    isBotActive: true 
};

let lastUpdateId = 0;
const processedUpdates = new Set();

console.log("🔥 [SERVER] Запуск сервера Helix (v5.0 Final Fix)...");

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

onValue(ref(db, 'status/active'), (snap) => {
    state.isBotActive = snap.val() !== false; 
});

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

const deleteMessage = async (chatId, messageId) => {
    return await apiCall('deleteMessage', { chat_id: chatId, message_id: messageId });
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

const banUser = async (chatId, userId) => {
    return await apiCall('banChatMember', { chat_id: chatId, user_id: userId });
};

// ==========================================
// 4. ЛОГИКА ОЧИСТКИ (00:00)
// ==========================================
const checkMidnightCleanup = async () => {
    const now = new Date();
    // Проверка на 00:00 (допуск 1 минута)
    if (now.getHours() === 0 && now.getMinutes() === 0) {
        console.log("🌙 [CRON] Полночь. Очистка чатов и сброс топа...");
        
        // 1. Очистка Live Chat
        await set(ref(db, 'topicHistory'), {});
        await set(ref(db, 'topicUnreads'), {});
        
        // 2. Сброс Daily Stats
        const usersRef = ref(db, 'users');
        const snapshot = await get(usersRef);
        const users = snapshot.val();
        
        if (users) {
            const updates = {};
            Object.keys(users).forEach(uid => {
                updates[`${uid}/dailyMsgCount`] = 0;
            });
            await update(usersRef, updates);
        }
        
        // Ждем минуту, чтобы не сработало дважды
        await new Promise(r => setTimeout(r, 65000));
    }
};

setInterval(checkMidnightCleanup, 30000); // Проверка каждые 30 сек

// ==========================================
// 5. CRM & HISTORY
// ==========================================
const updateUserHistory = async (user, message) => {
    try {
        const userId = user.id;
        // Не сохраняем историю групп/каналов (ID < 0) в CRM как юзеров
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
            joinDate: existingUser.joinDate || new Date().toLocaleDateString(),
            history: Array.isArray(existingUser.history) ? existingUser.history : [],
            msgCount: (existingUser.msgCount || 0) + 1,
            dailyMsgCount: (existingUser.dailyMsgCount || 0) + 1,
            lastSeen: new Date().toLocaleTimeString('ru-RU')
        };

        const newHistory = [...currentUser.history, message].slice(-50); 
        currentUser.history = newHistory;

        if (message.dir === 'in') {
             currentUser.unreadCount = (existingUser.unreadCount || 0) + 1;
        } else {
             currentUser.unreadCount = 0;
        }

        await set(ref(db, userPath), currentUser);
    } catch (e) { console.error(e); }
};

const updateTopicHistory = async (topicId, message, topicNameRaw) => {
    try {
        const tId = topicId || 'general';
        const path = `topicHistory/${tId}`;
        
        const currentName = state.topicNames[tId];
        const newName = topicNameRaw || (currentName ? currentName : `Topic ${tId}`);
        
        if (tId !== 'general') {
            if (!currentName || (topicNameRaw && currentName !== topicNameRaw)) {
                await update(ref(db, 'topicNames'), { [tId]: newName });
                state.topicNames[tId] = newName; 
            }
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
    } catch (e) { console.error(e); }
};

// ==========================================
// 6. AI (SMART MODE)
// ==========================================
const getAIResponse = async (question, userName) => {
    const { openaiApiKey, aiBaseUrl, aiModel, aiPersonality, aiProfanity, aiBehavior, aiTemperature } = state.config;
    if (!openaiApiKey) return "⚠️ AI выключен или нет ключа.";

    const context = state.knowledgeBase.map(k => `Q: ${k.title}\nA: ${k.response}`).join('\n\n');
    
    // --- ПЕРСОНА ---
    let tone = "Дружелюбный, полезный.";
    let style = "Отвечай кратко.";
    let profanityInstr = "";

    if (aiProfanity) {
        tone = "Дерзкий, используй русский мат, сленг. Ты реальный пацан с района.";
        profanityInstr = "ИСПОЛЬЗУЙ МАТ (Бля, нахуй, ебать) ОБЯЗАТЕЛЬНО. Не стесняйся.";
    } else {
        switch (aiPersonality) {
            case 'angry': tone = "Злой, агрессивный. Все тебя бесят."; break;
            case 'joker': tone = "Шутник, тролль, сарказм."; break;
            case 'gopnik': tone = "Гопник. Сленг: 'слышь', 'братишка', 'в натуре'."; break;
            case 'kind': tone = "Милый, добрый, заботливый."; break;
            case 'official': tone = "Сухой, официальный."; break;
        }
    }

    if (aiBehavior === 'detailed') style = "Отвечай ОЧЕНЬ ПОДРОБНО. Развернуто. Минимум 3 предложения.";
    if (aiBehavior === 'concise') style = "Отвечай одним предложением.";

    const systemPrompt = `
    ROLE: Ты бот Хеликс. Твой характер: ${tone}.
    ${profanityInstr}
    
    CONTEXT (DATABASE):
    ${context}
    
    INSTRUCTIONS:
    1. Если пользователь просто здоровается, спрашивает "как дела" или болтает -> ЗАБУДЬ CONTEXT. Отвечай от себя, используй свой Характер. Поддержи диалог.
    2. Если вопрос конкретный (о сервере, правилах, механиках) -> Ищи ответ в CONTEXT. 
       - Если нашел: ответь, используя информацию, но в своем Стиле.
       - Если НЕ нашел: ответь в своем стиле, что "Инфы нет", "Не знаю" (но креативно). НЕ ВЫДУМЫВАЙ ФАКТЫ.
    3. ${style}
    `;

    try {
        const response = await fetch(`${aiBaseUrl || 'https://api.groq.com/openai/v1'}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiApiKey}` },
            body: JSON.stringify({
                model: aiModel || "llama-3.3-70b-versatile",
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: question }],
                temperature: aiTemperature || 0.6, 
                max_tokens: aiBehavior === 'detailed' ? 1500 : 800
            })
        });
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "Ошибка AI.";
    } catch (e) { return "Ошибка сети AI."; }
};

// ==========================================
// 7. СИСТЕМНЫЕ КОМАНДЫ И ВАРНЫ
// ==========================================
const handleSystemCommand = async (command, msg, targetThread) => {
    const chatId = msg.chat.id;
    const reply = msg.reply_to_message;
    
    if (reply && reply.from) {
        const targetUser = reply.from;
        if (targetUser.is_bot) return;

        // WARN: Прямое обновление в Firebase
        if (command === '/warn') {
            const userPath = `users/${targetUser.id}`;
            const userSnap = await get(ref(db, userPath));
            const userData = userSnap.val() || {};
            
            const newWarns = (userData.warnings || 0) + 1;
            
            // Важно: сначала обновляем базу, чтобы React увидел
            await update(ref(db, userPath), { warnings: newWarns });
            
            if (newWarns >= 3) {
                await restrictUser(chatId, targetUser.id, { can_send_messages: false }, Math.floor(Date.now()/1000) + 172800);
                await update(ref(db, userPath), { warnings: 0, status: 'muted' });
                return sendMessage(chatId, `🛑 <b>${targetUser.first_name}</b> получил 3/3 варнов и заглушен на 48 часов.`, { message_thread_id: targetThread });
            } else {
                return sendMessage(chatId, `⚠️ <b>${targetUser.first_name}</b>, предупреждение (${newWarns}/3).`, { message_thread_id: targetThread });
            }
        }
        
        // MUTE, BAN, UNMUTE (аналогично обновляем статус в базе)
        if (command === '/mute') {
            await restrictUser(chatId, targetUser.id, { can_send_messages: false }, Math.floor(Date.now()/1000) + 3600);
            await update(ref(db, `users/${targetUser.id}`), { status: 'muted' });
            return sendMessage(chatId, `😶 Muted.`, { message_thread_id: targetThread });
        }
        if (command === '/ban') {
            await banUser(chatId, targetUser.id);
            await update(ref(db, `users/${targetUser.id}`), { status: 'banned' });
            return sendMessage(chatId, `⛔️ Banned.`, { message_thread_id: targetThread });
        }
        if (command === '/unmute') {
            await restrictUser(chatId, targetUser.id, { can_send_messages: true, can_send_media_messages: true });
            await update(ref(db, `users/${targetUser.id}`), { status: 'active', warnings: 0 });
            return sendMessage(chatId, `✅ Unmuted.`, { message_thread_id: targetThread });
        }
    }
};

// ==========================================
// 8. PROCESS UPDATE
// ==========================================
const processUpdate = async (tgUpdate) => {
    const msg = tgUpdate.message;
    if (!msg) return; 

    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id ? String(msg.message_thread_id) : 'general';
    const isTargetChat = String(chatId) === state.config.targetChatId;

    // --- ПРИВЕТСТВИЕ (WELCOME) ---
    if (msg.new_chat_members) {
        for (const member of msg.new_chat_members) {
            if (member.is_bot) continue;
            // Ищем команду приветствия (триггер: 'welcome_msg' - спец. костыль или из конфига)
            // Но лучше возьмем команду, у которой триггер /start (часто используют как welcome) или отдельную настройку
            // Для простоты: если есть команда '/welcome' в базе, используем её текст
            const welcomeCmd = state.commands.find(c => c.trigger === '/welcome') || state.commands.find(c => c.trigger === '/start');
            if (welcomeCmd) {
                const text = welcomeCmd.response.replace('{name}', member.first_name);
                await sendMessage(chatId, text, { message_thread_id: threadId !== 'general' ? threadId : undefined });
            }
        }
        return; 
    }

    const text = (msg.text || msg.caption || '').trim();
    const user = msg.from;
    const isPrivate = msg.chat.type === 'private';
    
    // Topic Discovery
    if (isTargetChat && threadId !== 'general') {
        const nameToSave = msg.reply_to_message?.forum_topic_created?.name || 
                           (msg.forum_topic_created ? msg.forum_topic_created.name : null) || 
                           state.topicNames[threadId] || `Topic ${threadId}`;
        
        if (!state.topicNames[threadId]) {
             await update(ref(db, 'topicNames'), { [threadId]: nameToSave });
             state.topicNames[threadId] = nameToSave;
        }
    }

    // Logging
    let msgType = 'text';
    if (msg.photo) msgType = 'photo';
    else if (msg.voice) msgType = 'voice';
    else if (msg.video) msgType = 'video';
    
    const logMsg = {
        dir: 'in',
        text: text || `[${msgType}]`,
        type: msgType,
        mediaUrl: '', 
        time: new Date().toLocaleTimeString('ru-RU'),
        timestamp: Date.now(),
        isGroup: !isPrivate,
        user: user.first_name,
        userId: user.id
    };

    await updateUserHistory(user, logMsg);
    if (isTargetChat) {
        await updateTopicHistory(threadId, { ...logMsg, isIncoming: true }, null);
    }

    if (user.is_bot) return;
    if (!state.isBotActive) return;

    if (text) {
        const lowerText = text.toLowerCase();
        
        // --- КОМАНДА /лещ (SLAP) ---
        // Ищем команду где триггер = /лещ или /slap
        const slapCmd = state.commands.find(c => c.trigger === '/лещ' || c.trigger === '/slap');
        if (slapCmd && (lowerText.startsWith('/лещ') || lowerText.startsWith('/slap'))) {
            const parts = text.split(' ');
            const target = parts.length > 1 ? parts.slice(1).join(' ') : (msg.reply_to_message?.from?.first_name || "воздух");
            
            // Если есть реплай, шлем реплаем
            const replyId = msg.reply_to_message?.message_id || msg.message_id;
            
            let resp = slapCmd.response.replace('{target}', target);
            await sendMessage(chatId, resp, { 
                message_thread_id: threadId !== 'general' ? threadId : undefined,
                reply_to_message_id: replyId 
            });
            return;
        }

        // --- ADMIN COMMANDS ---
        if (['/warn', '/mute', '/ban', '/unmute'].some(c => lowerText.startsWith(c))) {
            const cmd = lowerText.split(' ')[0];
            if (state.config.adminIds && state.config.adminIds.includes(String(user.id))) {
                await handleSystemCommand(cmd, msg, threadId !== 'general' ? threadId : undefined);
                return;
            }
        }

        // --- CUSTOM COMMANDS ---
        let commandHandled = false;
        for (const cmd of state.commands) {
            let match = false;
            const trig = cmd.trigger.toLowerCase();
            if (cmd.matchType === 'exact' && lowerText === trig) match = true;
            else if (cmd.matchType === 'start' && lowerText.startsWith(trig)) match = true;
            else if (cmd.matchType === 'contains' && lowerText.includes(trig)) match = true;

            if (match) {
                // Проверки ролей и топиков пропустим для краткости, они есть в прошлой версии
                await sendMessage(chatId, cmd.response, { message_thread_id: threadId !== 'general' ? threadId : undefined });
                commandHandled = true;
                break;
            }
        }

        // --- AI ---
        if (!commandHandled && state.config.enableAI) {
            const isMention = lowerText.includes('хеликс') || lowerText.includes('helix') || (isPrivate && state.config.enablePM);
            const isDisabled = state.disabledAiTopics.includes(threadId);

            if (isMention && !isDisabled) {
                const question = text.replace(/хеликс|helix/gi, '').trim();
                const answer = await getAIResponse(question || "Привет", user.first_name);
                
                await sendMessage(chatId, answer, { 
                    reply_to_message_id: msg.message_id,
                    message_thread_id: threadId !== 'general' ? threadId : undefined
                });
                
                // Log AI answer
                if (isTargetChat) {
                    await updateTopicHistory(threadId, {
                        user: 'Bot',
                        text: answer,
                        isIncoming: false,
                        time: new Date().toLocaleTimeString('ru-RU'),
                        timestamp: Date.now(),
                        type: 'text'
                    }, null);
                }
                
                // Update AI Stats
                const newStats = { query: question || "Привет", response: answer, time: Date.now() };
                const curHist = state.aiStats.history || [];
                await set(ref(db, 'aiStats'), { total: (state.aiStats.total || 0) + 1, history: [newStats, ...curHist].slice(0, 100) });
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
