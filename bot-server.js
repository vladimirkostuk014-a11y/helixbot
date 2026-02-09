
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, update as firebaseUpdate, get, remove } from "firebase/database";
import fetch from 'node-fetch';

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

console.log("🔥 [SERVER] Helix v9.0 (No Memory + Strict Mode)...");

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

setInterval(() => {
    set(ref(db, 'status/heartbeat'), Date.now()).catch(() => {});
}, 30000);

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

// CRM Update Logic
const updateUserHistory = async (user, message) => {
    try {
        const userId = user.id;
        if (userId < 0) return;

        const userPath = `users/${userId}`;
        const snapshot = await get(ref(db, userPath));
        const existingUser = snapshot.val() || {};

        // Логика непрочитанных сообщений:
        // Если сообщение от пользователя (dir: 'in') -> увеличиваем unreadCount
        // Если сообщение от бота/админа (dir: 'out') -> unreadCount не трогаем (его сбросит клиент при прочтении)
        let newUnreadCount = existingUser.unreadCount || 0;
        if (message.dir === 'in') {
            newUnreadCount += 1;
        }

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
            lastSeen: new Date().toLocaleTimeString('ru-RU'),
            unreadCount: newUnreadCount 
        };

        const newHistory = [...currentUser.history, message].slice(-50); 
        currentUser.history = newHistory;
        
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

        // Увеличиваем счетчик топика, если сообщение входящее
        if (message.dir === 'in') {
            const unreadRef = ref(db, `topicUnreads/${tId}`);
            const unreadSnap = await get(unreadRef);
            await set(unreadRef, (unreadSnap.val() || 0) + 1);
        }
    } catch (e) { console.error("Topic Update Error:", e); }
};

// AI Response without History
const getAIResponse = async (question) => {
    const { openaiApiKey, aiBaseUrl, aiModel, aiPersonality, aiProfanity, aiProfanityLevel, aiTemperature, jokes } = state.config;
    if (!openaiApiKey) return "⚠️ Ключ AI не настроен.";

    const context = state.knowledgeBase.map(k => `[DATA] ${k.title}: ${k.response}`).join('\n');
    let tone = "Ты Хеликс, живой собеседник.";
    let profanityInstr = "";

    const profLevel = aiProfanityLevel || 50;

    if (aiProfanity) {
        tone = "Ты дерзкий пацан, любишь стебать.";
        profanityInstr = `ВКЛЮЧЕН МАТ (${profLevel}%). Используй мат и оскорбления в ${profLevel}% предложений. Стеби жестко.`;
    } else {
        switch (aiPersonality) {
            case 'angry': tone = "Ты злой."; break;
            case 'joker': tone = "Ты шутник."; break;
            case 'gopnik': tone = "Ты гопник."; break;
        }
    }

    const systemPrompt = `
    ID: Хеликс. Характер: ${tone}
    ${profanityInstr}
    JOKES: ${jokes || ''}
    KB: ${context}

    LOGIC:
    1. GAME Q: Look in KB. Not found -> "Don't know".
    2. CHAT/INSULT: Ignore KB. Respond with personality/profanity. ALWAYS reply to insults.
    
    NO MEMORY. Reply to current message only.
    `;

    try {
        const response = await fetch(`${aiBaseUrl || 'https://api.groq.com/openai/v1'}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiApiKey}` },
            body: JSON.stringify({
                model: aiModel || "llama-3.3-70b-versatile",
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: question }],
                temperature: aiTemperature || 0.6,
                max_tokens: 800
            })
        });
        
        const data = await response.json();
        if (response.status !== 200) return `Error ${response.status}: ${data.error?.message}`;
        return data.choices?.[0]?.message?.content || "Ошибка AI.";
    } catch (e) { return "Ошибка сети AI."; }
};

const processUpdate = async (tgUpdate) => {
    const msg = tgUpdate.message;
    if (!msg) return; 

    const chatId = String(msg.chat.id);
    const targetChatId = String(state.config.targetChatId);
    const isPrivate = msg.chat.type === 'private';
    const user = msg.from;
    
    // Ignore unauthorized groups
    if (!isPrivate && chatId !== targetChatId) {
        await leaveChat(chatId);
        return;
    }

    if (user.is_bot) return;

    const threadId = msg.message_thread_id ? String(msg.message_thread_id) : 'general';
    const text = (msg.text || msg.caption || '').trim();

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

        // System Commands Check (/warn)
        if (lowerText.startsWith('/warn')) {
             if (state.config.adminIds && state.config.adminIds.includes(String(user.id)) && msg.reply_to_message) {
                 const target = msg.reply_to_message.from;
                 // Update warnings in DB directly so CRM sees it
                 const userPath = `users/${target.id}`;
                 const snap = await get(ref(db, userPath));
                 const uData = snap.val() || {};
                 const newW = (uData.warnings || 0) + 1;
                 await firebaseUpdate(ref(db, userPath), { warnings: newW, name: target.first_name });
                 await sendMessage(chatId, `⚠️ ${target.first_name}, предупреждение (${newW}/3).`, { message_thread_id: threadId !== 'general' ? threadId : undefined });
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
                
                const aiMsg = { 
                    dir: 'out', 
                    text: answer, 
                    type: 'text', 
                    time: new Date().toLocaleTimeString('ru-RU'), 
                    isGroup: !isPrivate, 
                    user: 'Bot' 
                };
                // Outgoing messages don't increase unread count (see updateUserHistory)
                await updateUserHistory(user, aiMsg);

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
