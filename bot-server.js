
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
    // MSK is UTC+3. 
    const mskHours = (now.getUTCHours() + 3) % 24;
    
    // Check if it is 00:00 MSK (allowing a 1-minute window)
    if (mskHours === 0 && now.getMinutes() === 0) {
        if (!dailyTopSent && state.config.enableAutoTop) {
            await sendDailyTop();
            dailyTopSent = true;
        }
    } else {
        dailyTopSent = false;
    }
}, 30000); // Check every 30 seconds

const sendDailyTop = async () => {
    if (!state.config.targetChatId) return;

    // 1. Get Users sorted by dailyMsgCount
    const sortedUsers = Object.values(state.users)
        .filter(u => u.dailyMsgCount > 0)
        .sort((a, b) => b.dailyMsgCount - a.dailyMsgCount)
        .slice(0, 10);

    if (sortedUsers.length > 0) {
        // 2. Form Message
        const topCommand = state.commands.find(c => c.trigger === '_daily_top_');
        let title = topCommand ? topCommand.response : "🏆 <b>Топ активных участников за день:</b>";
        
        let msg = `${title}\n\n`;
        sortedUsers.forEach((u, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
            msg += `${medal} <b>${u.name}</b>: ${u.dailyMsgCount} сбщ.\n`;
        });

        // 3. Send
        await apiCall('sendMessage', {
            chat_id: state.config.targetChatId,
            text: msg,
            parse_mode: 'HTML',
            message_thread_id: topCommand?.notificationTopicId && topCommand.notificationTopicId !== 'general' ? topCommand.notificationTopicId : undefined
        });
    }

    // 4. Reset Daily Counters
    // Batch update via root (requires careful path construction, doing loop for safety here)
    for (const uid of Object.keys(state.users)) {
        await firebaseUpdate(ref(db, `users/${uid}`), { dailyMsgCount: 0 });
    }
    console.log('[Scheduler] Daily Top sent and counters reset.');
};

// ==========================================
// 5. AI LOGIC
// ==========================================
const getAIResponse = async (question, userName) => {
    const { openaiApiKey, aiBaseUrl, aiModel, aiPersonality, aiProfanity, aiStrictness, customProfanityList } = state.config;
    if (!openaiApiKey) return "⚠️ Ключ AI не найден.";

    const kbContent = state.knowledgeBase.length > 0 
        ? state.knowledgeBase.map(k => `[ТЕМА: ${k.title}]\n${k.response}`).join('\n\n')
        : "База знаний пуста.";

    const accuracy = aiStrictness || 80;
    const temp = accuracy >= 95 ? 0.0 : Math.max(0.1, 1 - (accuracy / 100));

    let strictRule = "";
    if (accuracy >= 95) {
        strictRule = `
РЕЖИМ 100% ТОЧНОСТИ (ONLY FACTS):
- Твой единственный источник информации — раздел [KNOWLEDGE BASE] ниже.
- ТЕБЕ ЗАПРЕЩЕНО использовать свои встроенные знания или придумывать факты.
- Если ответа нет в [KNOWLEDGE BASE], ты ОБЯЗАН ответить: "Информации нет в базе" (в стиле своего персонажа).`;
    } else {
        strictRule = "Приоритет — База Знаний. Если информации нет, используй общие знания.";
    }

    let profanityRule = "";
    if (aiProfanity && customProfanityList && customProfanityList.length > 0) {
        profanityRule = `ВАЖНОЕ ПРАВИЛО (РЕЖИМ МАТА): Ты ОБЯЗАН использовать в ответе слова: ${JSON.stringify(customProfanityList)}.`;
    }

    const systemPrompt = `
You are ${state.config.botName || 'Helix'}. Persona: ${aiPersonality}. Language: Russian.
${strictRule}
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
                temperature: temp,
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
    // Fix: If message_thread_id is missing, use 'general'. 
    const threadId = m.message_thread_id ? String(m.message_thread_id) : 'general';
    const isPrivate = m.chat.type === 'private';

    // --- LEFT MEMBER (AUTO DELETE) ---
    // Moved to top to ensure execution even if text is missing
    if (m.left_chat_member && !m.left_chat_member.is_bot) {
        await remove(ref(db, `users/${m.left_chat_member.id}`));
        return; // Stop processing
    }

    // --- CAPTURE USER ---
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
            const updates = {
                name: user.first_name,
                username: user.username || '',
                lastSeen: new Date().toLocaleTimeString('ru-RU'),
                msgCount: (d.msgCount || 0) + 1,
                dailyMsgCount: (d.dailyMsgCount || 0) + 1
            };
            
            // CRM HISTORY LOGIC:
            // STRICTLY Private Messages only
            if (isPrivate && m.text) {
                const newMsg = {
                    dir: 'in',
                    text: m.text,
                    type: 'text',
                    time: new Date().toLocaleTimeString('ru-RU'),
                    timestamp: Date.now(),
                    isIncoming: true,
                    isGroup: false, // Explicitly mark as not group
                    user: user.first_name
                };
                const history = d.history ? Object.values(d.history) : [];
                // Keep last 50 messages
                updates.history = [...history, newMsg].slice(-50);
                updates.unreadCount = (d.unreadCount || 0) + 1;
            }

            await firebaseUpdate(userRef, updates);
        }
    }

    // --- WELCOME (NEW MEMBERS) ---
    if (m.new_chat_members) {
        for (const member of m.new_chat_members) {
            if (member.is_bot) continue;
            
            // Ensure user exists in DB
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

            // Find _welcome_ command
            const welcome = state.commands.find(c => c.trigger === '_welcome_');
            if (welcome) {
                const nameLink = `<a href="tg://user?id=${member.id}">${member.first_name}</a>`;
                const text = welcome.response.replace(/{user}/g, nameLink).replace(/{name}/g, member.first_name);
                const kb = welcome.buttons?.length > 0 ? { inline_keyboard: welcome.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;
                
                // Determine Thread ID
                let targetThread = undefined;
                if (welcome.notificationTopicId && welcome.notificationTopicId !== 'general') {
                    targetThread = welcome.notificationTopicId;
                } else if (threadId !== 'general') {
                    targetThread = threadId;
                }

                if (welcome.mediaUrl) {
                    await apiCall('sendPhoto', { chat_id: cid, photo: welcome.mediaUrl, caption: text, parse_mode: 'HTML', reply_markup: kb, message_thread_id: targetThread });
                } else {
                    await apiCall('sendMessage', { chat_id: cid, text, parse_mode: 'HTML', reply_markup: kb, message_thread_id: targetThread });
                }
            }
        }
    }

    if (!m.text || user.is_bot || !state.isBotActive) return;

    const txt = m.text.trim();
    const lowerTxt = txt.toLowerCase();

    // --- WARN ---
    if (lowerTxt.startsWith('/warn') && m.reply_to_message) {
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
            // FIX: STRICT TOPIC RESTRICTION
            if (cmd.allowedTopicId) {
                if (cmd.allowedTopicId === 'private_only') {
                    if (!isPrivate) continue; // Command not allowed here
                } else {
                    // Check against specific topic ID (compare as strings)
                    const currentTid = threadId || 'general';
                    const allowedTid = cmd.allowedTopicId || 'general';
                    if (String(currentTid) !== String(allowedTid)) continue; // Command not allowed here
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
        // FIX: If enablePM is FALSE, we ONLY allow AI if specifically addressed (e.g. "helix ...")
        // If enablePM is TRUE, we allow everything in PM.
        const isHelixTrigger = lowerTxt.startsWith('хеликс') || lowerTxt.startsWith('helix');
        const isPMAllowed = m.chat.type === 'private' && state.config.enablePM;
        
        // If it's a PM, but enablePM is OFF, and it wasn't triggered by name -> IGNORE.
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
