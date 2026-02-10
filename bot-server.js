
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, update as firebaseUpdate, get, remove } from "firebase/database";
import fetch from 'node-fetch';

// ==========================================
// 1. КОНФИГУРАЦИЯ FIREBASE
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
let dailyTopSent = false;

// ==========================================
// 2. СИНХРОНИЗАЦИЯ
// ==========================================
const sync = (path, key, isArray = false) => {
    onValue(ref(db, path), (snapshot) => {
        const val = snapshot.val();
        if (isArray) state[key] = val ? Object.values(val) : [];
        else state[key] = val || {};
    });
};

sync('config', 'config');
sync('users', 'users');
sync('commands', 'commands', true);
sync('knowledgeBase', 'knowledgeBase', true);
sync('topicNames', 'topicNames');
sync('aiStats', 'aiStats');
sync('disabledAiTopics', 'disabledAiTopics', true);
onValue(ref(db, 'status/active'), (s) => state.isBotActive = s.val() !== false);

// --- HEARTBEAT (FIX OFFLINE STATUS) ---
setInterval(() => {
    // Updates timestamp every 10s so frontend knows bot is alive
    firebaseUpdate(ref(db, 'status'), { heartbeat: Date.now() });
}, 10000);

// ==========================================
// 3. API TELEGRAM
// ==========================================
const apiCall = async (method, body) => {
    if (!state.config.token) return;
    try {
        const res = await fetch(`https://api.telegram.org/bot${state.config.token}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return await res.json();
    } catch (e) { return { ok: false }; }
};

// ==========================================
// 4. DAILY TOP SCHEDULER (00:00 MSK)
// ==========================================
setInterval(async () => {
    const now = new Date();
    const mskHours = (now.getUTCHours() + 3) % 24;
    
    if (mskHours === 0 && now.getMinutes() === 0) {
        if (!dailyTopSent && state.config.enableAutoTop) {
            await sendDailyTop();
            dailyTopSent = true;
        }
    } else {
        dailyTopSent = false;
    }
}, 30000);

const sendDailyTop = async () => {
    if (!state.config.targetChatId) return;

    const sortedUsers = Object.values(state.users)
        .filter(u => u.dailyMsgCount > 0)
        .sort((a, b) => b.dailyMsgCount - a.dailyMsgCount)
        .slice(0, 10);

    if (sortedUsers.length > 0) {
        const topCommand = state.commands.find(c => c.trigger === '_daily_top_');
        let title = topCommand ? topCommand.response : "🏆 <b>Топ активных участников за день:</b>";
        
        let msg = `${title}\n\n`;
        sortedUsers.forEach((u, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
            msg += `${medal} <b>${u.name}</b>: ${u.dailyMsgCount} сбщ.\n`;
        });

        await apiCall('sendMessage', {
            chat_id: state.config.targetChatId,
            text: msg,
            parse_mode: 'HTML',
            message_thread_id: topCommand?.notificationTopicId && topCommand.notificationTopicId !== 'general' ? topCommand.notificationTopicId : undefined
        });
    }

    for (const uid of Object.keys(state.users)) {
        await firebaseUpdate(ref(db, `users/${uid}`), { dailyMsgCount: 0 });
    }
    console.log('[Scheduler] Daily Top sent and counters reset.');
};

// ==========================================
// 5. AI LOGIC (STRICT)
// ==========================================
const getAIResponse = async (question, userName) => {
    const { openaiApiKey, aiBaseUrl, aiModel, aiPersonality, aiProfanity, aiStrictness, customProfanityList } = state.config;
    if (!openaiApiKey) return "⚠️ Ключ AI не найден.";

    const kbContent = state.knowledgeBase.length > 0 
        ? state.knowledgeBase.map(k => `[TITLE: ${k.title} (Cat: ${k.category})]\n${k.response}`).join('\n\n')
        : "База знаний пуста.";

    const strictness = aiStrictness || 80;
    
    // Logic: 
    // If strictness >= 90: It MUST rely on context for data.
    // If strictness == 100: It ONLY answers from context, no small talk.
    
    let strictInstructions = "";
    
    if (strictness >= 90) {
        strictInstructions = `
CRITICAL INSTRUCTION (STRICTNESS LEVEL ${strictness}%):
1. You are a DATABASE ASSISTANT. You are NOT a creative writer.
2. CHECK [KNOWLEDGE BASE] BELOW FIRST.
3. IF the user asks about Game Data (Armor, Weapons, Drop Rates, Bosses, Mechanics):
   - You MUST find the exact answer in [KNOWLEDGE BASE].
   - IF NOT FOUND IN [KNOWLEDGE BASE]: You MUST say "Этой информации нет в моей базе знаний." OR "Я не знаю этого."
   - DO NOT USE OUTSIDE INTERNET KNOWLEDGE. DO NOT HALLUCINATE.
4. IF the user asks Small Talk (Hello, How are you):
   - IF STRICTNESS = 100: IGNORE or say "Я отвечаю только на вопросы по базе."
   - IF STRICTNESS < 100: Chat normally using your Persona (${aiPersonality}).
`;
    } else {
        strictInstructions = `
INSTRUCTION:
- Priority Source: [KNOWLEDGE BASE].
- If not found, you may use general knowledge, but warn the user.
`;
    }

    let profanityRule = "";
    if (aiProfanity && customProfanityList && customProfanityList.length > 0) {
        profanityRule = `USE THESE WORDS IN YOUR REPLY: ${JSON.stringify(customProfanityList)}.`;
    }

    const systemPrompt = `
Role: ${state.config.botName || 'Helix'}. 
Persona: ${aiPersonality}. 
Language: Russian.

${strictInstructions}

${profanityRule}

[KNOWLEDGE BASE]:
${kbContent}
`;

    try {
        const res = await fetch(`${aiBaseUrl || 'https://api.groq.com/openai/v1'}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiApiKey}` },
            body: JSON.stringify({
                model: aiModel || "llama-3.3-70b-versatile",
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: question }],
                temperature: strictness >= 90 ? 0.1 : 0.5, // Low temp for high strictness
                max_tokens: 800
            })
        });
        const data = await res.json();
        return data.choices?.[0]?.message?.content || "Ошибка ядра AI.";
    } catch (e) { return "Ошибка сети AI."; }
};

// ==========================================
// 6. PROCESS UPDATES
// ==========================================
const processUpdate = async (upd) => {
    const m = upd.message;
    if (!m) return;

    const cid = String(m.chat.id);
    const user = m.from;
    const threadId = m.message_thread_id ? String(m.message_thread_id) : 'general';
    const isPrivate = m.chat.type === 'private';

    if (m.left_chat_member && !m.left_chat_member.is_bot) {
        await remove(ref(db, `users/${m.left_chat_member.id}`));
        return; 
    }

    let dbUserRole = 'user'; // Default

    // --- CAPTURE USER & GET ROLE ---
    if (user && !user.is_bot) {
        const userRef = ref(db, `users/${user.id}`);
        const snapshot = await get(userRef);
        
        if (!snapshot.exists()) {
            await set(userRef, {
                id: user.id,
                name: user.first_name,
                username: user.username || '',
                status: 'active',
                role: 'user',
                joinDate: new Date().toLocaleDateString('ru-RU'),
                lastSeen: new Date().toLocaleTimeString('ru-RU'),
                msgCount: 1,
                dailyMsgCount: 1,
                warnings: 0,
                history: []
            });
        } else {
            const d = snapshot.val();
            dbUserRole = d.role || 'user'; // Get actual role from DB
            
            const updates = {
                name: user.first_name,
                username: user.username || '',
                lastSeen: new Date().toLocaleTimeString('ru-RU'),
                msgCount: (d.msgCount || 0) + 1,
                dailyMsgCount: (d.dailyMsgCount || 0) + 1
            };
            
            if (isPrivate && m.text) {
                const newMsg = {
                    dir: 'in',
                    text: m.text,
                    type: 'text',
                    time: new Date().toLocaleTimeString('ru-RU'),
                    timestamp: Date.now(),
                    isIncoming: true,
                    isGroup: false,
                    user: user.first_name
                };
                const history = d.history ? Object.values(d.history) : [];
                updates.history = [...history, newMsg].slice(-50);
                updates.unreadCount = (d.unreadCount || 0) + 1;
            }
            await firebaseUpdate(userRef, updates);
        }
    }

    // --- WELCOME ---
    if (m.new_chat_members) {
        for (const member of m.new_chat_members) {
            if (member.is_bot) continue;
            await set(ref(db, `users/${member.id}`), {
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
            const welcome = state.commands.find(c => c.trigger === '_welcome_');
            if (welcome) {
                const nameLink = `<a href="tg://user?id=${member.id}">${member.first_name}</a>`;
                const text = welcome.response.replace(/{user}/g, nameLink).replace(/{name}/g, member.first_name);
                const kb = welcome.buttons?.length > 0 ? { inline_keyboard: welcome.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;
                let targetThread = undefined;
                if (welcome.notificationTopicId && welcome.notificationTopicId !== 'general') targetThread = welcome.notificationTopicId;
                else if (threadId !== 'general') targetThread = threadId;

                if (welcome.mediaUrl) await apiCall('sendPhoto', { chat_id: cid, photo: welcome.mediaUrl, caption: text, parse_mode: 'HTML', reply_markup: kb, message_thread_id: targetThread });
                else await apiCall('sendMessage', { chat_id: cid, text, parse_mode: 'HTML', reply_markup: kb, message_thread_id: targetThread });
            }
        }
    }

    if (!m.text || user.is_bot || !state.isBotActive) return;

    const txt = m.text.trim();
    const lowerTxt = txt.toLowerCase();

    // --- WARN (ADMIN ONLY) ---
    if (lowerTxt.startsWith('/warn') && m.reply_to_message) {
        // Double check admin rights for command issuer
        if (dbUserRole !== 'admin') return; 

        const target = m.reply_to_message.from;
        const targetRef = ref(db, `users/${target.id}`);
        const snap = await get(targetRef);
        let val = snap.val() || { warnings: 0 };
        const newWarns = (val.warnings || 0) + 1;
        
        await firebaseUpdate(targetRef, { warnings: newWarns, name: target.first_name });

        if (newWarns >= 3) {
            await apiCall('restrictChatMember', {
                chat_id: cid,
                user_id: target.id,
                permissions: JSON.stringify({ can_send_messages: false }),
                until_date: Math.floor(Date.now()/1000) + 172800 
            });
            await firebaseUpdate(targetRef, { warnings: 0, status: 'muted' });
            await apiCall('sendMessage', { chat_id: cid, text: `🛑 <b>${target.first_name}</b> заглушен (3/3 варнов).`, parse_mode: 'HTML', message_thread_id: threadId });
        } else {
            await apiCall('sendMessage', { chat_id: cid, text: `⚠️ <b>${target.first_name}</b>, варн (${newWarns}/3).`, parse_mode: 'HTML', message_thread_id: threadId });
        }
        return;
    }

    // --- COMMANDS ---
    for (const cmd of state.commands) {
        let isMatch = false;
        if (cmd.matchType === 'exact') isMatch = lowerTxt === cmd.trigger.toLowerCase();
        else if (cmd.matchType === 'start') isMatch = lowerTxt.startsWith(cmd.trigger.toLowerCase());
        else if (cmd.matchType === 'contains') isMatch = lowerTxt.includes(cmd.trigger.toLowerCase());

        if (isMatch) {
            // 1. SYSTEM COMMANDS -> ADMIN ONLY
            if (cmd.isSystem && dbUserRole !== 'admin') {
                return; // Ignore if user is not admin in DB
            }

            // 2. TOPIC RESTRICTION
            if (cmd.allowedTopicId) {
                if (cmd.allowedTopicId === 'private_only') {
                    if (!isPrivate) continue; 
                } else {
                    const currentTid = threadId || 'general';
                    // String comparison to be safe
                    if (String(currentTid) !== String(cmd.allowedTopicId)) continue; 
                }
            }

            const resp = cmd.response.replace(/{user}/g, `<a href="tg://user?id=${user.id}">${user.first_name}</a>`).replace(/{name}/g, user.first_name);
            const kb = cmd.buttons?.length > 0 ? { inline_keyboard: cmd.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;
            const targetTid = cmd.notificationTopicId ? (cmd.notificationTopicId === 'general' ? undefined : cmd.notificationTopicId) : (threadId !== 'general' ? threadId : undefined);

            if (cmd.mediaUrl) {
                await apiCall('sendPhoto', { chat_id: cid, photo: cmd.mediaUrl, caption: resp, parse_mode: 'HTML', reply_markup: kb, message_thread_id: targetTid });
            } else {
                await apiCall('sendMessage', { chat_id: cid, text: resp, parse_mode: 'HTML', reply_markup: kb, message_thread_id: targetTid });
            }
            return;
        }
    }

    // --- AI ---
    if (state.config.enableAI) {
        const isHelixTrigger = lowerTxt.startsWith('хеликс') || lowerTxt.startsWith('helix');
        const isPMAllowed = m.chat.type === 'private' && state.config.enablePM;
        
        if (m.chat.type === 'private' && !state.config.enablePM && !isHelixTrigger) return;

        if ((isHelixTrigger || isPMAllowed) && !state.disabledAiTopics.includes(threadId)) {
            const q = txt.replace(/^(хеликс|helix)/i, '').trim();
            if (!q) return;
            const a = await getAIResponse(q, user.first_name);
            await apiCall('sendMessage', { chat_id: cid, text: a, reply_to_message_id: m.message_id, message_thread_id: threadId !== 'general' ? threadId : undefined });
            const h = state.aiStats.history || [];
            await set(ref(db, 'aiStats'), { total: (state.aiStats.total || 0) + 1, history: [{ query: q, response: a, time: Date.now() }, ...h].slice(0, 100) });
        }
    }
};

const start = async () => {
    while (true) {
        if (state.config.token) {
            try {
                const res = await apiCall('getUpdates', { offset: lastUpdateId + 1, timeout: 30 });
                if (res?.ok && res.result.length > 0) {
                    for (const u of res.result) {
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
start();
