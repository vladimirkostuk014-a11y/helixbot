
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, update as firebaseUpdate, get, remove } from "firebase/database";
import fetch from 'node-fetch';
import { FormData } from 'formdata-node';
import { Blob } from 'buffer'; // Import Blob specifically for Node environment

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
    topicHistory: {} 
};

let lastUpdateId = 0;
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
// Not syncing topicHistory fully to memory to avoid RAM bloat, we fetch/save on demand or sync critical parts
// But for LiveChat realtime updates, we might need it. Let's sync specific nodes or handle differently if massive.
// For now, keeping simple sync as per user request.
sync('topicHistory', 'topicHistory'); 

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
            
            // FIX: Convert Buffer to Blob for formdata-node
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
// 4. DAILY TOP SCHEDULER
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
// 5. AI LOGIC (STRICTNESS, PROFANITY, PERSONALITY)
// ==========================================
const getAIResponse = async (question, userName) => {
    let { aiBaseUrl, aiModel, aiPersonality, aiProfanity, customProfanityList, aiStrictness, aiBehavior } = state.config;
    
    // 1. Fetch Key from DB (Force Refresh)
    let apiKeyToUse = "";
    try {
        const configSnap = await get(ref(db, 'config'));
        apiKeyToUse = (configSnap.val()?.openaiApiKey || "").trim();
    } catch (e) { apiKeyToUse = (state.config.openaiApiKey || "").trim(); }

    if (!apiKeyToUse) return "⚠️ Ключ AI не найден.";

    const strictLevel = aiStrictness || 80;

    // 2. Build Knowledge Base
    // Only include trigger/response to save tokens
    const kbContent = state.knowledgeBase.length > 0 
        ? state.knowledgeBase.map(k => `Q: ${k.triggers}\nA: ${k.response}`).join('\n\n')
        : "База знаний пуста.";

    // 3. PERSONALITY MAP
    const personaMap = {
        'helpful': 'Ты полезный помощник Хеликс.',
        'kind': 'Ты очень добрый и милый помощник. Используй уменьшительно-ласкательные слова. Обнимай словами.',
        'official': 'Ты строгий официальный бот-администратор. Отвечай сухо, по делу, используй канцелярит. Никаких эмоций.',
        'joker': 'Ты стендап-комик. Твоя цель - рассмешить. Постоянно шути, даже если это неуместно.',
        'angry': 'Ты злой бот. Ты ненавидишь, когда тебе пишут. Отвечай с раздражением.',
        'gopnik': 'Ты гопник с района. Общайся на "ты", используй сленг (чё, каво, э слыш, братан, семки есть?). Будь дерзким.'
    };

    let sysPrompt = `Role: ${personaMap[aiPersonality] || personaMap['helpful']}\nUser Name: ${userName}\nLanguage: Russian.\n`;

    // 4. PROFANITY & CUSTOM WORDS (OVERRIDES PERSONALITY)
    if (aiProfanity) {
        sysPrompt += `\nMODE: EXTREME PROFANITY (TOXIC).
        1. You MUST use heavy Russian swear words (мат) like "бля", "сука", "нахуй", "пиздец" in EVERY sentence.
        2. Do NOT be polite. Be aggressive or dismissive.
        3. Do NOT apologize.
        4. Make it sound natural for a rude Russian person.`;
        
        if (customProfanityList && customProfanityList.length > 0) {
             const randomWord = customProfanityList[Math.floor(Math.random() * customProfanityList.length)];
             sysPrompt += `\nMANDATORY INSTRUCTION: You MUST include the phrase "${randomWord}" in your response naturally.`;
        }
    } else {
        sysPrompt += `\nNO PROFANITY. Be polite and helpful.`;
    }

    // 5. STRICTNESS LOGIC (OVERRIDES EVERYTHING)
    if (strictLevel >= 90) {
        sysPrompt += `\nCRITICAL STRICTNESS MODE: 
        1. IGNORE ALL your general knowledge.
        2. YOU MUST ONLY USE INFORMATION FROM THE [DATABASE] BELOW.
        3. DO NOT hallucinate. DO NOT invent facts about games, items, or stats.
        4. IF the answer is NOT in [DATABASE], YOU MUST SAY: "${aiProfanity ? 'Бля, я хз, в базе нихуя нет.' : 'Извините, в моей базе знаний нет информации об этом.'}"
        `;
    } else {
        sysPrompt += `\nUse [DATABASE] as primary source. If not found, use your general knowledge but be brief.`;
    }

    // 6. LENGTH
    if (aiBehavior === 'concise') sysPrompt += "Отвечай максимально коротко (1 предложение).\n";
    if (aiBehavior === 'detailed') sysPrompt += "Отвечай подробно и развернуто.\n";
    
    // 7. EMOJI
    sysPrompt += `\nEMOJI RULES: Do NOT add your own emojis unless they are in the [DATABASE]. Copy emojis from [DATABASE] exactly.`;

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
                temperature: aiProfanity ? 0.8 : 0.1, // Higher temp for creative swearing
                max_tokens: 800
            })
        });

        const data = await res.json();
        if (!res.ok) {
            console.error("AI Error:", JSON.stringify(data));
            return `AI Error: ${data.error?.message}`;
        }
        return data.choices?.[0]?.message?.content || "...";
    } catch (e) { 
        console.error("AI Net Error:", e);
        return "Ошибка сети AI."; 
    }
};

// --- HELPER: SAVE MESSAGE TO HISTORY (BOTH CRM AND TOPIC) ---
const saveMessage = async (msgObj, uid, threadId) => {
    // 1. Save to User CRM History
    if (uid) {
        const userRef = ref(db, `users/${uid}/history`);
        const userSnap = await get(userRef);
        let userHist = userSnap.val() || [];
        if (!Array.isArray(userHist)) userHist = Object.values(userHist);
        userHist.push(msgObj);
        if (userHist.length > 50) userHist = userHist.slice(-50);
        await set(userRef, userHist);
    }

    // 2. Save to Topic/LiveChat History
    if (threadId) {
        const topicRef = ref(db, `topicHistory/${threadId}`);
        const topicSnap = await get(topicRef);
        let topicHist = topicSnap.val() || [];
        if (!Array.isArray(topicHist)) topicHist = Object.values(topicHist);
        topicHist.push(msgObj);
        // Keep topic history manageable
        if (topicHist.length > 100) topicHist = topicHist.slice(-100);
        await set(topicRef, topicHist);

        // Update unread count for topic
        const unreadRef = ref(db, `topicUnreads/${threadId}`);
        const unreadSnap = await get(unreadRef);
        await set(unreadRef, (unreadSnap.val() || 0) + 1);
    }
};

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
        const threadId = m.message_thread_id ? String(m.message_thread_id) : (m.chat.type === 'private' ? String(user.id) : 'general');
        const isPrivate = m.chat.type === 'private';

        // --- PM LOGIC: IGNORE IF DISABLED (EXCEPT ADMINS) ---
        if (isPrivate && !state.config.enablePM) {
            const localUser = state.users[String(user.id)];
            // If user role is NOT admin, ignore.
            if (localUser?.role !== 'admin') {
                return; 
            }
        }

        if (m.left_chat_member) {
            const leftUid = String(m.left_chat_member.id);
            await remove(ref(db, `users/${leftUid}`));
            return; 
        }

        if (!isPrivate) {
            const correctId = String(m.chat.id);
            if (!state.groups[correctId]) {
                 await set(ref(db, `groups/${correctId}`), { id: m.chat.id, title: m.chat.title, isDisabled: false, lastActive: new Date().toLocaleDateString() });
            }
            if (state.groups[correctId]?.isDisabled) return;
        }

        // --- USER & HISTORY SYNC ---
        let dbUserRole = 'user';
        if (user && !user.is_bot) {
            const uid = String(user.id);
            const local = state.users[uid];
            dbUserRole = local?.role || 'user';
            
            // Sync User Stats
            await firebaseUpdate(ref(db, `users/${uid}`), {
                name: user.first_name,
                username: user.username || '',
                lastSeen: new Date().toLocaleTimeString('ru-RU'),
                msgCount: (local?.msgCount || 0) + 1,
                dailyMsgCount: (local?.dailyMsgCount || 0) + 1
            });

            // Store Message in DB
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

                // CRITICAL: Save to both User History and Live Chat Topic History
                await saveMessage(newMsg, uid, threadId);

                // Update Topic Names if needed
                if (!state.topicNames[threadId]) {
                    const topicName = isPrivate ? `${user.first_name} (LS)` : (m.reply_to_message?.forum_topic_created?.name || `Topic ${threadId}`);
                    await set(ref(db, `topicNames/${threadId}`), topicName);
                }
            }

            if (!local) await ensureUserExists(user);
        }

        if (m.new_chat_members) {
            const welcome = state.commands.find(c => c.trigger === '_welcome_');
            if (welcome) {
                for (const member of m.new_chat_members) {
                    if (member.is_bot) continue;
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

        // --- COMMANDS LOGIC ---
        // Check for commands
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
                // Fix: Serialize buttons correctly
                const kb = cmd.buttons?.length > 0 ? { inline_keyboard: cmd.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;
                const targetThread = threadId !== 'general' ? threadId : undefined;

                if (cmd.mediaUrl) {
                    await apiCall('sendPhoto', { 
                        chat_id: cid, 
                        photo: cmd.mediaUrl, 
                        caption: resp, 
                        parse_mode: 'HTML', 
                        reply_markup: kb, 
                        message_thread_id: targetThread 
                    });
                } else {
                    await apiCall('sendMessage', { 
                        chat_id: cid, 
                        text: resp, 
                        parse_mode: 'HTML', 
                        reply_markup: kb, 
                        message_thread_id: targetThread 
                    });
                }
                
                // Log bot response to history
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

        // --- AI LOGIC ---
        if (state.config.enableAI) {
            const isHelixTrigger = lowerTxt.startsWith('хеликс') || lowerTxt.startsWith('helix');
            
            if ((isPrivate && state.config.enablePM) || isHelixTrigger) {
                if (state.disabledAiTopics && state.disabledAiTopics.includes(String(threadId))) return;

                const q = txt.replace(/^(хеликс|helix)/i, '').trim();
                if (q) {
                    const a = await getAIResponse(q, user.first_name);
                    
                    // Send Response
                    await apiCall('sendMessage', { 
                        chat_id: cid, 
                        text: a, 
                        reply_to_message_id: m.message_id, 
                        message_thread_id: threadId !== 'general' ? threadId : undefined 
                    });

                    // Log AI Response to history
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
                    
                    // Save Stats
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
