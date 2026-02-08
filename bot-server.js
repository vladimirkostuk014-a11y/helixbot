
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, update, get } from "firebase/database";
import fetch from 'node-fetch';

// ==========================================
// 1. КОНФИГУРАЦИЯ
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

// Глобальное состояние
let state = {
    config: {},
    users: {},
    groups: {},
    commands: [],
    knowledgeBase: [],
    calendarEvents: [],
    topicNames: {},
    aiStats: { total: 0, history: [] },
    disabledAiTopics: [],
    isBotActive: true 
};

let lastUpdateId = 0;
const processedUpdates = new Set();

console.log("🔥 [SERVER] Запуск сервера Helix (v2.1 Stable)...");

// ==========================================
// 2. СИНХРОНИЗАЦИЯ С FIREBASE
// ==========================================
const sync = (path, key, isArray = false) => {
    onValue(ref(db, path), (snapshot) => {
        const val = snapshot.val();
        if (isArray) {
            state[key] = val ? Object.values(val) : [];
        } else {
            state[key] = val || (key === 'config' ? {} : {});
        }
        if (key === 'config') console.log(`[CONFIG] Токен загружен: ...${state.config.token?.slice(-5)}`);
    });
};

sync('config', 'config');
sync('users', 'users');
sync('groups', 'groups');
sync('commands', 'commands', true);
sync('knowledgeBase', 'knowledgeBase', true);
sync('calendarEvents', 'calendarEvents', true);
sync('topicNames', 'topicNames');
sync('aiStats', 'aiStats');
sync('disabledAiTopics', 'disabledAiTopics', true);

onValue(ref(db, 'status/active'), (snap) => {
    // Если null/undefined -> считаем true (включен)
    const val = snap.val();
    state.isBotActive = val !== false; 
    console.log(`[STATUS] Режим ответа: ${state.isBotActive ? '✅ АКТИВЕН' : '⏸ НА ПАУЗЕ'}`);
});

// ==========================================
// 3. API TELEGRAM
// ==========================================
const apiCall = async (method, body) => {
    if (!state.config.token) return;
    try {
        const response = await fetch(`https://api.telegram.org/bot${state.config.token}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        return data;
    } catch (e) {
        console.error(`[NETWORK ERROR] ${method}:`, e.message);
    }
};

const sendMessage = async (chatId, text, options = {}) => {
    return await apiCall('sendMessage', {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        ...options
    });
};

// ==========================================
// 4. ЛОГИКА СОХРАНЕНИЯ (CRM & CHAT)
// ==========================================

const updateUserHistory = async (user, message) => {
    try {
        const userId = user.id;
        const userPath = `users/${userId}`;
        
        // Получаем текущего юзера или создаем нового
        // ВАЖНО: username: user.username || '' - защищает от краша
        let currentUser = state.users[userId] || {
            id: userId,
            name: user.first_name || 'Unknown',
            username: user.username || '', 
            role: state.config.adminIds?.includes(String(userId)) ? 'admin' : 'user',
            status: 'active',
            warnings: 0,
            joinDate: new Date().toLocaleDateString(),
            history: [],
            msgCount: 0,
            dailyMsgCount: 0
        };

        // Обновляем данные (вдруг сменил имя)
        currentUser.name = user.first_name || currentUser.name;
        currentUser.username = user.username || ''; 
        currentUser.lastSeen = new Date().toLocaleTimeString('ru-RU');
        currentUser.lastActiveDate = new Date().toLocaleDateString();
        currentUser.msgCount = (currentUser.msgCount || 0) + 1;
        currentUser.dailyMsgCount = (currentUser.dailyMsgCount || 0) + 1;
        // Ставим флаг, что есть непрочитанное (для сайта)
        currentUser.unreadCount = (currentUser.unreadCount || 0) + 1;

        // История
        const history = Array.isArray(currentUser.history) ? currentUser.history : [];
        const newHistory = [...history, message].slice(-50); 
        currentUser.history = newHistory;

        // Пишем в базу
        await set(ref(db, userPath), currentUser);
        state.users[userId] = currentUser; // Обновляем локально сразу
        
    } catch (e) {
        console.error("[CRM ERROR] Save failed:", e);
    }
};

const updateTopicHistory = async (topicId, message, topicNameRaw) => {
    try {
        const tId = topicId || 'general';
        const path = `topicHistory/${tId}`;
        
        // Авто-регистрация новой темы
        if (!state.topicNames[tId] && tId !== 'general') {
            const newName = topicNameRaw || `Topic ${tId}`;
            await update(ref(db, 'topicNames'), { [tId]: newName });
            console.log(`[TOPIC] Зарегистрирован новый топик: ${newName} (${tId})`);
        }

        const snapshot = await get(ref(db, path));
        const currentHistory = snapshot.val() || [];
        const updatedHistory = [...(Array.isArray(currentHistory) ? currentHistory : []), message].slice(-50);
        
        await set(ref(db, path), updatedHistory);
    } catch (e) {
        console.error("[TOPIC ERROR] Save failed:", e);
    }
};

// ==========================================
// 5. МОЗГ AI (УМНЫЙ РЕЖИМ)
// ==========================================
const getAIResponse = async (question, userName) => {
    const { openaiApiKey, aiBaseUrl, aiModel, aiPersonality, aiProfanity } = state.config;
    
    if (!openaiApiKey) return "⚠️ AI не настроен.";

    const context = state.knowledgeBase.map(k => `[${k.category}] ${k.title}: ${k.response}`).join('\n');

    let persona = "Ты — Хеликс, полезный помощник.";
    if (aiProfanity) persona = "Ты дерзкий, используешь мат (18+), но по делу.";
    else if (aiPersonality === 'joker') persona = "Ты шутник.";
    else if (aiPersonality === 'official') persona = "Ты официальный бот.";

    // Умный промпт: разделяет болтовню и факты
    const systemPrompt = `
    ROLE: ${persona}
    USER: ${userName}
    
    INSTRUCTIONS:
    1. SMALL TALK: Если юзер пишет "Привет", "Как дела", "Кто ты" - отвечай свободно, коротко и дружелюбно (или в стиле личности). БАЗУ НЕ ИСПОЛЬЗУЙ.
    
    2. FACTS: Если вопрос про игру, клан, правила, ивенты - ИСПОЛЬЗУЙ ТОЛЬКО CONTEXT НИЖЕ.
       CONTEXT:
       ${context}
       
    3. UNKNOWN: Если это вопрос про факты, но в CONTEXT пусто - ответь: "В моей базе знаний нет информации об этом." (Не выдумывай!).
    `;

    try {
        const response = await fetch(`${aiBaseUrl || 'https://api.groq.com/openai/v1'}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiApiKey}` },
            body: JSON.stringify({
                model: aiModel || "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: question }
                ],
                temperature: 0.6,
                max_tokens: 800
            })
        });
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "Ошибка генерации.";
    } catch (e) {
        console.error("AI Error:", e);
        return "Ошибка AI.";
    }
};

// ==========================================
// 6. ОБРАБОТКА СООБЩЕНИЙ
// ==========================================
const processUpdate = async (update) => {
    const msg = update.message;
    if (!msg || !msg.text) return; 

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const user = msg.from;
    const isPrivate = msg.chat.type === 'private';
    const isTargetChat = String(chatId) === state.config.targetChatId;
    const threadId = msg.message_thread_id ? String(msg.message_thread_id) : 'general';
    
    // Пытаемся угадать название топика, если это первое сообщение
    const topicNameGuess = msg.reply_to_message?.forum_topic_created?.name || null;

    // 1. ЛОГИРУЕМ ВСЕГДА (Даже если бот на паузе)
    const logMsg = {
        dir: 'in',
        text: text,
        type: 'text',
        time: new Date().toLocaleTimeString('ru-RU'),
        isGroup: !isPrivate,
        user: user.first_name 
    };

    await updateUserHistory(user, logMsg);
    if (isTargetChat) {
        await updateTopicHistory(threadId, { ...logMsg, isIncoming: true }, topicNameGuess);
    }

    if (user.is_bot) return;

    // Если бот на паузе - дальше не идем (не отвечаем)
    // Исключение: Команды админов или ЛС (если настроено)
    // Но по запросу - "отключить работу в ЛС" тоже проверяем
    if (!state.isBotActive) return;
    if (isPrivate && !state.config.enablePM) return;


    // 2. ПРОВЕРКА КОМАНД
    const lowerText = text.toLowerCase();
    let commandHandled = false;

    // Сортируем команды: сначала точные совпадения, потом частичные
    const sortedCommands = [...state.commands].sort((a, b) => {
        if (a.matchType === 'exact') return -1;
        return 1;
    });

    for (const cmd of sortedCommands) {
        let match = false;
        const trig = cmd.trigger.toLowerCase();

        if (cmd.matchType === 'exact' && lowerText === trig) match = true;
        else if (cmd.matchType === 'start' && lowerText.startsWith(trig)) match = true;
        else if (cmd.matchType === 'contains' && lowerText.includes(trig)) match = true;

        if (match) {
            // Проверка прав и топика
            if (cmd.allowedTopicId === 'private_only' && !isPrivate) continue;
            if (cmd.allowedTopicId && cmd.allowedTopicId !== 'private_only' && cmd.allowedTopicId !== threadId && !isPrivate) continue;

            const targetThread = (cmd.isSystem && cmd.notificationTopicId) ? cmd.notificationTopicId : threadId;
            const replyMarkup = cmd.buttons && cmd.buttons.length > 0 ? {
                inline_keyboard: cmd.buttons.map(b => [{ text: b.text, url: b.url }])
            } : undefined;

            await sendMessage(chatId, cmd.response, { 
                message_thread_id: targetThread !== 'general' ? targetThread : undefined,
                reply_markup: replyMarkup
            });

            // Лог ответа
            if (isTargetChat) {
                await updateTopicHistory(targetThread, {
                    user: 'Bot',
                    text: cmd.response,
                    isIncoming: false,
                    time: new Date().toLocaleTimeString('ru-RU'),
                    type: 'text'
                }, null);
            }
            commandHandled = true;
            break; // Выполняем только одну команду
        }
    }

    // 3. AI
    if (!commandHandled && state.config.enableAI) {
        const isMention = lowerText.includes('хеликс') || lowerText.includes('helix') || (isPrivate && state.config.enablePM);
        const isDisabled = state.disabledAiTopics.includes(threadId);

        if (isMention && !isDisabled) {
            const question = text.replace(/хеликс|helix/gi, '').trim();
            
            // Если просто написали "Хеликс" без текста - игнор (кроме ЛС)
            if (!question && !isPrivate) return;

            const answer = await getAIResponse(question || "Привет", user.first_name);
            
            await sendMessage(chatId, answer, { 
                reply_to_message_id: msg.message_id,
                message_thread_id: threadId !== 'general' ? threadId : undefined
            });

            // Статистика и лог
            const newHistory = [{ query: question || "Привет", response: answer, time: Date.now() }, ...state.aiStats.history].slice(0, 100);
            await set(ref(db, 'aiStats'), { total: state.aiStats.total + 1, history: newHistory });

            if (isTargetChat) {
                await updateTopicHistory(threadId, {
                    user: 'Bot',
                    text: answer,
                    isIncoming: false,
                    time: new Date().toLocaleTimeString('ru-RU'),
                    type: 'text'
                }, null);
            }
        }
    }
};

// ==========================================
// 7. КАЛЕНДАРЬ
// ==========================================
const checkCalendar = async () => {
    if (!state.config.enableCalendarAlerts || !state.isBotActive) return;

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    let updatesNeeded = false;
    const updatedEvents = state.calendarEvents.map(event => {
        const notifyDate = event.notifyDate || event.startDate;
        const notifyTime = event.notifyTime || '09:00';

        if (notifyDate === dateStr && notifyTime === timeStr && !event.sent) {
            const msg = `⚡️ <b>${event.title}</b>\n\n📅 <b>Даты:</b> ${event.startDate} — ${event.endDate}\n📂 ${event.category}\n\n${event.description || ''}`;
            const replyMarkup = event.buttons?.length > 0 ? {
                inline_keyboard: event.buttons.map(b => [{ text: b.text, url: b.url }])
            } : undefined;

            const targetThread = event.topicId && event.topicId !== 'general' ? event.topicId : null;

            sendMessage(state.config.targetChatId, msg, {
                message_thread_id: targetThread,
                reply_markup: replyMarkup
            });

            updatesNeeded = true;
            return { ...event, sent: true }; 
        }
        return event;
    });

    if (updatesNeeded) {
        await set(ref(db, 'calendarEvents'), updatedEvents);
    }
};

// ==========================================
// 8. ЗАПУСК
// ==========================================
const startLoop = async () => {
    // Heartbeat каждую минуту
    setInterval(() => {
        set(ref(db, 'status/heartbeat'), Date.now());
        checkCalendar();
    }, 60000);

    // Long Polling
    while (true) {
        if (state.config.token) {
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
                    if (processedUpdates.size > 5000) processedUpdates.clear();
                }
            } catch (e) {
                console.error("Polling error (retry 5s):", e.message);
                await new Promise(r => setTimeout(r, 5000));
            }
        } else {
            await new Promise(r => setTimeout(r, 2000));
        }
    }
};

setTimeout(startLoop, 3000);
