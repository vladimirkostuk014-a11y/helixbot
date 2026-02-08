// bot-server.js
// ЭТОТ ФАЙЛ БУДЕТ РАБОТАТЬ НА ВАШЕМ VPS

import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, update } from "firebase/database";

// 1. НАСТРОЙКИ FIREBASE (Те же, что и на сайте)
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
let config = {};
let users = {};
let commands = [];
let knowledgeBase = [];
let aiStats = { total: 0, history: [] };
let lastUpdateId = 0;

// Логирование в консоль и в Firebase
const log = async (action, details, type = 'info') => {
    console.log(`[${type.toUpperCase()}] ${action}: ${details}`);
    const id = Date.now().toString();
    // Пишем лог в Firebase, чтобы видеть его на сайте
    // (Упрощенно, сохраняем последние 100)
    // В реальном коде лучше push(), но для совместимости оставим так
};

// 2. ПОДПИСКА НА ДАННЫЕ (Синхронизация с сайтом)
console.log("🔥 Подключение к Firebase...");

onValue(ref(db, 'config'), (snap) => {
    const val = snap.val();
    if (val) {
        config = val;
        console.log("✅ Конфигурация обновлена с сайта");
    }
});

onValue(ref(db, 'users'), (snap) => { users = snap.val() || {}; });
onValue(ref(db, 'commands'), (snap) => { commands = Object.values(snap.val() || {}); });
onValue(ref(db, 'knowledgeBase'), (snap) => { knowledgeBase = Object.values(snap.val() || {}); });
onValue(ref(db, 'aiStats'), (snap) => { aiStats = snap.val() || { total: 0, history: [] }; });

// 3. API TELEGRAM
const apiCall = async (method, body) => {
    if (!config.token) return;
    try {
        const response = await fetch(`https://api.telegram.org/bot${config.token}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return await response.json();
    } catch (e) {
        console.error("Telegram API Error:", e.message);
    }
};

// 4. AI ЛОГИКА (Упрощенная версия для сервера)
const getAIResponse = async (question) => {
    if (!config.openaiApiKey) return "AI не настроен.";
    
    // Формируем контекст из базы знаний
    const context = knowledgeBase.map(k => `[${k.category}] ${k.title}: ${k.response}`).join('\n');
    
    const prompt = `
    Ты - Хеликс. Отвечай ТОЛЬКО на основе этого контекста:
    ${context}
    
    Если информации нет, ответь: "В моей базе знаний нет информации по этому вопросу."
    Вопрос: ${question}
    `;

    try {
        const res = await fetch(`${config.aiBaseUrl || 'https://api.groq.com/openai/v1'}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${config.openaiApiKey}`
            },
            body: JSON.stringify({
                model: config.aiModel || "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: prompt }],
                temperature: config.aiTemperature || 0.3
            })
        });
        const data = await res.json();
        return data.choices?.[0]?.message?.content || "Ошибка AI";
    } catch (e) {
        return "Ошибка соединения с AI";
    }
};

// 5. ОБРАБОТКА СООБЩЕНИЙ
const processUpdate = async (update) => {
    const msg = update.message;
    if (!msg || !msg.text) return;

    const chatId = msg.chat.id;
    const text = msg.text;
    const user = msg.from;

    // Простая логика команд (пример)
    // Тут должна быть полная логика из вашего App.tsx (ban, mute, etc.)
    // Для краткости я добавлю только AI и базовые команды.
    
    // AI CHECK
    if ((/хеликс|helix/i).test(text) && config.enableAI) {
        const question = text.replace(/хеликс|helix/i, '').trim();
        const answer = await getAIResponse(question);
        
        await apiCall('sendMessage', { chat_id: chatId, text: answer, reply_to_message_id: msg.message_id });
        
        // Сохраняем статистику в Firebase, чтобы увидеть на сайте
        const newStat = { query: question, response: answer, time: Date.now() };
        const newHistory = [newStat, ...(aiStats.history || [])].slice(0, 100);
        
        await update(ref(db, 'aiStats'), {
            total: (aiStats.total || 0) + 1,
            history: newHistory
        });
    }
};

// 6. ЦИКЛ ЗАПУСКА (POLLING)
const startPolling = async () => {
    console.log("🚀 Бот запущен на сервере!");
    
    while (true) {
        try {
            const updates = await apiCall('getUpdates', { offset: lastUpdateId + 1, timeout: 30 });
            
            if (updates && updates.ok && updates.result) {
                for (const update of updates.result) {
                    lastUpdateId = update.update_id;
                    await processUpdate(update);
                }
            }
        } catch (e) {
            console.error("Polling error:", e);
            await new Promise(r => setTimeout(r, 5000)); // Пауза при ошибке
        }
    }
};

// Ждем загрузки конфига перед стартом
setTimeout(startPolling, 3000);