
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

console.log("🔥 [SERVER] Запуск сервера Helix (v4.6 Fix Patch)...");

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
        return data;
    } catch (e) {
        console.error(`[NETWORK ERROR] ${method}:`, e.message);
        return { ok: false };
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
        use_independent_chat_permissions: true 
    });
};

const banUser = async (chatId, userId) => {
    return await apiCall('banChatMember', { chat_id: chatId, user_id: userId });
};

// ==========================================
// 4. ЛОГИКА СОХРАНЕНИЯ (CRM & CHAT)
// ==========================================
const updateUserHistory = async (user, message) => {
    try {
        const userId = user.id;
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
            unreadCount: (existingUser.unreadCount || 0) + 1,
            lastSeen: new Date().toLocaleTimeString('ru-RU'),
            lastActiveDate: new Date().toLocaleDateString()
        };

        const newHistory = [...currentUser.history, message].slice(-50); 
        currentUser.history = newHistory;

        await set(ref(db, userPath), currentUser);
    } catch (e) {
        console.error("[CRM ERROR] Save failed:", e);
    }
};

const updateTopicHistory = async (topicId, message, topicNameRaw) => {
    try {
        const tId = topicId || 'general';
        const path = `topicHistory/${tId}`;
        
        // Авто-регистрация новой темы
        // Если ID не general и такого топика еще нет в локальном стейте ИЛИ пришло явное имя
        const currentName = state.topicNames[tId];
        const newName = topicNameRaw || (currentName ? currentName : `Topic ${tId}`);
        
        if (tId !== 'general') {
            if (!currentName || (topicNameRaw && currentName !== topicNameRaw)) {
                console.log(`[TOPIC] Registering/Updating topic: ${tId} -> ${newName}`);
                // Fix: Using firebase update function correctly
                await update(ref(db, 'topicNames'), { [tId]: newName });
                state.topicNames[tId] = newName; 
            }
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
    const { openaiApiKey, aiBaseUrl, aiModel, aiPersonality, aiProfanity, aiBehavior, aiTemperature, aiMaxTokens } = state.config;
    if (!openaiApiKey) return "⚠️ AI не настроен.";

    const context = state.knowledgeBase.map(k => `[${k.category}] ${k.title}: ${k.response}`).join('\n');
    
    // --- 1. ЛИЧНОСТЬ ---
    let toneInstruction = "";
    let refusalStyle = "К сожалению, в базе нет информации об этом."; 

    if (aiProfanity) {
        toneInstruction = `РЕЖИМ: БЫДЛО-МУЖИК (18+). Мат: ДА. Грубость: ДА.`;
        refusalStyle = "Бля, нет такой инфы. Иди нахуй.";
    } else {
        switch (aiPersonality) {
            case 'angry': toneInstruction = "Ты злой. Отвечай грубо."; refusalStyle = "Нет данных! Отвали."; break;
            case 'joker': toneInstruction = "Ты комик. Шути."; refusalStyle = "Этого в сценарии нет!"; break;
            case 'gopnik': toneInstruction = "Ты гопник. Сленг."; refusalStyle = "Нету инфы, братишка."; break;
            case 'kind': toneInstruction = "Ты добрый брат."; refusalStyle = "Прости, не нашел :("; break;
            default: toneInstruction = "Ты полезный помощник."; refusalStyle = "В базе нет информации.";
        }
    }

    // --- 2. СТИЛЬ ---
    let styleInstruction = "2-3 предложения.";
    if (aiBehavior === 'concise') styleInstruction = "1 предложение.";

    const systemPrompt = `
    ROLE: ${toneInstruction}
    USER: ${userName}
    CONTEXT: ${context}
    INSTRUCTIONS:
    1. ИСПОЛЬЗУЙ ТОЛЬКО CONTEXT.
    2. Если нет в CONTEXT -> "${refusalStyle}".
    3. FORMAT: ${styleInstruction}
    `;

    try {
        const response = await fetch(`${aiBaseUrl || 'https://api.groq.com/openai/v1'}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiApiKey}` },
            body: JSON.stringify({
                model: aiModel || "llama-3.3-70b-versatile",
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: question }],
                temperature: aiTemperature || 0.5, 
                max_tokens: aiMaxTokens || 800
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
    
    if (reply && reply.from) {
        const targetUser = reply.from;
        const targetName = targetUser.first_name;
        
        if (targetUser.is_bot) return sendMessage(chatId, "⚠️ Нельзя применить к боту.", { message_thread_id: targetThread });

        // WARN
        if (command === '/warn') {
            const userSnapshot = await get(ref(db, `users/${targetUser.id}`));
            const userData = userSnapshot.val() || {};
            const warns = (userData.warnings || 0) + 1;
            
            await update(ref(db, `users/${targetUser.id}`), { warnings: warns });
            
            if (warns >= 3) {
                const res = await restrictUser(chatId, targetUser.id, { can_send_messages: false }, Math.floor(Date.now()/1000) + 172800);
                if (res.ok) {
                    await update(ref(db, `users/${targetUser.id}`), { warnings: 0, status: 'muted' });
                    return sendMessage(chatId, `🛑 <b>${targetName}</b> получил 3/3 варнов и заглушен на 48 часов.`, { message_thread_id: targetThread });
                }
            } else {
                return sendMessage(chatId, `⚠️ <b>${targetName}</b>, предупреждение (${warns}/3).`, { message_thread_id: targetThread });
            }
        }

        // MUTE
        if (command === '/mute') {
            const cmdConfig = state.commands.find(c => c.trigger === '/mute');
            const durationMins = cmdConfig && cmdConfig.muteDuration ? cmdConfig.muteDuration : 60;
            const until = Math.floor(Date.now()/1000) + (durationMins * 60);

            const res = await restrictUser(chatId, targetUser.id, { can_send_messages: false }, until);
            if (res.ok) {
                await update(ref(db, `users/${targetUser.id}`), { status: 'muted' });
                return sendMessage(chatId, `😶 <b>${targetName}</b> заглушен на ${durationMins} мин.`, { message_thread_id: targetThread });
            }
        }

        // BAN
        if (command === '/ban') {
            const res = await banUser(chatId, targetUser.id);
            if (res.ok) {
                await update(ref(db, `users/${targetUser.id}`), { status: 'banned' });
                return sendMessage(chatId, `⛔️ <b>${targetName}</b> забанен.`, { message_thread_id: targetThread });
            }
        }
        
        // UNMUTE
        if (command === '/unmute') {
            const res = await restrictUser(chatId, targetUser.id, { can_send_messages: true, can_send_media_messages: true, can_send_other_messages: true });
            if (res.ok) {
                await update(ref(db, `users/${targetUser.id}`), { status: 'active', warnings: 0 });
                return sendMessage(chatId, `✅ <b>${targetName}</b> размучен.`, { message_thread_id: targetThread });
            }
        }
    }
};

// ==========================================
// 7. ОБРАБОТКА СООБЩЕНИЙ (MAIN)
// ==========================================
// !!! FIX: Changed argument name to tgUpdate to avoid shadowing imported 'update' function
const processUpdate = async (tgUpdate) => {
    const msg = tgUpdate.message;
    if (!msg) return; 

    const chatId = msg.chat.id;
    const text = (msg.text || msg.caption || '').trim();
    const user = msg.from;
    const isPrivate = msg.chat.type === 'private';
    const isTargetChat = String(chatId) === state.config.targetChatId;
    const threadId = msg.message_thread_id ? String(msg.message_thread_id) : 'general';
    
    // --- AUTO-TOPIC DISCOVERY ---
    const topicNameGuess = msg.reply_to_message?.forum_topic_created?.name || 
                          (msg.forum_topic_created ? msg.forum_topic_created.name : null);

    // Force register topic on ANY message if it's not general
    if (isTargetChat && threadId !== 'general') {
        const knownName = state.topicNames[threadId];
        const nameToSave = topicNameGuess || knownName || `Topic ${threadId}`;
        
        if (!knownName || (topicNameGuess && knownName !== topicNameGuess)) {
             // Now this calls the Firebase update function correctly
             await update(ref(db, 'topicNames'), { [threadId]: nameToSave });
             state.topicNames[threadId] = nameToSave;
        }
    }

    // Определяем тип и медиа для логов
    let msgType = 'text';
    let mediaUrl = '';
    
    if (msg.photo) { msgType = 'photo'; mediaUrl = 'Photo'; }
    else if (msg.voice) { msgType = 'voice'; mediaUrl = 'Voice'; }
    else if (msg.video) { msgType = 'video'; mediaUrl = 'Video'; }
    else if (msg.video_note) { msgType = 'video_note'; mediaUrl = 'Video Note'; }
    else if (msg.sticker) { msgType = 'sticker'; }
    else if (msg.document) { msgType = 'document'; }
    
    const displayText = text || (mediaUrl ? `[${mediaUrl}]` : `[${msgType}]`);

    // 1. ПРОВЕРКА ОТКЛЮЧЕННЫХ ГРУПП
    const groupKey = String(chatId);
    if (!isPrivate && state.groups[groupKey]?.isDisabled) return;
    
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
        text: displayText,
        type: msgType,
        mediaUrl: mediaUrl === 'Photo' || mediaUrl === 'Voice' ? '' : mediaUrl, 
        time: new Date().toLocaleTimeString('ru-RU'),
        timestamp: Date.now(),
        isGroup: !isPrivate,
        user: user.first_name,
        userId: user.id
    };

    await updateUserHistory(user, logMsg);
    if (isTargetChat) {
        await updateTopicHistory(threadId, { ...logMsg, isIncoming: true }, topicNameGuess);
    }

    if (user.is_bot) return;

    // 2. ФИЛЬТР МАТА
    if (state.config.bannedWords && !isPrivate && text) {
        const badWords = state.config.bannedWords.split(',').map(w => w.trim().toLowerCase()).filter(w => w);
        if (badWords.some(w => text.toLowerCase().includes(w))) {
            await deleteMessage(chatId, msg.message_id);
            const warnMsg = await sendMessage(chatId, `⚠️ @${user.username || user.first_name}, это слово запрещено!`, { message_thread_id: threadId !== 'general' ? threadId : undefined });
            setTimeout(() => { if (warnMsg?.result) deleteMessage(chatId, warnMsg.result.message_id); }, 5000);
            
            const userRef = (await get(ref(db, `users/${user.id}`))).val() || {};
            await update(ref(db, `users/${user.id}`), { warnings: (userRef.warnings || 0) + 1 });
            return; 
        }
    }

    if (!state.isBotActive) return;
    if (isPrivate && !state.config.enablePM) return;

    // 3. КОМАНДЫ (Только если есть текст)
    if (text) {
        const lowerText = text.toLowerCase();
        const firstWord = lowerText.split(' ')[0];
        
        // --- SLAP COMMAND (/лещ) ---
        const slapCommand = state.commands.find(c => 
            c.trigger.toLowerCase() === firstWord && 
            (c.trigger === '/лещ' || c.trigger === '/slap')
        );

        if (slapCommand) {
            const target = text.substring(firstWord.length).trim();
            if (target) {
                let responseText = slapCommand.response;
                if (responseText.includes('{target}')) {
                    responseText = responseText.replace('{target}', target);
                } else {
                    responseText = `${responseText} ${target}`;
                }

                await sendMessage(chatId, responseText, { 
                    message_thread_id: threadId !== 'general' ? threadId : undefined,
                    reply_to_message_id: msg.message_id 
                });
                return; 
            }
        }

        if (['/warn', '/mute', '/ban', '/unmute'].some(c => lowerText.startsWith(c))) {
            const cmd = lowerText.split(' ')[0];
            if (state.config.adminIds && state.config.adminIds.includes(String(user.id))) {
                await handleSystemCommand(cmd, msg, threadId !== 'general' ? threadId : undefined);
                return;
            }
        }

        let commandHandled = false;
        const sortedCommands = [...state.commands].sort((a, b) => (a.matchType === 'exact' ? -1 : 1));

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
                const replyMarkup = cmd.buttons && cmd.buttons.length > 0 ? { inline_keyboard: cmd.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;
                await sendMessage(chatId, cmd.response, { message_thread_id: targetThread !== 'general' ? targetThread : undefined, reply_markup: replyMarkup });
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

                const currentHistory = Array.isArray(state.aiStats.history) ? state.aiStats.history : [];
                const newHistory = [{ query: question || "Привет", response: answer, time: Date.now() }, ...currentHistory].slice(0, 100);
                
                await set(ref(db, 'aiStats'), { total: (state.aiStats.total || 0) + 1, history: newHistory });

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
    }
};

// ==========================================
// 8. ЗАПУСК
// ==========================================
const startLoop = async () => {
    setInterval(() => { set(ref(db, 'status/heartbeat'), Date.now()); }, 60000);

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
