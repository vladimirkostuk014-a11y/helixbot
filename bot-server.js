
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, update as firebaseUpdate, get, remove } from "firebase/database";
import fetch from 'node-fetch';
import { FormData } from 'formdata-node';

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
sync('groups', 'groups');
sync('commands', 'commands', true);
sync('knowledgeBase', 'knowledgeBase', true);
sync('topicNames', 'topicNames');
sync('aiStats', 'aiStats');
sync('disabledAiTopics', 'disabledAiTopics', true);
onValue(ref(db, 'status/active'), (s) => state.isBotActive = s.val() !== false);

// --- HEARTBEAT ---
setInterval(() => {
    firebaseUpdate(ref(db, 'status'), { heartbeat: Date.now() });
}, 10000);

// ==========================================
// 3. API TELEGRAM (WITH ROBUST TIMEOUTS)
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
            const filename = `file.${mime.split('/')[1]}`;
            
            form.append(mediaField, buffer, filename);
            
            Object.keys(body).forEach(key => {
                if (key !== mediaField && body[key] !== undefined) {
                    const val = typeof body[key] === 'object' ? JSON.stringify(body[key]) : body[key];
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
        if (method === 'getUpdates' && (e.type === 'request-timeout' || e.code === 'ETIMEDOUT' || e.message.includes('timeout'))) {
            return { ok: false, ignore: true };
        }
        console.error(`API Error (${method}):`, e.message);
        return { ok: false, description: e.message }; 
    }
};

// ==========================================
// 4. DAILY TOP SCHEDULER (00:00 MSK)
// ==========================================
setInterval(async () => {
    const now = new Date();
    // MSK is UTC+3
    const mskHours = (now.getUTCHours() + 3) % 24;
    
    if (mskHours === 0 && now.getMinutes() === 0) {
        if (!dailyTopSent && state.config.enableAutoTop) {
            console.log("[Scheduler] Triggering Daily Top at 00:00 MSK");
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

    for (const uid of Object.keys(state.users)) {
        await firebaseUpdate(ref(db, `users/${uid}`), { dailyMsgCount: 0 });
    }
};

// ==========================================
// 5. AI LOGIC (NO HARDCODED KEY)
// ==========================================
const getAIResponse = async (question, userName) => {
    const { openaiApiKey, aiBaseUrl, aiModel, aiPersonality, aiProfanity, customProfanityList } = state.config;
    
    // STRICTLY USE FIREBASE KEY
    if (!openaiApiKey) return "⚠️ Ключ AI не найден в настройках. Администратор должен добавить его в панели.";

    const kbContent = state.knowledgeBase.length > 0 
        ? state.knowledgeBase.map(k => `[TITLE: ${k.title}]\n${k.response}`).join('\n\n')
        : "База знаний пуста.";

    // UPDATED PROMPT: STRICT NO EMOJI POLICY (UNLESS IN KB)
    let instructions = `Role: ${state.config.botName || 'Helix'}. Personality: ${aiPersonality}. Language: Russian.
    
    CRITICAL RULES:
    1. STRICTLY FORBIDDEN: Do NOT use any emojis (like 🙂, 🔥, ✨) in your own generated text. 
    2. EXCEPTION: You MUST output emojis ONLY if they appear inside the [DATABASE] content. Copy them exactly.
    3. If answering from the database, copy the response accurately, including any custom emojis provided there.
    4. Keep answers concise.
    `;
    
    if (aiProfanity) {
        instructions += `\nMODE: TOXIC/PROFANITY. 
        - Используй грубый русский мат. 
        - Словарь: ${JSON.stringify(customProfanityList || [])}. 
        - Не извиняйся.`;
    }

    try {
        const res = await fetch(`${aiBaseUrl || 'https://api.groq.com/openai/v1'}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiApiKey}` },
            body: JSON.stringify({
                model: aiModel || "llama-3.3-70b-versatile",
                messages: [{ role: "system", content: instructions + "\n\nDATABASE:\n" + kbContent }, { role: "user", content: question }],
                temperature: 0.1, // Ultra low temperature to prevent emoji hallucinations
                max_tokens: 800
            })
        });

        const data = await res.json();
        
        if (!res.ok) {
            console.error("❌ Groq API Error:", JSON.stringify(data));
            return `AI Error (${res.status}): ${data.error?.message || 'Check Server Logs'}`;
        }

        return data.choices?.[0]?.message?.content || "AI Error (Empty).";
    } catch (e) { 
        console.error("AI Network Error:", e);
        return "Net Error."; 
    }
};

// --- HELPER: ENSURE USER EXISTS ---
const ensureUserExists = async (user) => {
    if (!user || user.is_bot) return;
    const uid = String(user.id);
    const userRef = ref(db, `users/${uid}`);
    const snap = await get(userRef);
    if (!snap.exists()) {
        await set(userRef, {
            id: user.id,
            name: user.first_name,
            username: user.username || '',
            role: 'user',
            status: 'active',
            joinDate: new Date().toLocaleDateString(),
            msgCount: 0,
            warnings: 0,
            dailyMsgCount: 0
        });
    }
};

// ==========================================
// 6. PROCESS UPDATES
// ==========================================
const processUpdate = async (upd) => {
    try {
        const m = upd.message;
        if (!m) return;

        const cid = String(m.chat.id);
        const user = m.from;
        const threadId = m.message_thread_id ? String(m.message_thread_id) : 'general';
        const isPrivate = m.chat.type === 'private';

        // --- USER LEFT LOGIC (FORCE REMOVE) ---
        if (m.left_chat_member) {
            const leftUid = String(m.left_chat_member.id);
            // Always try to remove, don't check if exists to ensure cleanup
            await remove(ref(db, `users/${leftUid}`));
            console.log(`User ${leftUid} removed from DB (left chat)`);
            return; 
        }

        // --- GROUP LOGIC ---
        if (!isPrivate) {
            const correctId = String(m.chat.id);
            if (!state.groups[correctId]) {
                 await set(ref(db, `groups/${correctId}`), { id: m.chat.id, title: m.chat.title, isDisabled: false, lastActive: new Date().toLocaleDateString() });
            }
            if (state.groups[correctId]?.isDisabled) return;
        }

        // --- USER TRACKING & HISTORY ---
        let dbUserRole = 'user';
        if (user && !user.is_bot) {
            const uid = String(user.id);
            const local = state.users[uid];
            dbUserRole = local?.role || 'user';
            
            let updates = {
                name: user.first_name,
                username: user.username || '',
                lastSeen: new Date().toLocaleTimeString('ru-RU'),
                msgCount: (local?.msgCount || 0) + 1,
                dailyMsgCount: (local?.dailyMsgCount || 0) + 1
            };

            if (isPrivate && (m.text || m.caption)) {
                const msgText = m.text || m.caption || '[Media]';
                const newMsg = {
                    dir: 'in',
                    text: msgText,
                    type: m.photo ? 'photo' : (m.video ? 'video' : 'text'),
                    time: new Date().toLocaleTimeString('ru-RU'),
                    timestamp: Date.now(),
                    isIncoming: true,
                    isGroup: false,
                    user: user.first_name,
                    msgId: m.message_id
                };
                
                const history = local?.history ? Object.values(local.history) : [];
                const updatedHistory = [...history, newMsg].slice(-50);
                
                updates.history = updatedHistory;
                updates.unreadCount = (local?.unreadCount || 0) + 1;
            }

            if (!local) {
                updates.id = user.id;
                updates.role = 'user';
                updates.status = 'active';
                updates.joinDate = new Date().toLocaleDateString();
                await set(ref(db, `users/${uid}`), updates);
            } else {
                await firebaseUpdate(ref(db, `users/${uid}`), updates);
            }
        }

        // --- WELCOME MESSAGE ---
        if (m.new_chat_members) {
            const welcome = state.commands.find(c => c.trigger === '_welcome_');
            if (welcome) {
                for (const member of m.new_chat_members) {
                    if (member.is_bot) continue;
                    // Ensure new member exists in DB immediately
                    await ensureUserExists(member);

                    let text = welcome.response.replace(/{user}/g, `<a href="tg://user?id=${member.id}">${member.first_name}</a>`).replace(/{name}/g, member.first_name);
                    const kb = welcome.buttons?.length > 0 ? { inline_keyboard: welcome.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;
                    
                    if (welcome.mediaUrl) {
                        await apiCall('sendPhoto', { chat_id: cid, photo: welcome.mediaUrl, caption: text, parse_mode: 'HTML', reply_markup: kb, message_thread_id: threadId !== 'general' ? threadId : undefined });
                    } else {
                        await apiCall('sendMessage', { chat_id: cid, text, parse_mode: 'HTML', reply_markup: kb, message_thread_id: threadId !== 'general' ? threadId : undefined });
                    }
                }
            }
        }

        if (!m.text || user.is_bot || !state.isBotActive) return;
        const txt = m.text.trim();
        const lowerTxt = txt.toLowerCase();

        // --- UNWARN LOGIC (FIXED) ---
        if (lowerTxt.startsWith('/unwarn') && m.reply_to_message && dbUserRole === 'admin') {
            const target = m.reply_to_message.from;
            await ensureUserExists(target); // Ensure user is in DB

            const targetRef = ref(db, `users/${target.id}`);
            const snap = await get(targetRef);
            let val = snap.val() || { warnings: 0 };
            
            const newWarns = Math.max(0, (val.warnings || 0) - 1);
            
            await firebaseUpdate(targetRef, { warnings: newWarns });

            const cmd = state.commands.find(c => c.trigger === '_unwarn_');
            let resp = cmd ? cmd.response : "🕊 <b>{target_name}</b>, предупреждение снято. Счет: {warns}/3.";
            resp = resp.replace(/{target_name}/g, target.first_name).replace(/{warns}/g, String(newWarns));

            await apiCall('sendMessage', { 
                chat_id: cid, 
                text: resp, 
                parse_mode: 'HTML', 
                message_thread_id: threadId !== 'general' ? threadId : undefined 
            });
            return;
        }

        // --- WARN LOGIC (FIXED) ---
        if (lowerTxt.startsWith('/warn') && m.reply_to_message && dbUserRole === 'admin') {
            const target = m.reply_to_message.from;
            await ensureUserExists(target); // Ensure user is in DB

            const targetRef = ref(db, `users/${target.id}`);
            const snap = await get(targetRef);
            let val = snap.val() || { warnings: 0 };
            
            const newWarns = (val.warnings || 0) + 1;
            let status = val.status || 'active';

            // MUTE LOGIC (3/3)
            if (newWarns >= 3) {
                status = 'muted';
                // Mute for 24 hours
                await apiCall('restrictChatMember', { 
                    chat_id: cid, 
                    user_id: target.id, 
                    permissions: JSON.stringify({ can_send_messages: false }), 
                    until_date: Math.floor(Date.now()/1000) + 86400 
                });
            }

            await firebaseUpdate(targetRef, { warnings: newWarns, status: status });

            const cmd = state.commands.find(c => c.trigger === '_warn_');
            let resp = cmd ? cmd.response : "⚠️ <b>{target_name}</b>, вам выдано предупреждение. Счет: {warns}/3.";
            resp = resp.replace(/{target_name}/g, target.first_name).replace(/{warns}/g, String(newWarns));

            if (newWarns >= 3) {
                resp += "\n🛑 <b>Достигнут лимит!</b> Вы заглушены на 24 часа.";
            }

            await apiCall('sendMessage', { 
                chat_id: cid, 
                text: resp, 
                parse_mode: 'HTML', 
                message_thread_id: threadId !== 'general' ? threadId : undefined 
            });
            return;
        }

        // --- BAN/UNBAN LOGIC ---
        if (lowerTxt.startsWith('/ban') && dbUserRole === 'admin' && m.reply_to_message) {
             const target = m.reply_to_message.from;
             await ensureUserExists(target);
             await firebaseUpdate(ref(db, `users/${target.id}`), { status: 'banned' });
             await apiCall('banChatMember', { chat_id: cid, user_id: target.id });
             await apiCall('sendMessage', { chat_id: cid, text: `⛔️ <b>${target.first_name}</b> забанен.`, parse_mode: 'HTML' });
             return;
        }

        // --- CUSTOM COMMANDS ---
        for (const cmd of state.commands) {
            let match = false;
            if (cmd.matchType === 'exact') match = lowerTxt === cmd.trigger.toLowerCase();
            else if (cmd.matchType === 'start') match = lowerTxt.startsWith(cmd.trigger.toLowerCase());
            else if (cmd.matchType === 'contains') match = lowerTxt.includes(cmd.trigger.toLowerCase());

            if (match) {
                if (cmd.isSystem && dbUserRole !== 'admin') continue;
                
                const hasRole = cmd.allowedRoles ? cmd.allowedRoles.includes(dbUserRole) : true;
                if (!hasRole) continue;

                if (cmd.allowedTopicId && cmd.allowedTopicId !== 'private_only' && cmd.allowedTopicId !== String(threadId) && !isPrivate) continue;
                if (cmd.allowedTopicId === 'private_only' && !isPrivate) continue;

                let resp = cmd.response.replace(/{user}/g, user.first_name).replace(/{name}/g, user.first_name);
                const kb = cmd.buttons?.length > 0 ? { inline_keyboard: cmd.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;
                
                const targetThread = threadId !== 'general' ? threadId : undefined;

                if (cmd.mediaUrl) {
                    await apiCall('sendPhoto', { chat_id: cid, photo: cmd.mediaUrl, caption: resp, parse_mode: 'HTML', reply_markup: kb, message_thread_id: targetThread });
                } else {
                    await apiCall('sendMessage', { chat_id: cid, text: resp, parse_mode: 'HTML', reply_markup: kb, message_thread_id: targetThread });
                }
                return;
            }
        }

        // --- AI ---
        if (state.config.enableAI) {
            const isHelixTrigger = lowerTxt.startsWith('хеликс') || lowerTxt.startsWith('helix');
            if (isPrivate || isHelixTrigger) {
                const q = txt.replace(/^(хеликс|helix)/i, '').trim();
                if (q) {
                    const a = await getAIResponse(q, user.first_name);
                    await apiCall('sendMessage', { chat_id: cid, text: a, reply_to_message_id: m.message_id, message_thread_id: threadId !== 'general' ? threadId : undefined });
                }
            }
        }

    } catch (e) { console.error("Process error:", e); }
};

const start = async () => {
    console.log("Bot Server Started. Waiting for updates...");
    while (true) {
        if (state.config.token) {
            try {
                // Use a longer timeout for getUpdates (50s) to keep connection open (Long Polling)
                const res = await apiCall('getUpdates', { offset: lastUpdateId + 1, timeout: 50 });
                if (res?.ok && res.result.length > 0) {
                    for (const u of res.result) {
                        lastUpdateId = u.update_id;
                        await processUpdate(u);
                    }
                }
            } catch (e) { 
                console.error("Loop error:", e);
                await new Promise(r => setTimeout(r, 5000)); 
            }
        } else { await new Promise(r => setTimeout(r, 2000)); }
    }
};
start();
