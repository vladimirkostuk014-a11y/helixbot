
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, update as firebaseUpdate, get, remove, runTransaction } from "firebase/database";
import fetch from 'node-fetch';
import { FormData } from 'formdata-node';
import { Blob } from 'buffer'; 

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
    isBotActive: true,
    topicHistory: {},
    calendarEvents: []
};

let lastUpdateId = 0;
let dailyTopSent = false;
let lastCalendarCheck = 0;

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
sync('groups', 'groups');
sync('commands', 'commands', true);
sync('knowledgeBase', 'knowledgeBase', true);
sync('topicNames', 'topicNames');
sync('aiStats', 'aiStats');
sync('disabledAiTopics', 'disabledAiTopics', true);
sync('topicHistory', 'topicHistory');
sync('calendarEvents', 'calendarEvents', true);

onValue(ref(db, 'status/active'), (s) => state.isBotActive = s.val() !== false);

// --- HEARTBEAT ---
setInterval(() => {
    firebaseUpdate(ref(db, 'status'), { heartbeat: Date.now() });
}, 10000);

// ==========================================
// 3. API TELEGRAM
// ==========================================
const apiCall = async (method, body) => {
    if (!state.config.token) return;
    
    try {
        const pollTimeout = body.timeout ? (body.timeout + 10) * 1000 : 30000;
        
        let options = {
            method: 'POST',
            timeout: pollTimeout
        };

        const mediaField = body.photo ? 'photo' : (body.video ? 'video' : null);
        const hasBase64 = mediaField && typeof body[mediaField] === 'string' && body[mediaField].startsWith('data:');

        if (hasBase64) {
            const form = new FormData();
            const base64Data = body[mediaField].split(',')[1];
            const mimeMatch = body[mediaField].match(/:(.*?);/);
            const mime = mimeMatch ? mimeMatch[1] : (mediaField === 'video' ? 'video/mp4' : 'image/jpeg');
            
            const buffer = Buffer.from(base64Data, 'base64');
            const blob = new Blob([buffer], { type: mime });
            const filename = `file.${mime.split('/')[1]}`;
            
            form.append(mediaField, blob, filename);
            
            Object.keys(body).forEach(key => {
                if (key !== mediaField && body[key] !== undefined) {
                    let val = body[key];
                    if (typeof val === 'object') val = JSON.stringify(val);
                    form.append(key, val);
                }
            });
            
            options.body = form;
        } else {
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify(body);
        }

        const res = await fetch(`https://api.telegram.org/bot${state.config.token}/${method}`, options);
        return await res.json();
    } catch (e) { 
        if (method === 'getUpdates' && (e.type === 'request-timeout' || e.code === 'ETIMEDOUT')) {
            return { ok: false, ignore: true };
        }
        console.error(`API Error (${method}):`, e.message);
        return { ok: false, description: e.message }; 
    }
};

// ==========================================
// 4. SCHEDULERS
// ==========================================
setInterval(async () => {
    const now = new Date();
    const mskTime = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Moscow"}));
    const mskHours = mskTime.getHours();
    const mskMinutes = mskTime.getMinutes();
    
    if (mskHours === 0 && mskMinutes === 0) {
        if (!dailyTopSent) {
            if (state.config.enableAutoTop) await sendDailyTop();
            
            const updates = {};
            Object.keys(state.users).forEach(uid => {
                updates[`users/${uid}/dailyMsgCount`] = 0;
            });
            if (Object.keys(updates).length > 0) await firebaseUpdate(ref(db), updates);
            
            dailyTopSent = true;
        }
    } else {
        dailyTopSent = false;
    }

    if (state.config.enableCalendarAlerts && Date.now() - lastCalendarCheck > 55000) {
        lastCalendarCheck = Date.now();
        await checkCalendarEvents(mskTime);
    }
}, 30000); 

const checkCalendarEvents = async (mskDate) => {
    const y = mskDate.getFullYear();
    const m = String(mskDate.getMonth() + 1).padStart(2, '0');
    const d = String(mskDate.getDate()).padStart(2, '0');
    const hours = String(mskDate.getHours()).padStart(2, '0');
    const minutes = String(mskDate.getMinutes()).padStart(2, '0');

    const todayStr = `${y}-${m}-${d}`;
    const timeStr = `${hours}:${minutes}`;

    for (const event of state.calendarEvents) {
        if (event.notifyDate === todayStr && event.notifyTime === timeStr) {
            const msg = `⚡️ <b>${event.title}</b>\n\n` +
                        `📅 <b>Даты:</b> ${event.startDate} — ${event.endDate}\n` +
                        `📂 <i>Категория: ${event.category}</i>\n\n` +
                        `${event.description || ''}`;
            
            const kb = event.buttons && event.buttons.length > 0 
                ? { inline_keyboard: event.buttons.map(b => [{ text: b.text, url: b.url }]) }
                : undefined;

            const target = state.config.targetChatId;
            const tid = event.topicId && event.topicId !== 'general' ? event.topicId : undefined;

            if (event.mediaUrl) {
                await apiCall('sendPhoto', { chat_id: target, photo: event.mediaUrl, caption: msg, parse_mode: 'HTML', reply_markup: kb, message_thread_id: tid });
            } else {
                await apiCall('sendMessage', { chat_id: target, text: msg, parse_mode: 'HTML', reply_markup: kb, message_thread_id: tid });
            }
        }
    }
};

const sendDailyTop = async () => {
    if (!state.config.targetChatId) return;

    const sortedUsers = Object.values(state.users)
        .filter(u => u.dailyMsgCount > 0)
        .sort((a, b) => b.dailyMsgCount - a.dailyMsgCount)
        .slice(0, 10);

    const topCommand = state.commands.find(c => c.trigger === '_daily_top_');
    if (!topCommand && sortedUsers.length === 0) return;

    let listStr = "";
    if (sortedUsers.length > 0) {
        sortedUsers.forEach((u, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
            listStr += `${medal} <b>${u.name}</b>: ${u.dailyMsgCount} сбщ.\n`;
        });
    } else {
        listStr = "Сегодня никто не писал 😔";
    }

    let resp = topCommand ? topCommand.response : "🏆 <b>Топ активных участников за день:</b>\n\n{top_list}";
    resp = resp.replace(/{top_list}/g, listStr);

    const kb = topCommand?.buttons?.length > 0 ? { inline_keyboard: topCommand.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;
    const tid = topCommand?.notificationTopicId && topCommand.notificationTopicId !== 'general' ? topCommand.notificationTopicId : undefined;

    if (topCommand?.mediaUrl) {
        await apiCall('sendPhoto', { chat_id: state.config.targetChatId, photo: topCommand.mediaUrl, caption: resp, parse_mode: 'HTML', reply_markup: kb, message_thread_id: tid });
    } else {
        await apiCall('sendMessage', { chat_id: state.config.targetChatId, text: resp, parse_mode: 'HTML', reply_markup: kb, message_thread_id: tid });
    }
};

// ==========================================
// 5. AI LOGIC (IMPROVED PROFANITY)
// ==========================================
const getAIResponse = async (question, userName) => {
    let { aiBaseUrl, aiModel, aiPersonality, aiProfanity, customProfanityList, aiStrictness, aiBehavior } = state.config;
    
    let apiKeyToUse = "";
    try {
        const configSnap = await get(ref(db, 'config'));
        apiKeyToUse = (configSnap.val()?.openaiApiKey || "").trim();
    } catch (e) { apiKeyToUse = (state.config.openaiApiKey || "").trim(); }

    if (!apiKeyToUse) return "⚠️ Ключ AI не найден.";

    const kbContent = state.knowledgeBase.length > 0 
        ? state.knowledgeBase.map(k => `Q: ${k.triggers}\nA: ${k.response}`).join('\n\n')
        : "База знаний пуста.";

    const personaMap = {
        'helpful': 'Ты полезный помощник Хеликс.',
        'kind': 'Ты добрый и милый помощник.',
        'official': 'Ты строгий официальный бот.',
        'joker': 'Ты стендап-комик. Постоянно шути.',
        'angry': 'Ты злой бот. Ты ненавидишь людей.',
        'gopnik': 'Ты гопник. Общайся на "ты", используй сленг.'
    };

    let sysPrompt = `Role: ${personaMap[aiPersonality] || personaMap['helpful']}\nUser: ${userName}\nLanguage: Russian.\n`;

    if (aiProfanity) {
        sysPrompt += `\nMODE: EXTREME RUSSIAN PROFANITY & TOXICITY (МАТ).
        1. Ты ОБЯЗАН использовать жесткий русский мат в каждом предложении (бля, нахуй, сука, пиздец, ебать и т.д.).
        2. Ты должен жестко стебать пользователя, высмеивать его вопросы и тупость.
        3. Будь максимально агрессивным и неучтивым. Никаких извинений.
        4. Если чего-то не знаешь, посылай нахуй или говори, что тебе западло отвечать на такую хуйню.`;
        
        if (customProfanityList && customProfanityList.length > 0) {
             const randomWord = customProfanityList[Math.floor(Math.random() * customProfanityList.length)];
             sysPrompt += `\nОбязательно используй фразу: "${randomWord}".`;
        }
    }

    if (aiStrictness >= 90) sysPrompt += `\nStrictly use DATABASE ONLY.`;
    if (aiBehavior === 'concise') sysPrompt += " Keep it short.";
    if (aiBehavior === 'detailed') sysPrompt += " Be detailed.";

    try {
        const res = await fetch(`${aiBaseUrl || 'https://api.groq.com/openai/v1'}/chat/completions`, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json", 
                "Authorization": `Bearer ${apiKeyToUse}` 
            },
            body: JSON.stringify({
                model: aiModel || "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: sysPrompt + "\n\n[DATABASE]:\n" + kbContent },
                    { role: "user", content: question }
                ],
                temperature: aiProfanity ? 0.9 : 0.1,
                max_tokens: 800
            })
        });

        const data = await res.json();
        return data.choices?.[0]?.message?.content || "...";
    } catch (e) { return "AI Error."; }
};

// ==========================================
// 6. DATA HELPERS (FIXED RACE CONDITIONS)
// ==========================================
const ensureUserExists = async (user) => {
    if (!user || user.is_bot) return;
    const uid = String(user.id);
    const updates = {
        id: user.id,
        name: user.first_name,
        username: user.username || '',
        lastSeen: new Date().toLocaleTimeString('ru-RU'),
        lastActiveDate: new Date().toISOString(),
    };

    // FETCH FRESH DATA FROM DB (Do not rely on state.users to avoid stale overwrite)
    const userRef = ref(db, `users/${uid}`);
    const snap = await get(userRef);
    const existing = snap.val();

    if (!existing) {
        await set(userRef, { ...updates, role: 'user', status: 'active', joinDate: new Date().toLocaleDateString(), msgCount: 1, dailyMsgCount: 1 });
    } else {
        await firebaseUpdate(userRef, {
            ...updates,
            msgCount: (existing.msgCount || 0) + 1,
            dailyMsgCount: (existing.dailyMsgCount || 0) + 1
        });
    }
};

const saveMessage = async (msgObj, uid, threadId) => {
    if (uid) {
        const historyRef = ref(db, `users/${uid}/history`);
        try {
            await runTransaction(historyRef, (currentHistory) => {
                let history = currentHistory;
                if (!history) history = [];
                if (!Array.isArray(history)) history = Object.values(history);
                history.push(msgObj);
                if (history.length > 50) history = history.slice(-50);
                return history;
            });

            if (msgObj.dir === 'in') {
                const unreadRef = ref(db, `users/${uid}/unreadCount`);
                await runTransaction(unreadRef, (count) => (count || 0) + 1);
            }
        } catch (e) { console.error("CRM History Error:", e); }
    }

    if (threadId) {
        const topicRef = ref(db, `topicHistory/${threadId}`);
        try {
            await runTransaction(topicRef, (currentHistory) => {
                let history = currentHistory;
                if (!history) history = [];
                if (!Array.isArray(history)) history = Object.values(history);
                history.push(msgObj);
                if (history.length > 100) history = history.slice(-100);
                return history;
            });

            if (msgObj.dir === 'in') {
                const unreadRef = ref(db, `topicUnreads/${threadId}`);
                await runTransaction(unreadRef, (count) => (count || 0) + 1);
            }
        } catch (e) { console.error("Topic History Error:", e); }
    }
};

// ==========================================
// 8. MAIN PROCESSOR
// ==========================================
const processUpdate = async (upd) => {
    try {
        const m = upd.message;
        if (!m) return;

        const cid = String(m.chat.id);
        const user = m.from;
        const isPrivate = m.chat.type === 'private';
        const threadId = m.message_thread_id ? String(m.message_thread_id) : (isPrivate ? String(user.id) : 'general');

        if (m.left_chat_member) {
            await remove(ref(db, `users/${String(m.left_chat_member.id)}`));
            return;
        }

        if (user && !user.is_bot) {
            await ensureUserExists(user);
            if (m.text || m.caption || m.photo || m.video) {
                const msgText = m.text || m.caption || (m.photo ? '[Photo]' : '[Video]');
                const newMsg = {
                    dir: 'in',
                    text: msgText,
                    type: m.photo ? 'photo' : (m.video ? 'video' : 'text'),
                    time: new Date().toLocaleTimeString('ru-RU'),
                    timestamp: Date.now(),
                    isIncoming: true,
                    isGroup: !isPrivate, 
                    user: user.first_name,
                    userId: user.id,
                    msgId: m.message_id
                };

                if (!state.topicNames[threadId]) {
                    const topicName = isPrivate ? `${user.first_name} (ЛС)` : (m.reply_to_message?.forum_topic_created?.name || `Topic ${threadId}`);
                    await set(ref(db, `topicNames/${threadId}`), topicName);
                }
                await saveMessage(newMsg, String(user.id), threadId);
            }
        }

        if (!state.isBotActive || !m.text || user.is_bot) return;
        const txt = m.text.trim();
        const lowerTxt = txt.toLowerCase();

        // 1. Commands
        for (const cmd of state.commands) {
            let match = false;
            if (cmd.matchType === 'exact') match = lowerTxt === cmd.trigger.toLowerCase();
            else if (cmd.matchType === 'start') match = lowerTxt.startsWith(cmd.trigger.toLowerCase());
            else if (cmd.matchType === 'contains') match = lowerTxt.includes(cmd.trigger.toLowerCase());

            if (match) {
                const dbUser = state.users[String(user.id)];
                const dbUserRole = dbUser?.role || 'user';
                if (cmd.isSystem && dbUserRole !== 'admin') continue;
                
                const allowedRoles = cmd.allowedRoles || ['user', 'admin'];
                if (!allowedRoles.includes(dbUserRole)) continue;

                if (cmd.allowedTopicId && cmd.allowedTopicId !== 'private_only' && cmd.allowedTopicId !== String(threadId) && !isPrivate) continue;

                let resp = cmd.response.replace(/{user}/g, user.first_name).replace(/{warns}/g, dbUser?.warnings || 0);
                const kb = cmd.buttons?.length > 0 ? { inline_keyboard: cmd.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;

                if (cmd.mediaUrl) {
                    await apiCall('sendPhoto', { chat_id: cid, photo: cmd.mediaUrl, caption: resp, parse_mode: 'HTML', reply_markup: kb, message_thread_id: !isPrivate && threadId !== 'general' ? threadId : undefined });
                } else {
                    await apiCall('sendMessage', { chat_id: cid, text: resp, parse_mode: 'HTML', reply_markup: kb, message_thread_id: !isPrivate && threadId !== 'general' ? threadId : undefined });
                }
                
                await saveMessage({ dir: 'out', text: `[CMD] ${cmd.trigger}`, type: 'text', time: new Date().toLocaleTimeString('ru-RU'), timestamp: Date.now(), isIncoming: false, isGroup: !isPrivate, user: 'Bot' }, String(user.id), threadId);
                return;
            }
        }

        // 2. AI
        if (state.config.enableAI) {
            if (isPrivate && !state.config.enablePM) return;
            const isHelixTrigger = lowerTxt.startsWith('хеликс') || lowerTxt.startsWith('helix');
            
            if (isHelixTrigger) {
                // FIXED TOPIC CHECK
                if (state.disabledAiTopics && state.disabledAiTopics.includes(String(threadId))) return;

                const q = txt.replace(/^(хеликс|helix)/i, '').trim();
                if (q) {
                    const a = await getAIResponse(q, user.first_name);
                    await apiCall('sendMessage', { chat_id: cid, text: a, reply_to_message_id: m.message_id, message_thread_id: !isPrivate && threadId !== 'general' ? threadId : undefined });

                    await saveMessage({ dir: 'out', text: a, type: 'text', time: new Date().toLocaleTimeString('ru-RU'), timestamp: Date.now(), isIncoming: false, isGroup: !isPrivate, user: 'Helix AI' }, String(user.id), threadId);
                    
                    const statsRef = ref(db, 'aiStats');
                    await runTransaction(statsRef, (s) => {
                        if(!s) s = { total: 0, history: [] };
                        if(!s.history) s.history = [];
                        s.history.push({ query: q, response: a, time: Date.now() });
                        s.total = (s.total || 0) + 1;
                        if(s.history.length > 100) s.history = s.history.slice(-100);
                        return s;
                    });
                }
            }
        }
    } catch (e) { console.error("Update Error:", e); }
};

const start = async () => {
    console.log("Bot Server Running...");
    while (true) {
        if (state.config.token) {
            try {
                const res = await apiCall('getUpdates', { offset: lastUpdateId + 1, timeout: 50 });
                if (res?.ok && res.result.length > 0) {
                    for (const u of res.result) {
                        lastUpdateId = u.update_id;
                        await processUpdate(u);
                    }
                }
            } catch (e) { await new Promise(r => setTimeout(r, 5000)); }
        } else { await new Promise(r => setTimeout(r, 2000)); }
    }
};
start();
