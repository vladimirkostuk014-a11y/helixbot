
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
// 3. API TELEGRAM (FIXED FOR MEDIA)
// ==========================================
const apiCall = async (method, body) => {
    if (!state.config.token) return;
    
    try {
        let options = {
            method: 'POST',
            timeout: 30000
        };

        // Проверяем наличие медиа в формате Base64 (начинается с data:)
        const mediaField = body.photo ? 'photo' : (body.video ? 'video' : null);
        const hasBase64 = mediaField && typeof body[mediaField] === 'string' && body[mediaField].startsWith('data:');

        if (hasBase64) {
            const form = new FormData();
            
            // Конвертируем Base64 в Buffer
            const base64Data = body[mediaField].split(',')[1];
            const mimeMatch = body[mediaField].match(/:(.*?);/);
            const mime = mimeMatch ? mimeMatch[1] : (mediaField === 'video' ? 'video/mp4' : 'image/jpeg');
            const buffer = Buffer.from(base64Data, 'base64');
            const filename = `file.${mime.split('/')[1]}`;
            
            form.append(mediaField, buffer, filename);
            
            // Добавляем остальные поля
            Object.keys(body).forEach(key => {
                if (key !== mediaField && body[key] !== undefined) {
                    const val = typeof body[key] === 'object' ? JSON.stringify(body[key]) : body[key];
                    form.append(key, val);
                }
            });
            
            options.body = form;
            // Headers для FormData ставятся автоматически node-fetch/formdata-node
        } else {
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify(body);
        }

        const res = await fetch(`https://api.telegram.org/bot${state.config.token}/${method}`, options);
        return await res.json();
    } catch (e) { 
        console.error(`API Error (${method}):`, e.message);
        return { ok: false, description: e.message }; 
    }
};

// --- HELPER: LOG BOT RESPONSE TO DB ---
const logBotMessage = async (userId, text, type = 'text') => {
    if (!userId) return;
    try {
        const userRef = ref(db, `users/${userId}`);
        const snap = await get(userRef);
        if (snap.exists()) {
            const d = snap.val();
            const newMsg = {
                dir: 'out',
                text: text,
                type: type,
                time: new Date().toLocaleTimeString('ru-RU'),
                timestamp: Date.now(),
                isIncoming: false,
                isGroup: false, 
                user: state.config.botName || 'Bot'
            };
            const history = d.history ? Object.values(d.history) : [];
            const updatedHistory = [...history, newMsg].slice(-50);
            await firebaseUpdate(userRef, { history: updatedHistory });
        }
    } catch (e) { console.error("Log bot msg error", e); }
};

// ==========================================
// 4. DAILY TOP SCHEDULER (00:00 MSK)
// ==========================================
setInterval(async () => {
    const now = new Date();
    // MSK is UTC+3
    const mskHours = (now.getUTCHours() + 3) % 24;
    
    // Проверка на 00:00
    if (mskHours === 0 && now.getMinutes() === 0) {
        if (!dailyTopSent && state.config.enableAutoTop) {
            console.log("[Scheduler] Triggering Daily Top at 00:00 MSK");
            await sendDailyTop();
            dailyTopSent = true;
        }
    } else {
        dailyTopSent = false;
    }
}, 30000); // Check every 30s

const sendDailyTop = async () => {
    if (!state.config.targetChatId) return;

    const sortedUsers = Object.values(state.users)
        .filter(u => u.dailyMsgCount > 0)
        .sort((a, b) => b.dailyMsgCount - a.dailyMsgCount)
        .slice(0, 10);

    const topCommand = state.commands.find(c => c.trigger === '_daily_top_');
    
    // Если никого не было и команды нет - выходим. Если команда есть - можем отправить пустой топ.
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

    // Если есть команда, используем её шаблон. Иначе дефолт.
    let resp = topCommand ? topCommand.response : "🏆 <b>Топ активных участников за день:</b>\n\n{top_list}";
    // Заменяем плейсхолдер {top_list}
    resp = resp.replace(/{top_list}/g, listStr);

    const kb = topCommand?.buttons?.length > 0 ? { inline_keyboard: topCommand.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;
    const tid = topCommand?.notificationTopicId && topCommand.notificationTopicId !== 'general' ? topCommand.notificationTopicId : undefined;

    if (topCommand?.mediaUrl) {
        await apiCall('sendPhoto', { chat_id: state.config.targetChatId, photo: topCommand.mediaUrl, caption: resp, parse_mode: 'HTML', reply_markup: kb, message_thread_id: tid });
    } else {
        await apiCall('sendMessage', { chat_id: state.config.targetChatId, text: resp, parse_mode: 'HTML', reply_markup: kb, message_thread_id: tid });
    }

    // Сброс счетчиков
    for (const uid of Object.keys(state.users)) {
        await firebaseUpdate(ref(db, `users/${uid}`), { dailyMsgCount: 0 });
    }
};

// ==========================================
// 5. AI LOGIC
// ==========================================
const getAIResponse = async (question, userName) => {
    const { openaiApiKey, aiBaseUrl, aiModel, aiPersonality, aiProfanity, aiStrictness, customProfanityList } = state.config;
    if (!openaiApiKey) return "⚠️ Ключ AI не найден.";

    const kbContent = state.knowledgeBase.length > 0 
        ? state.knowledgeBase.map(k => `[TITLE: ${k.title}]\n${k.response}`).join('\n\n')
        : "База знаний пуста.";

    let instructions = `Role: ${state.config.botName || 'Helix'}. Personality: ${aiPersonality}. Language: Russian. `;
    
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
                temperature: aiProfanity ? 0.9 : 0.5,
                max_tokens: 800
            })
        });
        const data = await res.json();
        return data.choices?.[0]?.message?.content || "AI Error.";
    } catch (e) { return "Net Error."; }
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

        // --- GROUP LOGIC ---
        if (!isPrivate) {
            const correctId = String(m.chat.id);
            if (!state.groups[correctId]) {
                 await set(ref(db, `groups/${correctId}`), { id: m.chat.id, title: m.chat.title, isDisabled: false, lastActive: new Date().toLocaleDateString() });
            }
            if (state.groups[correctId]?.isDisabled) return;
        }

        // --- USER TRACKING ---
        let dbUserRole = 'user';
        if (user && !user.is_bot) {
            const uid = String(user.id);
            const local = state.users[uid];
            dbUserRole = local?.role || 'user';
            
            const updates = {
                name: user.first_name,
                username: user.username || '',
                lastSeen: new Date().toLocaleTimeString('ru-RU'),
                msgCount: (local?.msgCount || 0) + 1,
                dailyMsgCount: (local?.dailyMsgCount || 0) + 1
            };
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
            const targetRef = ref(db, `users/${target.id}`);
            const snap = await get(targetRef);
            let val = snap.val() || { warnings: 0 };
            
            // Уменьшаем счетчик
            const newWarns = Math.max(0, (val.warnings || 0) - 1);
            await firebaseUpdate(targetRef, { warnings: newWarns });

            // Ищем шаблон ответа для _unwarn_ или берем дефолтный
            const cmd = state.commands.find(c => c.trigger === '_unwarn_');
            let resp = cmd ? cmd.response : "🕊 <b>{target_name}</b>, предупреждение снято. Счет: {warns}/3.";
            
            // Заменяем переменные
            resp = resp.replace(/{target_name}/g, target.first_name).replace(/{warns}/g, String(newWarns));

            await apiCall('sendMessage', { 
                chat_id: cid, 
                text: resp, 
                parse_mode: 'HTML', 
                message_thread_id: threadId !== 'general' ? threadId : undefined 
            });
            return;
        }

        // --- WARN LOGIC ---
        if (lowerTxt.startsWith('/warn') && m.reply_to_message && dbUserRole === 'admin') {
            const target = m.reply_to_message.from;
            const targetRef = ref(db, `users/${target.id}`);
            const snap = await get(targetRef);
            let val = snap.val() || { warnings: 0 };
            
            const newWarns = (val.warnings || 0) + 1;
            await firebaseUpdate(targetRef, { warnings: newWarns });

            const cmd = state.commands.find(c => c.trigger === '_warn_');
            let resp = cmd ? cmd.response : "⚠️ <b>{target_name}</b>, вам выдано предупреждение. Счет: {warns}/3.";
            resp = resp.replace(/{target_name}/g, target.first_name).replace(/{warns}/g, String(newWarns));

            if (newWarns >= 3) {
                await apiCall('restrictChatMember', { 
                    chat_id: cid, 
                    user_id: target.id, 
                    permissions: JSON.stringify({ can_send_messages: false }), 
                    until_date: Math.floor(Date.now()/1000) + 86400 
                });
                await firebaseUpdate(targetRef, { warnings: 0, status: 'muted' });
                resp += "\n🛑 Пользователь заглушен на 24 часа.";
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
                
                // Permission Check
                const hasRole = cmd.allowedRoles ? cmd.allowedRoles.includes(dbUserRole) : true;
                if (!hasRole) continue;

                // Topic Check
                if (cmd.allowedTopicId && cmd.allowedTopicId !== 'private_only' && cmd.allowedTopicId !== String(threadId) && !isPrivate) continue;
                if (cmd.allowedTopicId === 'private_only' && !isPrivate) continue;

                let resp = cmd.response.replace(/{user}/g, user.first_name).replace(/{name}/g, user.first_name);
                const kb = cmd.buttons?.length > 0 ? { inline_keyboard: cmd.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;
                
                // Используем message_thread_id только если это не general
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
    console.log("Bot Server Started");
    while (true) {
        if (state.config.token) {
            try {
                const res = await apiCall('getUpdates', { offset: lastUpdateId + 1, timeout: 30 });
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
