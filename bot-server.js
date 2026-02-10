
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
// 4. AI LOGIC (STRICTEST & PROFANITY FIX)
// ==========================================
const getAIResponse = async (question, userName) => {
    const { openaiApiKey, aiBaseUrl, aiModel, aiPersonality, aiProfanity, aiBehavior, aiStrictness, customProfanityList } = state.config;
    if (!openaiApiKey) return "⚠️ AI Key missing";

    // 1. Context Building
    const kbContent = state.knowledgeBase.length > 0 
        ? state.knowledgeBase.map(k => `[INFO] ${k.title}: ${k.response}`).join('\n')
        : "База знаний пуста.";

    // 2. Strictness Logic
    const accuracy = aiStrictness || 80;
    const temp = accuracy >= 100 ? 0.0 : (1 - accuracy / 100); // 0.0 temp is strictly deterministic

    let strictRule = "";
    if (accuracy >= 95) {
        strictRule = `
CRITICAL RULE: STRICT KNOWLEDGE BASE ONLY.
- You are FORBIDDEN from using any outside knowledge.
- You must ONLY use the information provided in the [KNOWLEDGE BASE] section below.
- If the answer is not in the [KNOWLEDGE BASE], you MUST reply with a variation of "Информации нет в базе" (in your persona).
- Do not hallucinate. Do not invent facts.`;
    } else {
        strictRule = "Use the Knowledge Base as your primary source. If info is missing, use your general knowledge.";
    }

    // 3. Profanity Injection
    let profanityRule = "";
    if (aiProfanity && customProfanityList && customProfanityList.length > 0) {
        profanityRule = `
MANDATORY STYLE RULE:
- You MUST include at least one phrase from this list in your response: ${JSON.stringify(customProfanityList)}.
- Integrate them naturally into your sentence structure.
- Do not be polite.`;
    }

    // 4. System Prompt
    const systemPrompt = `
You are ${state.config.botName || 'Helix'}. 
Persona: ${aiPersonality}.
Language: Russian.

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
// 5. PROCESS UPDATES
// ==========================================
const processUpdate = async (upd) => {
    const m = upd.message;
    if (!m) return;

    const cid = String(m.chat.id);
    const user = m.from;
    const threadId = m.message_thread_id ? String(m.message_thread_id) : 'general';

    // --- ОБРАБОТКА ВСТУПЛЕНИЯ (МГНОВЕННЫЙ CRM) ---
    if (m.new_chat_members) {
        for (const member of m.new_chat_members) {
            if (member.is_bot) continue;
            
            // 1. Добавляем в базу СРАЗУ
            const userRef = ref(db, `users/${member.id}`);
            await set(userRef, {
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

            // 2. Команда Welcome
            const welcome = state.commands.find(c => c.trigger === '_welcome_');
            if (welcome) {
                const nameLink = `<a href="tg://user?id=${member.id}">${member.first_name}</a>`;
                const text = welcome.response.replace(/{user}/g, nameLink).replace(/{name}/g, member.first_name);
                const kb = welcome.buttons?.length > 0 ? { inline_keyboard: welcome.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;
                
                // Используем notificationTopicId если задан, иначе текущий тред или 'general'
                const targetThread = welcome.notificationTopicId || undefined;

                if (welcome.mediaUrl) {
                    await apiCall('sendPhoto', { chat_id: cid, photo: welcome.mediaUrl, caption: text, parse_mode: 'HTML', reply_markup: kb, message_thread_id: targetThread });
                } else {
                    await apiCall('sendMessage', { chat_id: cid, text, parse_mode: 'HTML', reply_markup: kb, message_thread_id: targetThread });
                }
            }
        }
    }

    // --- ОБРАБОТКА ВЫХОДА (ПОЛНОЕ УДАЛЕНИЕ) ---
    if (m.left_chat_member) {
        if (!m.left_chat_member.is_bot) {
            // Удаляем пользователя полностью из CRM
            await remove(ref(db, `users/${m.left_chat_member.id}`));
        }
    }

    if (!m.text || user.is_bot || !state.isBotActive) return;

    // Обновляем "Last Seen" для существующих
    const userRef = ref(db, `users/${user.id}`);
    // Мы не используем set здесь, чтобы не перезатереть данные, используем update
    // Но сначала проверим, есть ли юзер (на случай если firebase пуст)
    get(userRef).then(snap => {
        if (!snap.exists()) {
             set(userRef, {
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
            const d = snap.val();
            firebaseUpdate(userRef, {
                name: user.first_name,
                username: user.username || '',
                lastSeen: new Date().toLocaleTimeString('ru-RU'),
                msgCount: (d.msgCount || 0) + 1,
                dailyMsgCount: (d.dailyMsgCount || 0) + 1
            });
        }
    });

    const txt = m.text.trim();
    const lowerTxt = txt.toLowerCase();

    // --- SYSTEM COMMANDS (WARN FIX) ---
    if (lowerTxt.startsWith('/warn')) {
        // Проверяем права админа (эмуляция, в реале нужно проверять user.id в списке adminIds)
        if (m.reply_to_message && m.reply_to_message.from && !m.reply_to_message.from.is_bot) {
            const target = m.reply_to_message.from;
            const targetRef = ref(db, `users/${target.id}`);
            
            const snap = await get(targetRef);
            let val = snap.val();
            
            // Если юзера нет в базе, создаем его на лету
            if (!val) {
                val = { id: target.id, name: target.first_name, warnings: 0, status: 'active' };
            }

            const newWarns = (val.warnings || 0) + 1;
            
            // Сначала обновляем БД
            await firebaseUpdate(targetRef, { 
                warnings: newWarns, 
                name: target.first_name 
            });

            if (newWarns >= 3) {
                // Mute logic
                await apiCall('restrictChatMember', {
                    chat_id: cid,
                    user_id: target.id,
                    permissions: JSON.stringify({ can_send_messages: false }),
                    until_date: Math.floor(Date.now()/1000) + 86400 // 24h
                });
                await firebaseUpdate(targetRef, { warnings: 0, status: 'muted' });
                await apiCall('sendMessage', { chat_id: cid, text: `🛑 <b>${target.first_name}</b> получил 3-й варн и заглушен.`, parse_mode: 'HTML', message_thread_id: threadId });
            } else {
                await apiCall('sendMessage', { chat_id: cid, text: `⚠️ <b>${target.first_name}</b>, предупреждение (${newWarns}/3).`, parse_mode: 'HTML', message_thread_id: threadId });
            }
            return;
        }
    }

    // --- OTHER COMMANDS ---
    for (const cmd of state.commands) {
        if (cmd.matchType === 'exact' && lowerTxt === cmd.trigger.toLowerCase()) {
            const nameLink = `<a href="tg://user?id=${user.id}">${user.first_name}</a>`;
            const resp = cmd.response.replace(/{user}/g, nameLink).replace(/{name}/g, user.first_name);
            const kb = cmd.buttons?.length > 0 ? { inline_keyboard: cmd.buttons.map(b => [{ text: b.text, url: b.url }]) } : undefined;
            
            // Приоритет: NotificationTopicId -> Current Thread
            const targetTid = cmd.trigger === '_welcome_' ? cmd.notificationTopicId : (cmd.notificationTopicId || (threadId !== 'general' ? threadId : undefined));

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
        const isHelix = lowerTxt.startsWith('хеликс') || lowerTxt.startsWith('helix') || (m.chat.type === 'private' && state.config.enablePM);
        if (isHelix && !state.disabledAiTopics.includes(threadId)) {
            const q = txt.replace(/^(хеликс|helix)/i, '').trim();
            if (!q) return;
            const a = await getAIResponse(q, user.first_name);
            await apiCall('sendMessage', { chat_id: cid, text: a, reply_to_message_id: m.message_id, message_thread_id: threadId !== 'general' ? threadId : undefined });
            
            // Stats update
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
