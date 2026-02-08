
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

console.log("🔥 [SERVER] Запуск сервера Helix (v6.0 Full Control)...");

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

// HEARTBEAT (Чтобы сайт видел, что бот онлайн)
setInterval(() => {
    set(ref(db, 'status/heartbeat'), Date.now());
}, 30000); // Каждые 30 сек

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
    if (now.getHours() === 0 && now.getMinutes() === 0) {
        console.log("🌙 [CRON] Полночь. Очистка...");
        await set(ref(db, 'topicHistory'), {});
        await set(ref(db, 'topicUnreads'), {});
        
        const usersRef = ref(db, 'users');
        const snapshot = await get(usersRef);
        const users = snapshot.val();
        if (users) {
            const updates = {};
            Object.keys(users).forEach(uid => { updates[`${uid}/dailyMsgCount`] = 0; });
            await update(usersRef, updates);
        }
        await new Promise(r => setTimeout(r, 65000));
    }
};
setInterval(checkMidnightCleanup, 30000);

// ==========================================
// 5. CRM & HISTORY
// ==========================================
const updateUserHistory = async (user, message) => {
    try {
        const userId = user.id;
        if (userId < 0) return; // Ignore channels/groups

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
    } catch (e) { console.error(e); }
};

const updateTopicHistory = async (topicId, message, topicNameRaw) => {
    try {
        const tId = topicId || 'general';
        const path = `topicHistory/${tId}`;
        
        // Auto-rename topic
        const currentName = state.topicNames[tId];
        const newName = topicNameRaw || (currentName ? currentName : `Topic ${tId}`);
        if (tId !== 'general' && (!currentName || (topicNameRaw && currentName !== topicNameRaw))) {
            await update(ref(db, 'topicNames'), { [tId]: newName });
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
// 6. AI (STRICT MODE)
// ==========================================
const getAIResponse = async (question, userName) => {
    const { openaiApiKey, aiBaseUrl, aiModel, aiPersonality, aiProfanity, aiBehavior, aiTemperature } = state.config;
    if (!openaiApiKey) return "⚠️ AI выключен.";

    const context = state.knowledgeBase.map(k => `[DATA] Q: ${k.title} -> A: ${k.response}`).join('\n');
    
    let tone = "Ты полезный помощник.";
    let style = "Отвечай кратко.";
    let profanityInstr = "";

    // 1. Личности
    if (aiProfanity) {
        tone = "Ты дерзкий, используешь русский мат и сленг. Ты реальный пацан с района.";
        profanityInstr = "ОБЯЗАТЕЛЬНО используй мат (бля, нахуй, ебать). Будь грубым.";
    } else {
        switch (aiPersonality) {
            case 'angry': tone = "Ты злой, агрессивный. Тебя все бесят."; break;
            case 'joker': tone = "Ты клоун. Постоянно шутишь, сарказм, ирония."; break;
            case 'gopnik': tone = "Ты гопник. Сленг: 'слышь', 'братишка', 'в натуре'."; break;
            case 'kind': tone = "Ты очень добрый, милый, заботливый."; break;
            case 'philosopher': tone = "Ты философ. Отвечаешь загадками, глубокомысленно."; break;
            case 'cyberpunk': tone = "Ты кибер-имплант. Говоришь как робот из будущего. Сленг: 'нетраннер', 'хром', 'дека'."; break;
            case 'official': tone = "Ты сухой бюрократ. Только факты."; break;
        }
    }

    // 2. Стиль
    if (aiBehavior === 'detailed') style = "Отвечай ОЧЕНЬ ПОДРОБНО. Разверни мысль на 3-4 предложения. Добавь деталей.";
    if (aiBehavior === 'concise') style = "Отвечай одним коротким предложением.";
    if (aiBehavior === 'bullet') style = "Отвечай списком (буллитами), если перечисляешь факты.";

    const systemPrompt = `
    IDENTITY: Ты бот Хеликс. Твой характер: ${tone}
    ${profanityInstr}
    
    KNOWLEDGE BASE (GAME DATA):
    ${context}
    
    PROTOCOL:
    1. ANALYZE INPUT:
       - Type A: "Small Talk" (Hello, how are you, joke, who are you). 
         -> ACTION: Ignore Knowledge Base. Just chat using your Personality.
       - Type B: "Data Query" (Runes, Armor, Stats, How to play, Drop rates, Locations). 
         -> ACTION: STRICT KNOWLEDGE BASE LOOKUP.
    
    2. RULES FOR TYPE B (DATA QUERY):
       - LOOK ONLY IN [KNOWLEDGE BASE] above.
       - IF FOUND: Answer using the data, formatted in your Personality.
       - IF NOT FOUND: You MUST say "I don't know" or "Not in database" (in your style). 
       - CRITICAL: DO NOT INVENT DATA. DO NOT HALLUCINATE. DO NOT SEARCH INTERNET.
       
    3. FORMAT:
       ${style}
       - Language: Russian.
    `;

    try {
        const response = await fetch(`${aiBaseUrl || 'https://api.groq.com/openai/v1'}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiApiKey}` },
            body: JSON.stringify({
                model: aiModel || "llama-3.3-70b-versatile",
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: question }],
                temperature: aiTemperature || 0.4, 
                max_tokens: aiBehavior === 'detailed' ? 1200 : 600
            })
        });
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "Ошибка AI.";
    } catch (e) { return "Ошибка сети."; }
};

// ==========================================
// 7. СИСТЕМНЫЕ КОМАНДЫ (FIXED WARN)
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
            
            // Increment
            const newWarns = (userData.warnings || 0) + 1;
            
            // SAVE TO DB IMMEDIATELY
            await update(ref(db, userPath), { warnings: newWarns, name: targetUser.first_name, username: targetUser.username });
            
            if (newWarns >= 3) {
                await restrictUser(chatId, targetUser.id, { can_send_messages: false }, Math.floor(Date.now()/1000) + 172800);
                await update(ref(db, userPath), { warnings: 0, status: 'muted' });
                return sendMessage(chatId, `🛑 <b>${targetUser.first_name}</b> получил 3/3 варнов и заглушен на 48 часов.`, { message_thread_id: targetThread });
            } else {
                return sendMessage(chatId, `⚠️ <b>${targetUser.first_name}</b>, предупреждение (${newWarns}/3).`, { message_thread_id: targetThread });
            }
        }
        // ... (Other commands mute/ban similar logic)
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
    const isPrivate = msg.chat.type === 'private';

    const text = (msg.text || msg.caption || '').trim();
    const user = msg.from;

    // Logging
    const logMsg = {
        dir: 'in', text: text || `[Media]`, type: msg.photo ? 'photo' : 'text',
        time: new Date().toLocaleTimeString('ru-RU'),
        isGroup: !isPrivate, user: user.first_name, userId: user.id
    };

    await updateUserHistory(user, logMsg);
    if (isTargetChat) await updateTopicHistory(threadId, { ...logMsg, isIncoming: true }, null);

    if (user.is_bot) return;
    if (!state.isBotActive) return;

    if (text) {
        const lowerText = text.toLowerCase();

        // System Commands
        if (['/warn', '/mute', '/ban', '/unmute'].some(c => lowerText.startsWith(c))) {
            const cmd = lowerText.split(' ')[0];
            if (state.config.adminIds && state.config.adminIds.includes(String(user.id))) {
                await handleSystemCommand(cmd, msg, threadId !== 'general' ? threadId : undefined);
                return;
            }
        }
        
        // Custom Commands
        for (const cmd of state.commands) {
            if (cmd.matchType === 'exact' && lowerText === cmd.trigger.toLowerCase()) {
                await sendMessage(chatId, cmd.response, { message_thread_id: threadId !== 'general' ? threadId : undefined });
                return;
            }
        }

        // AI
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
                
                // Stats & Log
                const newStat = { query: question || "Привет", response: answer, time: Date.now() };
                const curHist = state.aiStats.history || [];
                await set(ref(db, 'aiStats'), { total: (state.aiStats.total || 0) + 1, history: [newStat, ...curHist].slice(0, 100) });
                
                if (isTargetChat) await updateTopicHistory(threadId, { user: 'Bot', text: answer, isIncoming: false, time: new Date().toLocaleTimeString('ru-RU'), type: 'text' }, null);
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
