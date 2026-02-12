
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, update as firebaseUpdate, get, remove } from "firebase/database";
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
    
    // Daily Reset & Top (at 00:00 MSK)
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

    // Calendar Notifications
    if (state.config.enableCalendarAlerts && Date.now() - lastCalendarCheck > 55000) {
        lastCalendarCheck = Date.now();
        await checkCalendarEvents(mskTime);
    }
}, 30000); 

const checkCalendarEvents = async (mskDate) => {
    const todayStr = mskDate.toISOString().split('T')[0]; 
    const timeStr = mskDate.toTimeString().slice(0, 5); 

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
// 5. AI LOGIC
// ==========================================
const getAIResponse = async (question, userName) => {
    let { aiBaseUrl, aiModel, aiPersonality, aiProfanity, customProfanityList, aiStrictness, aiBehavior } = state.config;
    
    let apiKeyToUse = "";
    try {
        const configSnap = await get(ref(db, 'config'));
        apiKeyToUse = (configSnap.val()?.openaiApiKey || "").trim();
    } catch (e) { apiKeyToUse = (state.config.openaiApiKey || "").trim(); }

    if (!apiKeyToUse) return "⚠️ Ключ AI не найден.";

    const strictLevel = aiStrictness || 80;

    const kbContent = state.knowledgeBase.length > 0 
        ? state.knowledgeBase.map(k => `Q: ${k.triggers}\nA: ${k.response}`).join('\n\n')
        : "База знаний пуста.";

    const personaMap = {
        'helpful': 'Ты полезный помощник Хеликс.',
        'kind': 'Ты очень добрый и милый помощник.',
        'official': 'Ты строгий официальный бот-администратор.',
        'joker': 'Ты стендап-комик. Постоянно шути.',
        'angry': 'Ты злой бот. Отвечай с раздражением.',
        'gopnik': 'Ты гопник с района. Общайся на "ты", используй сленг.'
    };

    let sysPrompt = `Role: ${personaMap[aiPersonality] || personaMap['helpful']}\nUser Name: ${userName}\nLanguage: Russian.\n`;

    if (aiProfanity) {
        sysPrompt += `\nMODE: EXTREME PROFANITY (TOXIC).`;
        if (customProfanityList && customProfanityList.length > 0) {
             const randomWord = customProfanityList[Math.floor(Math.random() * customProfanityList.length)];
             sysPrompt += `\nTry to use this phrase: "${randomWord}".`;
        }
    }

    const noInfoPhrases = {
        'helpful': "Извините, в моей базе знаний нет информации об этом.",
        'kind': "Ой, я пока этого не знаю 🥺",
        'official': "Запрашиваемая информация отсутствует в базе данных.",
        'joker': "Слушай, я не Википедия, такого не знаю! 😂",
        'angry': "Отстань, я не знаю этого!",
        'gopnik': "Слыш, я не в курсе за эту тему, в базе пусто."
    };
    const noInfoMsg = noInfoPhrases[aiPersonality] || noInfoPhrases['helpful'];

    if (strictLevel >= 90) {
        sysPrompt += `\nCRITICAL STRICTNESS: USE ONLY DATABASE INFO. IF NOT FOUND, SAY: "${noInfoMsg}"`;
    } else {
        sysPrompt += `\nPrioritize DATABASE.`;
    }

    if (aiBehavior === 'concise') sysPrompt += " Keep it very short.";
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
                temperature: aiProfanity ? 0.8 : 0.1,
                max_tokens: 800
            })
        });

        const data = await res.json();
        if (!res.ok) return `AI Error: ${data.error?.message}`;
        return data.choices?.[0]?.message?.content || "...";
    } catch (e) { 
        return "Ошибка сети AI."; 
    }
};

// ==========================================
// 6. DATA HELPERS
// ==========================================

const ensureUserExists = async (user) => {
    if (!user || user.is_bot) return;
    const uid = String(user.id);
    const currentUser = state.users[uid];
    
    const updates = {
        id: user.id,
        name: user.first_name,
        username: user.username || '',
        lastSeen: new Date().toLocaleTimeString('ru-RU'),
        lastActiveDate: new Date().toISOString(),
    };

    if (!currentUser) {
        updates.role = 'user';
        updates.status = 'active';
        updates.joinDate = new Date().toLocaleDateString();
        updates.msgCount = 1;
        updates.dailyMsgCount = 1;
        await set(ref(db, `users/${uid}`), updates);
    } else {
        await firebaseUpdate(ref(db, `users/${uid}`), {
            ...updates,
            msgCount: (currentUser.msgCount || 0) + 1,
            dailyMsgCount: (currentUser.dailyMsgCount || 0) + 1
        });
    }
};

const saveMessage = async (msgObj, uid, threadId) => {
    // 1. Save to User CRM History
    if (uid) {
        const historyRef = ref(db, `users/${uid}/history`);
        // Get current history specifically to append safely
        try {
            const snap = await get(historyRef);
            let hist = snap.val() || [];
            if (!Array.isArray(hist)) hist = Object.values(hist);
            
            hist.push(msgObj);
            if (hist.length > 50) hist = hist.slice(-50);
            
            await set(historyRef, hist);
            
            if (msgObj.dir === 'in') {
                const unreadRef = ref(db, `users/${uid}/unreadCount`);
                const uSnap = await get(unreadRef);
                await set(unreadRef, (uSnap.val() || 0) + 1);
            }
        } catch (e) { console.error("Save CRM msg error:", e); }
    }

    // 2. Save to Topic/LiveChat History
    if (threadId) {
        const topicRef = ref(db, `topicHistory/${threadId}`);
        try {
            const snap = await get(topicRef);
            let hist = snap.val() || [];
            if (!Array.isArray(hist)) hist = Object.values(hist);
            hist.push(msgObj);
            if (hist.length > 100) hist = hist.slice(-100);
            await set(topicRef, hist);

            if (msgObj.dir === 'in') {
                const unreadRef = ref(db, `topicUnreads/${threadId}`);
                const uSnap = await get(unreadRef);
                await set(unreadRef, (uSnap.val() || 0) + 1);
            }
        } catch (e) { console.error("Save Topic msg error:", e); }
    }
};

// ==========================================
// 7. ADMIN ACTION LOGIC
// ==========================================
const executeAdminAction = async (action, msg, targetUser, targetName) => {
    const chatId = msg.chat.id;
    const targetId = targetUser.id;
    
    // Default values
    let responseVars = { target_name: targetName, warns: 0 };
    
    try {
        if (action === 'warn') {
            const userRef = ref(db, `users/${targetId}`);
            const snap = await get(userRef);
            const userData = snap.val() || {};
            let warns = (userData.warnings || 0) + 1;
            
            await firebaseUpdate(userRef, { warnings: warns });
            responseVars.warns = warns;

            if (warns >= 3) {
                 // Auto Mute/Ban logic if needed, usually Mute
                 await apiCall('restrictChatMember', {
                    chat_id: chatId,
                    user_id: targetId,
                    permissions: JSON.stringify({ can_send_messages: false }),
                    until_date: Math.floor(Date.now() / 1000) + 86400 
                });
                await firebaseUpdate(userRef, { status: 'muted' });
            }
        } 
        else if (action === 'unwarn') {
            const userRef = ref(db, `users/${targetId}`);
            const snap = await get(userRef);
            const userData = snap.val() || {};
            let warns = Math.max(0, (userData.warnings || 0) - 1);
            await firebaseUpdate(userRef, { warnings: warns });
            responseVars.warns = warns;
        }
        else if (action === 'mute') {
            await apiCall('restrictChatMember', {
                chat_id: chatId,
                user_id: targetId,
                permissions: JSON.stringify({ can_send_messages: false }),
                until_date: Math.floor(Date.now() / 1000) + 86400 
            });
            await firebaseUpdate(ref(db, `users/${targetId}`), { status: 'muted' });
        }
        else if (action === 'unmute') {
            await apiCall('restrictChatMember', {
                chat_id: chatId,
                user_id: targetId,
                permissions: JSON.stringify({ 
                    can_send_messages: true,
                    can_send_media_messages: true,
                    can_send_polls: true,
                    can_send_other_messages: true,
                    can_add_web_page_previews: true,
                    can_invite_users: true
                })
            });
            await firebaseUpdate(ref(db, `users/${targetId}`), { status: 'active' });
        }
        else if (action === 'ban') {
            await apiCall('banChatMember', { chat_id: chatId, user_id: targetId });
            await firebaseUpdate(ref(db, `users/${targetId}`), { status: 'banned' });
        }
        else if (action === 'unban') {
            await apiCall('unbanChatMember', { chat_id: chatId, user_id: targetId, only_if_banned: true });
            await firebaseUpdate(ref(db, `users/${targetId}`), { status: 'active', warnings: 0 });
        }
    } catch (e) {
        console.error("Admin Action Error:", e);
    }
    return responseVars;
};


// ==========================================
// 8. MAIN LOGIC (PROCESS UPDATE)
// ==========================================
const processUpdate = async (upd) => {
    try {
        const m = upd.message;
        if (!m) return;

        const cid = String(m.chat.id);
        const user = m.from;
        const isPrivate = m.chat.type === 'private';
        const threadId = m.message_thread_id ? String(m.message_thread_id) : (isPrivate ? String(user.id) : 'general');

        // 1. HANDLE LEFT MEMBERS (Delete from DB)
        if (m.left_chat_member) {
            const leftUid = String(m.left_chat_member.id);
            await remove(ref(db, `users/${leftUid}`));
            return;
        }

        // 2. REGISTER GROUP
        if (!isPrivate) {
            const correctId = String(m.chat.id);
            if (!state.groups[correctId]) {
                 await set(ref(db, `groups/${correctId}`), { id: m.chat.id, title: m.chat.title, isDisabled: false, lastActive: new Date().toLocaleDateString() });
            }
            if (state.groups[correctId]?.isDisabled) return;
        }

        // 3. REGISTER USER & LOG MESSAGE
        if (user && !user.is_bot) {
            await ensureUserExists(user);

            // Welcome New Members
            if (m.new_chat_members) {
                 const welcome = state.commands.find(c => c.trigger === '_welcome_');
                 if (welcome) {
                    for (const member of m.new_chat_members) {
                        if (member.is_bot) continue;
                        await ensureUserExists(member);
                        let text = welcome.response.replace(/{user}/g, `<a href="tg://user?id=${member.id}">${member.first_name}</a>`).replace(/{name}/g, member.first_name);
                        const kb = welcome.buttons?.length > 0 ? { inline_keyboard: welcome.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;
                        
                        if (welcome.mediaUrl) {
                            await apiCall('sendPhoto', { chat_id: cid, photo: welcome.mediaUrl, caption: text, parse_mode: 'HTML', reply_markup: kb, message_thread_id: threadId!=='general'?threadId:undefined });
                        } else {
                            await apiCall('sendMessage', { chat_id: cid, text: text, parse_mode: 'HTML', reply_markup: kb, message_thread_id: threadId!=='general'?threadId:undefined });
                        }
                    }
                 }
            }

            // Save Message to DB
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

        if (!state.isBotActive) return;

        // 4. COMMANDS & AI
        if (!m.text || user.is_bot) return;
        const txt = m.text.trim();
        const lowerTxt = txt.toLowerCase();

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

                if (cmd.allowedTopicId) {
                    if (cmd.allowedTopicId === 'private_only' && !isPrivate) continue;
                    if (cmd.allowedTopicId !== 'private_only' && cmd.allowedTopicId !== String(threadId) && cmd.allowedTopicId !== 'general' && !isPrivate) continue;
                }

                let resp = cmd.response.replace(/{user}/g, user.first_name).replace(/{name}/g, user.first_name);
                
                // --- ADMIN LOGIC HANDLER ---
                if (['/warn', '_warn_', '/mute', '_mute_', '/ban', '_ban_', '/unwarn', '_unwarn_', '/unmute', '_unmute_', '/unban', '_unban_'].some(t => cmd.trigger.includes(t))) {
                    if (m.reply_to_message && m.reply_to_message.from) {
                        const targetUser = m.reply_to_message.from;
                        const targetName = targetUser.first_name;
                        
                        // Determine action based on trigger
                        let action = '';
                        if (cmd.trigger.includes('warn') && !cmd.trigger.includes('un')) action = 'warn';
                        else if (cmd.trigger.includes('unwarn')) action = 'unwarn';
                        else if (cmd.trigger.includes('mute') && !cmd.trigger.includes('un')) action = 'mute';
                        else if (cmd.trigger.includes('unmute')) action = 'unmute';
                        else if (cmd.trigger.includes('ban') && !cmd.trigger.includes('un')) action = 'ban';
                        else if (cmd.trigger.includes('unban')) action = 'unban';

                        if (action) {
                            const vars = await executeAdminAction(action, m, targetUser, targetName);
                            resp = resp.replace(/{target_name}/g, `<a href="tg://user?id=${targetUser.id}">${vars.target_name}</a>`)
                                       .replace(/{warns}/g, vars.warns);
                        }
                    } else {
                        // If no reply, ignore or send help? For now, we continue but won't execute logic.
                        // Or better: return to prevent spam if misused
                        if (!isPrivate) return; 
                    }
                }
                
                // Generic Warning display for self-check
                if (resp.includes('{warns}')) {
                    const currentWarns = dbUser?.warnings || 0;
                    resp = resp.replace(/{warns}/g, currentWarns);
                }

                const kb = cmd.buttons?.length > 0 ? { inline_keyboard: cmd.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;
                const targetThread = threadId !== 'general' ? threadId : undefined;

                if (cmd.mediaUrl) {
                    await apiCall('sendPhoto', { chat_id: cid, photo: cmd.mediaUrl, caption: resp, parse_mode: 'HTML', reply_markup: kb, message_thread_id: targetThread });
                } else {
                    await apiCall('sendMessage', { chat_id: cid, text: resp, parse_mode: 'HTML', reply_markup: kb, message_thread_id: targetThread });
                }
                
                await saveMessage({
                    dir: 'out',
                    text: `[CMD] ${cmd.trigger}`,
                    type: 'text',
                    time: new Date().toLocaleTimeString('ru-RU'),
                    timestamp: Date.now(),
                    isIncoming: false,
                    isGroup: !isPrivate,
                    user: 'Bot'
                }, String(user.id), threadId);
                return;
            }
        }

        // Check AI
        if (state.config.enableAI) {
            const isHelixTrigger = lowerTxt.startsWith('хеликс') || lowerTxt.startsWith('helix');
            
            if (isHelixTrigger) {
                if (state.disabledAiTopics && state.disabledAiTopics.includes(String(threadId))) return;

                const q = txt.replace(/^(хеликс|helix)/i, '').trim();
                if (q) {
                    const a = await getAIResponse(q, user.first_name);
                    
                    await apiCall('sendMessage', { 
                        chat_id: cid, 
                        text: a, 
                        reply_to_message_id: m.message_id, 
                        message_thread_id: threadId !== 'general' ? threadId : undefined 
                    });

                    await saveMessage({
                        dir: 'out',
                        text: a,
                        type: 'text',
                        time: new Date().toLocaleTimeString('ru-RU'),
                        timestamp: Date.now(),
                        isIncoming: false,
                        isGroup: !isPrivate,
                        user: 'Helix AI'
                    }, String(user.id), threadId);
                    
                    const newStat = { query: q, response: a, time: Date.now() };
                    const statsRef = ref(db, 'aiStats');
                    const statsSnap = await get(statsRef);
                    let stats = statsSnap.val() || { total: 0, history: [] };
                    if(!stats.history) stats.history = [];
                    if(!Array.isArray(stats.history)) stats.history = Object.values(stats.history);
                    stats.history.push(newStat);
                    stats.total = (stats.total || 0) + 1;
                    if(stats.history.length > 200) stats.history = stats.history.slice(-200);
                    await set(statsRef, stats);
                }
            }
        }

    } catch (e) { console.error("Process error:", e); }
};

const start = async () => {
    console.log("Bot Server Started.");
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
            } catch (e) { 
                console.error("Loop error:", e);
                await new Promise(r => setTimeout(r, 5000)); 
            }
        } else { await new Promise(r => setTimeout(r, 2000)); }
    }
};
start();
