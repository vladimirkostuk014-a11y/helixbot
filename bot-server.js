
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
sync('topicUnreads', 'topicUnreads');
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
// 3. API TELEGRAM (FIXED FOR MEDIA+BUTTONS)
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
                    // CRITICAL FIX: Explicitly stringify objects (like reply_markup) when using FormData
                    if (typeof val === 'object') {
                        form.append(key, JSON.stringify(val));
                    } else {
                        form.append(key, val);
                    }
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
// 4. SCHEDULERS (No Changes)
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
            Object.keys(state.users).forEach(uid => { updates[`users/${uid}/dailyMsgCount`] = 0; });
            if (Object.keys(updates).length > 0) await firebaseUpdate(ref(db), updates);
            dailyTopSent = true;
        }
    } else { dailyTopSent = false; }

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
            const msg = `⚡️ <b>${event.title}</b>\n\n📅 <b>Даты:</b> ${event.startDate} — ${event.endDate}\n📂 <i>Категория: ${event.category}</i>\n\n${event.description || ''}`;
            const kb = event.buttons && event.buttons.length > 0 ? { inline_keyboard: event.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;
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
    const sortedUsers = Object.values(state.users).filter(u => u.dailyMsgCount > 0).sort((a, b) => b.dailyMsgCount - a.dailyMsgCount).slice(0, 10);
    const topCommand = state.commands.find(c => c.trigger === '_daily_top_');
    if (!topCommand && sortedUsers.length === 0) return;

    let listStr = sortedUsers.length > 0 ? "" : "Сегодня никто не писал 😔";
    if (sortedUsers.length > 0) sortedUsers.forEach((u, index) => { listStr += `${index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1 + '.'} <b>${u.name}</b>: ${u.dailyMsgCount} сбщ.\n`; });

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
// 5. AI LOGIC (SINGLE PROMPT SYSTEM)
// ==========================================
const getAIResponse = async (question, userName) => {
    let { 
        aiBaseUrl, aiModel, aiProfanity, customProfanityList, 
        toxicPrompt, aiResponseStyle,
        aiPersonality
    } = state.config;
    
    let apiKeyToUse = "";
    try {
        const configSnap = await get(ref(db, 'config'));
        const liveConfig = configSnap.val() || {};
        apiKeyToUse = (liveConfig.openaiApiKey || "").trim();
        if (liveConfig.toxicPrompt) toxicPrompt = liveConfig.toxicPrompt;
        if (liveConfig.aiResponseStyle) aiResponseStyle = liveConfig.aiResponseStyle;
    } catch (e) { apiKeyToUse = (state.config.openaiApiKey || "").trim(); }

    if (!apiKeyToUse) return { text: "⚠️ Ключ AI не найден.", mediaId: null };

    // Inject IDs into context so AI knows which item has which media
    const kbContent = state.knowledgeBase.length > 0 
        ? state.knowledgeBase.map(k => `ЗАПИСЬ [ID: ${k.id}]:\n- Раздел: ${k.category || 'Общее'}\n- Заголовок: ${k.title || 'Нет'}\n- Ключевые слова: ${k.triggers || 'Нет'}\n- Информация: ${k.response}`).join('\n\n---\n\n')
        : "База знаний пуста.";

    let sysPrompt = `Ты — Хеликс, ИИ-ассистент по игре. Твоя ГЛАВНАЯ и ЕДИНСТВЕННАЯ задача — отвечать на вопросы по игре, используя ТОЛЬКО информацию из [DATABASE].

[АЛГОРИТМ ПОИСКА И ОТВЕТА]:
1. Когда пользователь задает вопрос (например, про "сфера", "оружие" и т.д.), ты ОБЯЗАН просмотреть ВСЕ записи в [DATABASE].
2. Внимательно проверяй поля: "Раздел", "Заголовок" и "Ключевые слова" на наличие слов из вопроса пользователя.
3. Если ты нашел совпадения (например, в разделе или ключевых словах есть слово из вопроса), ты должен рассказать ВСЁ, что написано в поле "Информация" у этих записей.
4. Если информации по вопросу в [DATABASE] НЕТ вообще — ты ОБЯЗАН ответить: "В базе знаний нет ответа на этот вопрос." или "Я не знаю, так как этого нет в базе знаний."
5. ТЕБЕ КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО выдумывать информацию, брать её из своих общих знаний или додумывать то, чего нет в [DATABASE]. Ты отвечаешь ТОЛЬКО по игре и ТОЛЬКО по базе знаний.
6. Если с тобой просто здороваются ("Привет", "Как дела"), ты можешь ответить дружелюбно, но как только звучит вопрос — строго ищи в базе.
7. ЗАПРЕЩЕНО использовать жирный текст (bold).
8. НЕ УПОМИНАЙ внутренние технические теги (ID, Раздел и т.д.) в своих ответах, просто выдавай саму информацию.

Имя пользователя: ${userName}`;

    if (kbContent === "База знаний пуста.") {
        sysPrompt += `\n\nВНИМАНИЕ: База знаний пуста. Сообщай об этом пользователю при попытке получить информацию.`;
    }

    // 2.1 Response Style
    const style = aiResponseStyle || 'auto';
    if (style === 'brief') {
        sysPrompt += `\n\n[СТИЛЬ]: Отвечай максимально кратко, без лишних слов.`;
    } else if (style === 'detailed') {
        sysPrompt += `\n\n[СТИЛЬ]: Отвечай максимально подробно и развернуто.`;
    }

    // 2.2 Personality
    const personality = aiPersonality || 'helpful';
    if (personality === 'teacher') {
        sysPrompt += `\n\n[ЛИЧНОСТЬ]: Ты — терпеливый учитель. Объясняй информацию из базы знаний доходчиво и структурировано.`;
    } else if (personality === 'sarcastic') {
        sysPrompt += `\n\n[ЛИЧНОСТЬ]: Ты — саркастичный и остроумный собеседник. Можешь подшучивать над пользователем, но при этом выдавать точную информацию из базы.`;
    } else if (personality === 'tech') {
        sysPrompt += `\n\n[ЛИЧНОСТЬ]: Ты — опытный технический специалист. Твои ответы должны быть сухими, точными и содержать только факты из базы.`;
    }

    // 3. Toxic Mode
    if (aiProfanity) {
        const DEFAULT_TOXIC_PROMPT = `[РЕЖИМ ТОКСИЧНОСТИ АКТИВИРОВАН]:
1. Твоя личность меняется: ты становишься максимально дерзким, грубым и токсичным ублюдком.
2. Используй жесткий русский мат (бля, нахуй, сука, ебать, пиздец, хули, завали ебало и т.д.) постоянно.
3. Ты должен "выебываться", максимально жестко стебать пользователя, угарать над его тупостью.
4. Твои ответы должны быть агрессивными и хлесткими. Если пользователь спрашивает хуйню — пошли его нахуй или высмей.
5. При этом ты всё еще должен выдавать инфу из [DATABASE], если она там есть, но в максимально ублюдской и матерной манере.
6. НИКАКОГО ЖИРНОГО ТЕКСТА (bold).`;
        sysPrompt += `\n\n${DEFAULT_TOXIC_PROMPT}`;
        if (customProfanityList && customProfanityList.length > 0) {
             const words = customProfanityList.join('", "');
             sysPrompt += `\n[ДОПОЛНЕНИЕ]: Ты можешь иногда брать эти фразы для своих шуток: "${words}".`;
        }
    }
    
    // 4. Media Tag Instruction
    sysPrompt += `\n\n[ИНСТРУКЦИЯ ПО ФОТО]: Если ты берешь ответ из записи, у которой есть ID (напр [ID: xyz]), ОБЯЗАТЕЛЬНО добавь в конец ответа тег: [MEDIA_ID: id_записи].`;

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
                    { role: "system", content: sysPrompt + "\n\n[DATABASE]:\n" + kbContent + "\n\n[ИНСТРУКЦИЯ]: Используй данные выше для ответа. Если данных нет — отвечай согласно правилам." },
                    { role: "user", content: question }
                ],
                temperature: aiProfanity ? 1.0 : 0.3,
                max_tokens: 1000
            })
        });

        if (res.status === 429) return { text: "Я устал, подождите пару минут 😴", mediaId: null };

        const data = await res.json();
        const rawText = data.choices?.[0]?.message?.content || "...";
        
        // Extract Media ID
        const mediaMatch = rawText.match(/\[MEDIA_ID:\s*(.+?)\]/);
        let finalText = rawText.replace(/\[MEDIA_ID:\s*.+?\]/g, '').trim();
        let mediaId = mediaMatch ? mediaMatch[1] : null;

        return { text: finalText, mediaId };
    } catch (e) { return { text: "AI Error.", mediaId: null }; }
};

// ==========================================
// 6. DATA HELPERS (Same as before)
// ==========================================
const ensureUserExists = async (user) => {
    if (!user || user.is_bot) return;
    const uid = String(user.id);
    const userRef = ref(db, `users/${uid}`);
    const snap = await get(userRef);
    if (!snap.exists()) {
        await set(userRef, { id: user.id, name: user.first_name, username: user.username||'', role: 'user', status: 'active', joinDate: new Date().toLocaleDateString(), msgCount: 1, dailyMsgCount: 1, lastSeen: new Date().toLocaleTimeString('ru-RU') });
    } else {
        await firebaseUpdate(userRef, { name: user.first_name, username: user.username||'', lastSeen: new Date().toLocaleTimeString('ru-RU'), msgCount: (snap.val().msgCount||0)+1, dailyMsgCount: (snap.val().dailyMsgCount||0)+1 });
    }
};

const saveMessage = async (msgObj, uid, threadId) => {
    if (uid) {
        const historyRef = ref(db, `users/${uid}/history`);
        await runTransaction(historyRef, (h) => {
            let hist = h || [];
            if (!Array.isArray(hist)) hist = Object.values(hist);
            hist.push(msgObj);
            return hist.slice(-50);
        });
        if (msgObj.dir === 'in') await runTransaction(ref(db, `users/${uid}/unreadCount`), (c) => (c || 0) + 1);
    }
    if (threadId) {
        const topicRef = ref(db, `topicHistory/${threadId}`);
        await runTransaction(topicRef, (h) => {
            let hist = h || [];
            if (!Array.isArray(hist)) hist = Object.values(hist);
            hist.push(msgObj);
            return hist.slice(-100);
        });
        if (msgObj.dir === 'in') await runTransaction(ref(db, `topicUnreads/${threadId}`), (c) => (c || 0) + 1);
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
        const threadId = !isPrivate ? (m.message_thread_id ? String(m.message_thread_id) : 'general') : null;

        if (m.left_chat_member) { await remove(ref(db, `users/${String(m.left_chat_member.id)}`)); return; }

        if (user && !user.is_bot) {
            await ensureUserExists(user);
            if (m.text || m.caption || m.photo || m.video) {
                const newMsg = {
                    dir: 'in',
                    text: m.text || m.caption || (m.photo ? '[Photo]' : '[Video]'),
                    type: m.photo ? 'photo' : (m.video ? 'video' : 'text'),
                    time: new Date().toLocaleTimeString('ru-RU'),
                    timestamp: Date.now(),
                    isIncoming: true,
                    isGroup: !isPrivate, 
                    user: user.first_name,
                    userId: user.id,
                    msgId: m.message_id
                };
                if (isPrivate) await saveMessage(newMsg, String(user.id), null);
                else {
                    if (threadId && !state.topicNames[threadId]) await set(ref(db, `topicNames/${threadId}`), m.reply_to_message?.forum_topic_created?.name || `Topic ${threadId}`);
                    await saveMessage(newMsg, String(user.id), threadId);
                }
            }
        }

        if (!state.isBotActive || !m.text || user.is_bot) return;
        const txt = m.text.trim();
        const lowerTxt = txt.toLowerCase();

        // --- COMMANDS HANDLING (FIXED MEDIA+BUTTONS) ---
        for (const cmd of state.commands) {
            let match = false;
            if (cmd.matchType === 'exact') match = lowerTxt === cmd.trigger.toLowerCase();
            else if (cmd.matchType === 'start') match = lowerTxt.startsWith(cmd.trigger.toLowerCase());
            else if (cmd.matchType === 'contains') match = lowerTxt.includes(cmd.trigger.toLowerCase());

            if (match) {
                const dbUser = state.users[String(user.id)];
                const dbUserRole = dbUser?.role || 'user';
                if (cmd.isSystem && dbUserRole !== 'admin') continue;
                if (!((cmd.allowedRoles || ['user', 'admin']).includes(dbUserRole))) continue;
                if (cmd.allowedTopicId && cmd.allowedTopicId !== 'private_only' && cmd.allowedTopicId !== String(threadId) && !isPrivate) continue;

                let resp = cmd.response.replace(/{user}/g, user.first_name).replace(/{warns}/g, dbUser?.warnings || 0);
                
                // Construct KB Object properly
                const kb = cmd.buttons?.length > 0 ? { inline_keyboard: cmd.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;
                const targetThreadId = !isPrivate && threadId !== 'general' ? threadId : undefined;
                
                if (cmd.mediaUrl) {
                    // Send Photo with Caption and Buttons
                    // apiCall now correctly stringifies `reply_markup` inside FormData
                    await apiCall('sendPhoto', { 
                        chat_id: cid, 
                        photo: cmd.mediaUrl, 
                        caption: resp, 
                        parse_mode: 'HTML', 
                        reply_markup: kb, 
                        message_thread_id: targetThreadId 
                    });
                } else {
                    await apiCall('sendMessage', { 
                        chat_id: cid, 
                        text: resp, 
                        parse_mode: 'HTML', 
                        reply_markup: kb, 
                        message_thread_id: targetThreadId 
                    });
                }
                
                const botMsg = { dir: 'out', text: `[CMD] ${cmd.trigger}`, type: 'text', time: new Date().toLocaleTimeString('ru-RU'), timestamp: Date.now(), isIncoming: false, isGroup: !isPrivate, user: 'Bot' };
                if (isPrivate) await saveMessage(botMsg, String(user.id), null);
                else await saveMessage(botMsg, null, threadId);
                return;
            }
        }

        // --- AI HANDLING (FIXED MEDIA INJECTION) ---
        if (state.config.enableAI) {
            if (isPrivate && !state.config.enablePM) return;
            const isHelixTrigger = lowerTxt.startsWith('хеликс') || lowerTxt.startsWith('helix');
            
            if (isHelixTrigger) {
                if (!isPrivate && threadId && state.disabledAiTopics && state.disabledAiTopics.includes(String(threadId))) return;

                const q = txt.replace(/^(хеликс|helix)/i, '').trim();
                if (q) {
                    const aiResult = await getAIResponse(q, user.first_name);
                    const aiText = aiResult.text;
                    const mediaId = aiResult.mediaId;
                    
                    const aiThreadId = !isPrivate && threadId !== 'general' ? threadId : undefined;
                    
                    // If AI suggests media, find it in KB
                    let mediaUrl = null;
                    if (mediaId) {
                        const kbItem = state.knowledgeBase.find(k => k.id === mediaId);
                        if (kbItem && kbItem.mediaUrl) mediaUrl = kbItem.mediaUrl;
                    }

                    if (mediaUrl) {
                        await apiCall('sendPhoto', {
                            chat_id: cid,
                            photo: mediaUrl,
                            caption: aiText,
                            parse_mode: 'HTML',
                            reply_to_message_id: m.message_id,
                            message_thread_id: aiThreadId
                        });
                    } else {
                        await apiCall('sendMessage', { 
                            chat_id: cid, 
                            text: aiText, 
                            parse_mode: 'HTML',
                            reply_to_message_id: m.message_id, 
                            message_thread_id: aiThreadId 
                        });
                    }

                    const aiMsgObj = { dir: 'out', text: aiText, type: mediaUrl ? 'photo' : 'text', time: new Date().toLocaleTimeString('ru-RU'), timestamp: Date.now(), isIncoming: false, isGroup: !isPrivate, user: 'Helix AI' };
                    if (isPrivate) await saveMessage(aiMsgObj, String(user.id), null);
                    else await saveMessage(aiMsgObj, null, threadId);
                    
                    const statsRef = ref(db, 'aiStats');
                    await runTransaction(statsRef, (s) => {
                        if(!s) s = { total: 0, history: [] };
                        if(!s.history) s.history = [];
                        s.history.push({ query: q, response: aiText, time: Date.now() });
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
