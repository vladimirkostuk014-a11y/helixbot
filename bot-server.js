
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

// Глобальное состояние
let state = {
    config: {},
    users: {},
    groups: {},
    commands: [],
    knowledgeBase: [],
    calendarEvents: [],
    topicNames: {},
    aiStats: { total: 0, history: [] },
    disabledAiTopics: [],
    isBotActive: true 
};

let lastUpdateId = 0;
const processedUpdates = new Set();

console.log("🔥 [SERVER] Запуск сервера Helix (v2.5 Final Fixes)...");

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
sync('calendarEvents', 'calendarEvents', true);
sync('topicNames', 'topicNames');
sync('aiStats', 'aiStats');
sync('disabledAiTopics', 'disabledAiTopics', true);

onValue(ref(db, 'status/active'), (snap) => {
    state.isBotActive = snap.val() !== false; 
    console.log(`[STATUS] Режим ответа: ${state.isBotActive ? '✅ АКТИВЕН' : '⏸ НА ПАУЗЕ'}`);
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
        const data = await response.json();
        if (!data.ok) {
            console.error(`[TELEGRAM ERROR] ${method}:`, data.description);
        }
        return data;
    } catch (e) {
        console.error(`[NETWORK ERROR] ${method}:`, e.message);
        return { ok: false, description: e.message };
    }
};

const sendMessage = async (chatId, text, options = {}) => {
    return await apiCall('sendMessage', {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        ...options
    });
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
        use_independent_chat_permissions: true // Важно для супергрупп
    });
};

const banUser = async (chatId, userId) => {
    return await apiCall('banChatMember', { chat_id: chatId, user_id: userId });
};

const unbanUser = async (chatId, userId) => {
    return await apiCall('unbanChatMember', { chat_id: chatId, user_id: userId, only_if_banned: true });
};

// ==========================================
// 4. ЛОГИКА СОХРАНЕНИЯ (CRM & CHAT)
// ==========================================

const updateUserHistory = async (user, message) => {
    try {
        const userId = user.id;
        const userPath = `users/${userId}`;
        
        let currentUser = state.users[userId] || {
            id: userId,
            name: user.first_name || 'Unknown',
            username: user.username || '', 
            role: state.config.adminIds?.includes(String(userId)) ? 'admin' : 'user',
            status: 'active',
            warnings: 0,
            joinDate: new Date().toLocaleDateString(),
            history: [],
            msgCount: 0,
            dailyMsgCount: 0,
            unreadCount: 0
        };

        currentUser.name = user.first_name || currentUser.name;
        currentUser.username = user.username || ''; 
        currentUser.lastSeen = new Date().toLocaleTimeString('ru-RU');
        currentUser.lastActiveDate = new Date().toLocaleDateString();
        currentUser.msgCount = (currentUser.msgCount || 0) + 1;
        currentUser.dailyMsgCount = (currentUser.dailyMsgCount || 0) + 1;
        currentUser.unreadCount = (currentUser.unreadCount || 0) + 1;

        const history = Array.isArray(currentUser.history) ? currentUser.history : [];
        const newHistory = [...history, message].slice(-50); 
        currentUser.history = newHistory;

        await set(ref(db, userPath), currentUser);
        // Не обновляем локальный стейт вручную, ждем синхронизации от Firebase, чтобы избежать рассинхрона
        
    } catch (e) {
        console.error("[CRM ERROR] Save failed:", e);
    }
};

const updateTopicHistory = async (topicId, message, topicNameRaw) => {
    try {
        const tId = topicId || 'general';
        const path = `topicHistory/${tId}`;
        
        // Авто-регистрация новой темы
        if (!state.topicNames[tId] && tId !== 'general') {
            const newName = topicNameRaw || `Topic ${tId}`;
            await update(ref(db, 'topicNames'), { [tId]: newName });
            console.log(`[TOPIC] Registered new topic: ${newName} (${tId})`);
        } else if (tId !== 'general' && topicNameRaw && state.topicNames[tId] !== topicNameRaw) {
            await update(ref(db, 'topicNames'), { [tId]: topicNameRaw });
        }

        const snapshot = await get(ref(db, path));
        const currentHistory = snapshot.val() || [];
        const updatedHistory = [...(Array.isArray(currentHistory) ? currentHistory : []), message].slice(-50);
        
        await set(ref(db, path), updatedHistory);
    } catch (e) {
        console.error("[TOPIC ERROR] Save failed:", e);
    }
};

// ==========================================
// 5. МОЗГ AI
// ==========================================
const getAIResponse = async (question, userName) => {
    const { openaiApiKey, aiBaseUrl, aiModel, aiPersonality, aiProfanity } = state.config;
    if (!openaiApiKey) return "⚠️ AI не настроен.";

    const context = state.knowledgeBase.map(k => `[${k.category}] ${k.title}: ${k.response}`).join('\n');
    let persona = "Ты — Хеликс, полезный помощник.";
    if (aiProfanity) persona = "Ты дерзкий, используешь мат (18+), но по делу.";
    else if (aiPersonality === 'joker') persona = "Ты шутник.";
    else if (aiPersonality === 'official') persona = "Ты официальный бот.";

    const systemPrompt = `
    ROLE: ${persona}
    USER: ${userName}
    INSTRUCTIONS:
    1. SMALL TALK: Отвечай свободно на приветствия.
    2. FACTS: ИСПОЛЬЗУЙ ТОЛЬКО CONTEXT НИЖЕ.
       CONTEXT: ${context}
    3. UNKNOWN: Если нет в контексте, скажи что не знаешь.
    `;

    try {
        const response = await fetch(`${aiBaseUrl || 'https://api.groq.com/openai/v1'}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiApiKey}` },
            body: JSON.stringify({
                model: aiModel || "llama-3.3-70b-versatile",
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: question }],
                temperature: 0.6, max_tokens: 800
            })
        });
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "Ошибка генерации.";
    } catch (e) { return "Ошибка AI."; }
};

// ==========================================
// 6. ОБРАБОТКА СИСТЕМНЫХ КОМАНД
// ==========================================
const handleSystemCommand = async (command, msg, targetThread) => {
    const chatId = msg.chat.id;
    const reply = msg.reply_to_message;
    
    // Если это реплай
    if (reply && reply.from) {
        const targetUser = reply.from;
        const targetName = targetUser.first_name;
        
        if (targetUser.is_bot) return sendMessage(chatId, "⚠️ Нельзя применить к боту.", { message_thread_id: targetThread });

        // WARN
        if (command === '/warn') {
            const userRef = (await get(ref(db, `users/${targetUser.id}`))).val() || {};
            const warns = (userRef.warnings || 0) + 1;
            
            await update(ref(db, `users/${targetUser.id}`), { warnings: warns });
            
            if (warns >= 3) {
                const res = await restrictUser(chatId, targetUser.id, { can_send_messages: false }, Math.floor(Date.now()/1000) + 172800); // 48h
                if (res.ok) {
                    await update(ref(db, `users/${targetUser.id}`), { warnings: 0, status: 'muted' });
                    return sendMessage(chatId, `🛑 <b>${targetName}</b> получил 3/3 варнов и заглушен на 48 часов.`, { message_thread_id: targetThread });
                } else {
                    return sendMessage(chatId, `⚠️ Ошибка выдачи мута: ${res.description}`, { message_thread_id: targetThread });
                }
            } else {
                return sendMessage(chatId, `⚠️ <b>${targetName}</b>, предупреждение (${warns}/3).`, { message_thread_id: targetThread });
            }
        }

        // MUTE
        if (command === '/mute') {
            const res = await restrictUser(chatId, targetUser.id, { can_send_messages: false }, Math.floor(Date.now()/1000) + 3600);
            if (res.ok) {
                await update(ref(db, `users/${targetUser.id}`), { status: 'muted' });
                return sendMessage(chatId, `😶 <b>${targetName}</b> заглушен на 1 час.`, { message_thread_id: targetThread });
            } else {
                return sendMessage(chatId, `⚠️ Не удалось заглушить: ${res.description}`, { message_thread_id: targetThread });
            }
        }

        // BAN
        if (command === '/ban') {
            const res = await banUser(chatId, targetUser.id);
            if (res.ok) {
                await update(ref(db, `users/${targetUser.id}`), { status: 'banned' });
                return sendMessage(chatId, `⛔️ <b>${targetName}</b> забанен.`, { message_thread_id: targetThread });
            } else {
                return sendMessage(chatId, `⚠️ Не удалось забанить: ${res.description}`, { message_thread_id: targetThread });
            }
        }
        
        // UNMUTE
        if (command === '/unmute') {
            const res = await restrictUser(chatId, targetUser.id, { 
                can_send_messages: true, 
                can_send_media_messages: true, 
                can_send_other_messages: true,
                can_add_web_page_previews: true
            });
            if (res.ok) {
                await update(ref(db, `users/${targetUser.id}`), { status: 'active' });
                return sendMessage(chatId, `✅ <b>${targetName}</b> размучен.`, { message_thread_id: targetThread });
            } else {
                return sendMessage(chatId, `⚠️ Ошибка: ${res.description}`, { message_thread_id: targetThread });
            }
        }
    }
};

// ==========================================
// 7. ОБРАБОТКА СООБЩЕНИЙ (MAIN)
// ==========================================
const processUpdate = async (update) => {
    const msg = update.message;
    if (!msg || !msg.text) return; 

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const user = msg.from;
    const isPrivate = msg.chat.type === 'private';
    const isTargetChat = String(chatId) === state.config.targetChatId;
    const threadId = msg.message_thread_id ? String(msg.message_thread_id) : 'general';
    const topicNameGuess = msg.reply_to_message?.forum_topic_created?.name || null;

    // 1. ПРОВЕРКА ОТКЛЮЧЕННЫХ ГРУПП (FIXED)
    // Если группа есть в списке и у неё isDisabled = true, игнорируем всё, кроме команд админа (если нужно, но лучше полный игнор)
    // Для надежности приводим к строке
    const groupKey = String(chatId);
    if (!isPrivate && state.groups[groupKey]?.isDisabled) {
        // Проверяем, не админ ли пишет команду разблокировки? (пока нет такой, просто игнорим)
        return; 
    }
    
    // Если новой группы нет в базе - добавляем
    if (!isPrivate && !state.groups[groupKey]) {
        await set(ref(db, `groups/${groupKey}`), {
            id: chatId,
            title: msg.chat.title || `Group ${chatId}`,
            type: msg.chat.type,
            lastActive: new Date().toLocaleTimeString(),
            isDisabled: false
        });
    }

    const logMsg = {
        dir: 'in',
        text: text,
        type: 'text',
        time: new Date().toLocaleTimeString('ru-RU'),
        timestamp: Date.now(), // !!! FIX ДЛЯ ГРАФИКОВ
        isGroup: !isPrivate,
        user: user.first_name 
    };

    // Сохраняем всегда для истории
    await updateUserHistory(user, logMsg);
    if (isTargetChat) {
        await updateTopicHistory(threadId, { ...logMsg, isIncoming: true }, topicNameGuess);
    }

    if (user.is_bot) return;

    // 2. ФИЛЬТР МАТА (BAD WORDS) (FIXED)
    if (state.config.bannedWords && !isPrivate) {
        const badWords = state.config.bannedWords.split(',').map(w => w.trim().toLowerCase()).filter(w => w);
        if (badWords.some(w => text.toLowerCase().includes(w))) {
            await deleteMessage(chatId, msg.message_id);
            const warnMsg = await sendMessage(chatId, `⚠️ @${user.username || user.first_name}, это слово запрещено!`, { message_thread_id: threadId !== 'general' ? threadId : undefined });
            
            // Удаляем предупреждение через 5 сек чтобы не мусорить
            setTimeout(() => {
                if (warnMsg && warnMsg.result) deleteMessage(chatId, warnMsg.result.message_id);
            }, 5000);

            // Выдаем варн в БД
            const userRef = (await get(ref(db, `users/${user.id}`))).val() || {};
            await update(ref(db, `users/${user.id}`), { warnings: (userRef.warnings || 0) + 1 });
            return; 
        }
    }

    // Если бот на паузе - дальше не идем
    if (!state.isBotActive) return;
    if (isPrivate && !state.config.enablePM) return;

    // 3. КОМАНДЫ
    const lowerText = text.toLowerCase();
    
    // Системные команды (Hardcoded logic for execution)
    if (lowerText.startsWith('/warn') || lowerText.startsWith('/mute') || lowerText.startsWith('/ban') || lowerText.startsWith('/unmute')) {
        const cmd = lowerText.split(' ')[0];
        // Проверяем права админа (строгое сравнение строк)
        if (state.config.adminIds && state.config.adminIds.includes(String(user.id))) {
            await handleSystemCommand(cmd, msg, threadId !== 'general' ? threadId : undefined);
            return;
        } else {
            // Можно ответить, что нет прав, или промолчать
            // console.log(`User ${user.id} tried system command but is not admin`);
        }
    }

    let commandHandled = false;
    // Сортируем: сначала exact match, потом contains
    const sortedCommands = [...state.commands].sort((a, b) => {
        if (a.matchType === 'exact') return -1;
        return 1;
    });

    for (const cmd of sortedCommands) {
        let match = false;
        const trig = cmd.trigger.toLowerCase();

        if (cmd.matchType === 'exact' && lowerText === trig) match = true;
        else if (cmd.matchType === 'start' && lowerText.startsWith(trig)) match = true;
        else if (cmd.matchType === 'contains' && lowerText.includes(trig)) match = true;

        if (match) {
            if (cmd.allowedTopicId === 'private_only' && !isPrivate) continue;
            if (cmd.allowedTopicId && cmd.allowedTopicId !== 'private_only' && cmd.allowedTopicId !== threadId && !isPrivate) continue;

            const targetThread = (cmd.isSystem && cmd.notificationTopicId) ? cmd.notificationTopicId : threadId;
            
            const replyMarkup = cmd.buttons && cmd.buttons.length > 0 ? {
                inline_keyboard: cmd.buttons.map(b => [{ text: b.text, url: b.url }])
            } : undefined;

            await sendMessage(chatId, cmd.response, { 
                message_thread_id: targetThread !== 'general' ? targetThread : undefined,
                reply_markup: replyMarkup
            });
            
            commandHandled = true;
            break; 
        }
    }

    // 4. AI
    if (!commandHandled && state.config.enableAI) {
        const isMention = lowerText.includes('хеликс') || lowerText.includes('helix') || (isPrivate && state.config.enablePM);
        const isDisabled = state.disabledAiTopics.includes(threadId);

        if (isMention && !isDisabled) {
            const question = text.replace(/хеликс|helix/gi, '').trim();
            if (!question && !isPrivate) return;

            const answer = await getAIResponse(question || "Привет", user.first_name);
            
            await sendMessage(chatId, answer, { 
                reply_to_message_id: msg.message_id,
                message_thread_id: threadId !== 'general' ? threadId : undefined
            });

            const newHistory = [{ query: question || "Привет", response: answer, time: Date.now() }, ...state.aiStats.history].slice(0, 100);
            await set(ref(db, 'aiStats'), { total: state.aiStats.total + 1, history: newHistory });

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
        }
    }
};

// ==========================================
// 8. ЗАПУСК
// ==========================================
const startLoop = async () => {
    setInterval(() => {
        set(ref(db, 'status/heartbeat'), Date.now());
    }, 60000);

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
                console.error("Polling error (retry 5s):", e.message);
                await new Promise(r => setTimeout(r, 5000));
            }
        } else {
            await new Promise(r => setTimeout(r, 2000));
        }
    }
};

setTimeout(startLoop, 3000);
