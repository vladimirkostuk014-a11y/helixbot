
// bot-server.js
// === ЗАГРУЗИТЕ ЭТОТ ФАЙЛ НА ВАШ VPS ===

import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, update, get } from "firebase/database";

// --- 1. FIREBASE CONFIG ---
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

// --- 2. GLOBAL STATE ---
let config = {};
let users = {};
let groups = {};
let commands = [];
let knowledgeBase = [];
let aiStats = { total: 0, history: [] };
let topicNames = {};
let topicHistory = {};
let calendarEvents = [];
let disabledAiTopics = [];
let isBotActive = false;

let lastUpdateId = 0;
let processedUpdates = new Set();

console.log("🔥 [SERVER] Starting Helix Bot Server...");

// --- 3. SYNC WITH FIREBASE (Downloader) ---
const sub = (path, cb) => onValue(ref(db, path), (snap) => cb(snap.val()));

sub('config', (val) => { if(val) config = val; });
sub('status/active', (val) => { 
    isBotActive = !!val; 
    console.log(`[STATUS] Bot is now ${isBotActive ? 'ACTIVE' : 'PAUSED'}`);
});
sub('users', (val) => { users = val || {}; });
sub('groups', (val) => { groups = val || {}; });
sub('commands', (val) => { commands = val ? Object.values(val) : []; });
sub('knowledgeBase', (val) => { knowledgeBase = val ? Object.values(val) : []; });
sub('aiStats', (val) => { aiStats = val || { total: 0, history: [] }; });
sub('topicNames', (val) => { topicNames = val || {}; });
sub('topicHistory', (val) => { 
    if(val) {
        // Convert to array if needed, keep synced
        topicHistory = val;
    } else topicHistory = {};
});
sub('calendarEvents', (val) => { calendarEvents = val ? Object.values(val) : []; });
sub('disabledAiTopics', (val) => { disabledAiTopics = val ? Object.values(val) : []; });

// --- 4. TELEGRAM API HELPERS ---
const apiCall = async (method, body) => {
    if (!config.token) return;
    try {
        const response = await fetch(`https://api.telegram.org/bot${config.token}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return await response.json();
    } catch (e) {
        console.error(`[API ERROR] ${method}:`, e.message);
    }
};

const sendResponse = async (chatId, text, replyTo = null, threadId = null, buttons = null) => {
    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
    };
    if (replyTo) payload.reply_to_message_id = replyTo;
    if (threadId && threadId !== 'general') payload.message_thread_id = threadId;
    if (buttons && buttons.length > 0) {
        payload.reply_markup = {
            inline_keyboard: buttons.map(b => [{ text: b.text, url: b.url.startsWith('http') ? b.url : `https://${b.url}` }])
        };
    }
    return await apiCall('sendMessage', payload);
};

// --- 5. DATA SAVERS (Uploader) ---
// Save message to User History (CRM)
const saveUserMsg = async (userObj, msg) => {
    const userId = userObj.id;
    const history = users[userId]?.history || [];
    // Limit history to 100
    const newHistory = [...history, msg].slice(-100);
    
    const updates = {
        ...userObj,
        history: newHistory,
        msgCount: (userObj.msgCount || 0) + 1,
        dailyMsgCount: (userObj.dailyMsgCount || 0) + 1,
        lastSeen: new Date().toLocaleTimeString('ru-RU'),
        lastActiveDate: new Date().toLocaleDateString()
    };
    
    // Optimistic update local
    users[userId] = updates; 
    // Async save
    await set(ref(db, `users/${userId}`), updates);
};

// Save message to Topic History (Live Chat)
const saveTopicMsg = async (threadId, msg) => {
    const tId = threadId || 'general';
    const history = topicHistory[tId] ? (Array.isArray(topicHistory[tId]) ? topicHistory[tId] : Object.values(topicHistory[tId])) : [];
    const newHistory = [...history, msg].slice(-100);
    
    topicHistory[tId] = newHistory;
    await set(ref(db, `topicHistory/${tId}`), newHistory);
};

// --- 6. AI LOGIC (Full Power) ---
const getAIResponse = async (question) => {
    if (!config.openaiApiKey) return "AI не настроен.";
    
    const context = knowledgeBase.map(k => `[${k.category}] ${k.title}: ${k.response}`).join('\n');
    
    // Personality Logic
    let tone = "Ты — Хеликс, полезный помощник.";
    let style = "Отвечай кратко.";
    let refuse = "Информации нет.";
    
    if (config.aiProfanity) {
        tone = "Ты дерзкий мужик, материшься (18+), но помогаешь.";
        refuse = "Бля, нет такой инфы.";
    } else if (config.aiPersonality === 'joker') {
        tone = "Ты шутник, отвечай с юмором.";
    } // ... add other personalities if needed, keeping it simple for now

    const systemPrompt = `
    ROLE: ${tone}
    TASK: Отвечай на вопрос, используя ТОЛЬКО контекст ниже.
    CONTEXT:
    ${context}
    
    RULES:
    1. Если нет информации в контексте, ответь: "${refuse}". НЕ ВЫДУМЫВАЙ.
    2. ${style}
    `;

    try {
        const res = await fetch(`${config.aiBaseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${config.openaiApiKey}`
            },
            body: JSON.stringify({
                model: config.aiModel,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: question }
                ],
                temperature: config.aiTemperature,
                max_tokens: config.aiMaxTokens
            })
        });
        const data = await res.json();
        return data.choices?.[0]?.message?.content || "Ошибка AI";
    } catch (e) {
        return "Ошибка соединения с AI";
    }
};

// --- 7. MAIN PROCESS UPDATE ---
const processUpdate = async (update) => {
    const msg = update.message;
    if (!msg) return;

    const chatId = msg.chat.id;
    const text = (msg.text || msg.caption || '').trim();
    const user = msg.from;
    if (user.is_bot) return;

    const isPrivate = msg.chat.type === 'private';
    const isTargetChat = String(chatId) === config.targetChatId;
    const threadId = msg.message_thread_id ? String(msg.message_thread_id) : 'general';

    // 1. Save User to CRM
    const userObj = users[user.id] || { 
        id: user.id, name: user.first_name, username: user.username, 
        role: (config.adminIds.includes(String(user.id)) ? 'admin' : 'user'),
        status: 'active', warnings: 0, joinDate: new Date().toLocaleDateString()
    };
    
    const userMsg = { 
        dir: 'in', text: text || '[Media]', type: msg.photo ? 'photo' : 'text', 
        time: new Date().toLocaleTimeString('ru-RU'), isGroup: !isPrivate 
    };
    saveUserMsg(userObj, userMsg);

    // 2. Save to Live Chat (if target chat)
    if (isTargetChat) {
        const topicMsg = { 
            user: user.first_name, text: text || '[Media]', time: new Date().toLocaleTimeString('ru-RU'), 
            isIncoming: true, type: msg.photo ? 'photo' : 'text' 
        };
        saveTopicMsg(threadId, topicMsg);
    }

    // 3. Check Commands
    let commandExecuted = false;
    const lowerText = text.toLowerCase();
    
    for (const cmd of commands) {
        let match = false;
        if (cmd.matchType === 'exact' && lowerText === cmd.trigger.toLowerCase()) match = true;
        if (cmd.matchType === 'start' && lowerText.startsWith(cmd.trigger.toLowerCase())) match = true;
        if (cmd.matchType === 'contains' && lowerText.includes(cmd.trigger.toLowerCase())) match = true;

        if (match) {
            // Check Topic/Scope
            if (cmd.allowedTopicId === 'private_only' && !isPrivate) continue;
            if (cmd.allowedTopicId && cmd.allowedTopicId !== 'private_only' && cmd.allowedTopicId !== threadId && !isPrivate) continue;

            await sendResponse(chatId, cmd.response, msg.message_id, threadId, cmd.buttons);
            
            // Log outbound msg
            if (isTargetChat) saveTopicMsg(threadId, { user: 'Bot', text: cmd.response, time: new Date().toLocaleTimeString('ru-RU'), isIncoming: false, type: 'text' });
            commandExecuted = true;
            break;
        }
    }

    // 4. AI Handling
    if (!commandExecuted && config.enableAI) {
        const isMention = lowerText.includes('хеликс') || lowerText.includes('helix') || (isPrivate && config.enablePM);
        const isDisabled = disabledAiTopics.includes(threadId);

        if (isMention && !isDisabled) {
            const question = text.replace(/хеликс|helix/gi, '').trim();
            const answer = await getAIResponse(question);
            
            await sendResponse(chatId, answer, msg.message_id, threadId);
            
            // Save Stats
            const newStat = { query: question, response: answer, time: Date.now() };
            const newAiHistory = [newStat, ...(aiStats.history || [])].slice(0, 100);
            await set(ref(db, 'aiStats'), { total: (aiStats.total || 0) + 1, history: newAiHistory });

            // Log outbound
            if (isTargetChat) saveTopicMsg(threadId, { user: 'Bot', text: answer, time: new Date().toLocaleTimeString('ru-RU'), isIncoming: false, type: 'text' });
        }
    }
};

// --- 8. CALENDAR CHECKER (1 min loop) ---
// Fixes "Triple Message" bug by checking if already sent
const checkCalendar = async () => {
    if (!config.enableCalendarAlerts) return;
    
    const now = new Date();
    const currentHour = now.getHours().toString().padStart(2, '0');
    const currentMinute = now.getMinutes().toString().padStart(2, '0');
    const timeStr = `${currentHour}:${currentMinute}`;
    const dateStr = now.toISOString().split('T')[0];

    const updatedEvents = [];
    let hasChanges = false;

    for (const event of calendarEvents) {
        const notifyDate = event.notifyDate || event.startDate;
        const notifyTime = event.notifyTime || '09:00';

        // Check if time matches AND not already sent today
        if (notifyDate === dateStr && notifyTime === timeStr && !event.sent) {
            const msg = `⚡️ <b>${event.title}</b>\n\n📅 <b>Даты:</b> ${event.startDate} — ${event.endDate}\n📂 ${event.category}\n\n${event.description}`;
            
            await sendResponse(config.targetChatId, msg, null, event.topicId !== 'general' ? event.topicId : null, event.buttons);
            console.log(`[CALENDAR] Sent event: ${event.title}`);
            
            // MARK AS SENT
            updatedEvents.push({ ...event, sent: true });
            hasChanges = true;
        } else {
            // Reset 'sent' flag if date passed (for recurring logic if needed, but for now simple)
            // Or simply keep it. Here we just keep existing state.
            updatedEvents.push(event);
        }
    }

    if (hasChanges) {
        await set(ref(db, 'calendarEvents'), updatedEvents);
    }
};

// --- 9. SERVER LOOP ---
const startServer = async () => {
    setInterval(() => {
        // Heartbeat for frontend
        set(ref(db, 'status/heartbeat'), Date.now());
        
        // Calendar check
        if (isBotActive) checkCalendar();
    }, 60000); // Every minute

    // Polling Loop
    while (true) {
        if (isBotActive && config.token) {
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
                    // Clean processed set
                    if (processedUpdates.size > 2000) processedUpdates.clear();
                }
            } catch (e) {
                console.error("Polling error", e);
                await new Promise(r => setTimeout(r, 5000));
            }
        } else {
            // Wait if bot paused
            await new Promise(r => setTimeout(r, 2000));
        }
    }
};

// Wait for initial config load
setTimeout(startServer, 3000);
