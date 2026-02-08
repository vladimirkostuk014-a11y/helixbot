
import React, { useState, useEffect, useRef } from 'react';
import { Icons } from './components/Icons';
import Dashboard from './components/Dashboard';
import LiveChat from './components/LiveChat';
import KnowledgeBase from './components/KnowledgeBase';
import Commands from './components/Commands'; 
import Broadcasts from './components/Broadcasts'; 
import AuditLogs from './components/AuditLogs'; 
import CalendarEvents from './components/CalendarEvents';
import { BotConfig, User, Command, KnowledgeItem, AiStats, Message, Group, QuickReply, LogEntry, CalendarEvent } from './types';
import { apiCall, getAIResponse } from './services/api';
import UserCRM from './components/UserCRM';
import { User as UserType } from './types';
import { subscribeToData, saveData } from './services/firebase'; 

// === ВАШИ КЛЮЧИ ТЕЛЕГРАМ ===
const HARDCODED_CONFIG = {
    token: '7614990025:AAEGbRiUO3zPR1VFhwTPgQ4eHVX-eo5snPI',
    targetChatId: '-1003724305882',
    adminIds: '8098674553'
};

const GROQ_API_KEY = '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';

// Обновленный и отсортированный список системных команд
const DEFAULT_SYSTEM_COMMANDS: Command[] = [
    // 1. Welcome
    { id: 'welcome_event', trigger: '_welcome_', matchType: 'exact', type: 'text', response: '👋 Привет, {name}! Добро пожаловать в наш чат.', mediaUrl: '', buttons: [], isSystem: true, notificationTopicId: '', color: 'Green' },
    
    // 2. Moderation (Bans/Kicks/Mutes)
    { id: 'cmd_ban', trigger: '/ban', matchType: 'start', type: 'text', response: '🚫 @{target_name} был забанен.', mediaUrl: '', buttons: [], isSystem: true, allowedRoles: ['admin'], color: 'Red' },
    { id: 'cmd_kick', trigger: '/kick', matchType: 'start', type: 'text', response: '🦶 @{target_name} кикнут.', mediaUrl: '', buttons: [], isSystem: true, allowedRoles: ['admin'], color: 'Red' },
    { id: 'cmd_mute', trigger: '/mute', matchType: 'start', type: 'text', response: '😶 @{target_name} замучен.', mediaUrl: '', buttons: [], isSystem: true, allowedRoles: ['admin'], color: 'Yellow' },
    { id: 'cmd_unban', trigger: '/unban', matchType: 'start', type: 'text', response: '🤝 @{target_name} разбанен.', mediaUrl: '', buttons: [], isSystem: true, allowedRoles: ['admin'], color: 'Blue' },
    { id: 'cmd_unmute', trigger: '/unmute', matchType: 'start', type: 'text', response: '🎤 @{target_name}, мут снят.', mediaUrl: '', buttons: [], isSystem: true, allowedRoles: ['admin'], color: 'Blue' },

    // 3. Warnings
    { id: 'cmd_warn', trigger: '/warn', matchType: 'start', type: 'text', response: '⚠️ @{target_name}, предупреждение ({warns}/3).', mediaUrl: '', buttons: [], isSystem: true, allowedRoles: ['admin'], color: 'Yellow' },
    { id: 'cmd_unwarn', trigger: '/unwarn', matchType: 'start', type: 'text', response: '🕊 @{target_name}, предупреждение снято. Счет: {warns}/3.', mediaUrl: '', buttons: [], isSystem: true, allowedRoles: ['admin'], color: 'Blue' },
    { id: 'sys_warn_limit', trigger: '_warn_limit_', matchType: 'exact', type: 'text', response: '🛑 @{target_name}, лимит предупреждений (3/3). Мут 48ч.', mediaUrl: '', buttons: [], isSystem: true, color: 'Red' },

    // 4. Utils/Misc
    { id: 'sys_daily_top', trigger: '_daily_top_', matchType: 'exact', type: 'text', response: '🏆 **ТОП-10 АКТИВНЫХ:**\n\n{top_list}', mediaUrl: '', buttons: [], isSystem: true, color: 'Purple' }
];

const base64ToBlob = (base64: string): Blob => {
    if (!base64.includes(',')) return new Blob();
    const arr = base64.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
};

const normalizeUrl = (url: string) => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `https://${url}`;
};

const playNotificationSound = () => {
    try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        audio.volume = 0.5;
        audio.play().catch(e => console.log('Audio play failed', e));
    } catch (e) { console.error(e); }
};

// Helper to reliably convert Firebase snapshots (which might be Objects with numeric keys) to Arrays
const toArray = <T,>(data: any): T[] => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return Object.values(data);
};

const App = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(true);
    const [activeTab, setActiveTab] = useState('dashboard');
    const [isRunning, setIsRunning] = useState(false); 
    const [loadedSections, setLoadedSections] = useState<Set<string>>(new Set());
    const [isAiThinking, setIsAiThinking] = useState(false);
    
    // Uptime & Status
    const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);
    const [uptime, setUptime] = useState(0);

    const [config, setConfig] = useState<BotConfig>({
        token: HARDCODED_CONFIG.token,
        targetChatId: HARDCODED_CONFIG.targetChatId,
        adminIds: HARDCODED_CONFIG.adminIds, 
        botName: 'Helix Bot',
        botUsername: 'helix_bot',
        enableAI: true, 
        enableAutoTop: true, 
        enablePM: true, 
        enableCalendarAlerts: true,
        openaiApiKey: GROQ_API_KEY, 
        aiBaseUrl: 'https://api.groq.com/openai/v1', 
        aiModel: 'llama-3.3-70b-versatile', 
        aiPersonality: 'helpful', 
        aiBehavior: 'balanced', 
        aiProfanity: false,
        aiTemperature: 0.3, // Lowered default for strictness
        aiMaxTokens: 1000, 
        bannedWords: '' 
    });
    
    const [users, setUsers] = useState<Record<string, UserType>>({});
    const [groups, setGroups] = useState<Record<string, Group>>({}); 
    const [topicNames, setTopicNames] = useState<Record<string, string>>({ 'general': 'Общий чат (General)' }); 
    const [topicHistory, setTopicHistory] = useState<Record<string, Message[]>>({ 'general': [] }); 
    const [topicUnreadCounts, setTopicUnreadCounts] = useState<Record<string, number>>({});
    
    const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
    const [auditLogs, setAuditLogs] = useState<LogEntry[]>([]);
    const [disabledAiTopics, setDisabledAiTopics] = useState<string[]>([]); 
    const [activeTopic, setActiveTopic] = useState('general');
    const [categories, setCategories] = useState(['Общее', 'Ивенты', 'Бонусы', 'Герои', 'Разное']);
    
    // Calendar State
    const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
    const [calendarCategories, setCalendarCategories] = useState<string[]>([
        '⚔️ Битвы (PvP)', '💎 Фарм и Ресурсы', 'Ω Особые Ивенты', '🏆 Кубок Всех Звезд', '📅 Другое'
    ]);

    const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeItem[]>([
        { id: 'kb_fishing', category: 'Ивенты', title: 'Гайд по Рыбалке', triggers: '', response: `Стратегия рыбалки: На озерах 1-2 ловите легкую рыбу...`, mediaUrl: '', buttons: [] }
    ]);
    const [commands, setCommands] = useState<Command[]>(DEFAULT_SYSTEM_COMMANDS);
    const [aiStats, setAiStats] = useState<AiStats>({ total: 0, history: [] }); 
    const [lastUpdateId, setLastUpdateId] = useState(0);
    const processedUpdateIds = useRef<Set<number>>(new Set());
    const isFetching = useRef(false);
    const hasClearedToday = useRef(false);
    const lastNotificationTime = useRef<string>(''); 
    const lastCalendarWrite = useRef(0);

    useEffect(() => { if ("Notification" in window && Notification.permission !== "granted") Notification.requestPermission(); }, []);

    // --- WAKE LOCK (Anti-Sleep) Logic ---
    const requestWakeLock = async () => {
        if ('wakeLock' in navigator) {
            try {
                if (wakeLock && !wakeLock.released) return;
                const lock = await (navigator as any).wakeLock.request('screen');
                setWakeLock(lock);
                console.log('Wake Lock active');
                lock.addEventListener('release', () => {
                    console.log('Wake Lock released');
                    setWakeLock(null);
                });
            } catch (err: any) {
                if (err.name !== 'NotAllowedError') {
                    console.error(`Wake Lock Error: ${err.message}`);
                }
            }
        }
    };

    const releaseWakeLock = async () => {
        if (wakeLock) {
            await wakeLock.release();
            setWakeLock(null);
        }
    };

    const toggleWakeLock = () => {
        if (wakeLock) releaseWakeLock();
        else requestWakeLock();
    };
    
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && isRunning && !wakeLock) {
                requestWakeLock();
            }
        };

        if (isRunning) {
            requestWakeLock();
            document.addEventListener('visibilitychange', handleVisibilityChange);
        } else {
            releaseWakeLock();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        }

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (wakeLock) releaseWakeLock();
        };
    }, [isRunning]);

    // Uptime counter
    useEffect(() => {
        let interval: any;
        if (isRunning) {
            interval = setInterval(() => setUptime(u => u + 1), 1000);
        } else {
            setUptime(0);
        }
        return () => clearInterval(interval);
    }, [isRunning]);

    const formatUptime = (sec: number) => {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const showNotification = (title: string, body: string) => {
        if (document.hidden && Notification.permission === "granted") new Notification(title, { body, icon: 'https://telegram.org/img/t_logo.png' });
    };

    const addLog = (action: string, details: string, type: 'info' | 'warning' | 'danger' | 'success' = 'info') => {
        const newLog: LogEntry = { id: Date.now().toString() + Math.random().toString().slice(2, 5), timestamp: Date.now(), admin: 'Администратор', action, details, type };
        // We update logs via setAuditLogs, and the useEffect below syncs it to Firebase
        setAuditLogs(prev => [newLog, ...prev].slice(0, 500));
    };

    // Firebase/Storage Sync
    const markLoaded = (section: string) => setLoadedSections(prev => new Set(prev).add(section));
    
    useEffect(() => {
        const unsubs: (Function | undefined)[] = [];

        // Helper to subscribe and store unsubscribe function
        const sub = (path: string, cb: (val: any) => void) => {
            const unsub = subscribeToData(path, cb);
            if (unsub) unsubs.push(unsub);
        };

        sub('config', (val) => { 
            if (val) {
                const apiKey = GROQ_API_KEY; 
                const baseUrl = val.aiBaseUrl || 'https://api.groq.com/openai/v1';
                let model = val.aiModel || 'llama-3.3-70b-versatile';
                if (model === 'llama3-70b-8192') model = 'llama-3.3-70b-versatile';

                setConfig(prev => ({
                    ...prev, 
                    ...val,
                    token: val.token && val.token.length > 10 ? val.token : HARDCODED_CONFIG.token,
                    targetChatId: val.targetChatId && val.targetChatId.length > 5 ? val.targetChatId : HARDCODED_CONFIG.targetChatId,
                    adminIds: val.adminIds || HARDCODED_CONFIG.adminIds,
                    openaiApiKey: apiKey,
                    aiBaseUrl: baseUrl,
                    aiModel: model
                })); 
            }
            markLoaded('config'); 
        });

        sub('users', (val) => { 
            if (val) { 
                // Firebase might return array for integer keys, or object for string keys.
                // We handle both, ensuring it's an object map for the app logic.
                const s = {...val}; 
                Object.values(s).forEach((u: any) => { 
                    if(!u.history) u.history = []; 
                    else u.history = toArray(u.history); // Fix array in user history
                }); 
                setUsers(s); 
            } else setUsers({}); 
            markLoaded('users'); 
        });
        
        sub('groups', (val) => { if (val) setGroups(val); else setGroups({}); markLoaded('groups'); }); 
        
        sub('knowledgeBase', (val) => { 
            const arr = toArray<KnowledgeItem>(val);
            setKnowledgeBase(arr); 
            markLoaded('knowledgeBase'); 
        });

        sub('commands', (val) => { 
            const loadedCmds = toArray<Command>(val);
            const merged = [...loadedCmds];
            // Ensure default system commands exist if not present
            DEFAULT_SYSTEM_COMMANDS.forEach(sys => { if(!merged.find(m => m.id === sys.id)) merged.push(sys); });
            setCommands(merged);
            markLoaded('commands');
        });

        sub('quickReplies', (val) => { 
            setQuickReplies(toArray<QuickReply>(val)); 
            markLoaded('quickReplies'); 
        });

        sub('auditLogs', (val) => { 
            setAuditLogs(toArray<LogEntry>(val)); 
            markLoaded('auditLogs'); 
        });

        sub('aiStats', (val) => { 
            if (val) { 
                if(!val.history) val.history = []; 
                else val.history = toArray(val.history);
                setAiStats(val); 
            } else setAiStats({total:0, history:[]}); 
            markLoaded('aiStats'); 
        });

        sub('categories', (val) => { if(val) setCategories(toArray(val)); markLoaded('categories'); });
        sub('topicNames', (val) => { if(val) setTopicNames(val); markLoaded('topicNames'); });
        sub('disabledAiTopics', (val) => { if(val) setDisabledAiTopics(toArray(val)); else setDisabledAiTopics([]); markLoaded('disabledAiTopics'); });
        
        sub('topicHistory', (val) => { 
            if(val) {
                // Ensure messages are arrays
                const cleanHistory: Record<string, Message[]> = {};
                Object.entries(val).forEach(([k, v]) => {
                    cleanHistory[k] = toArray(v);
                });
                setTopicHistory(cleanHistory); 
            } else {
                setTopicHistory({});
            }
            markLoaded('topicHistory'); 
        });
        
        sub('calendarEvents', (val) => { 
             // Prevent write-loop echo if we just wrote to DB
             if (Date.now() - lastCalendarWrite.current < 2000) return;
             setCalendarEvents(toArray<CalendarEvent>(val)); 
             markLoaded('calendarEvents'); 
        });
        
        sub('calendarCategories', (val) => { if(val) setCalendarCategories(toArray(val)); markLoaded('calendarCategories'); });

        return () => {
            unsubs.forEach(fn => fn && fn());
        };
    }, []);

    const canSave = (section: string) => isAuthenticated && loadedSections.has(section);
    
    // Wrapper to update calendar locally AND save to firebase
    const handleCalendarUpdate = (action: React.SetStateAction<CalendarEvent[]>) => {
        setCalendarEvents(prev => {
            const newValue = typeof action === 'function' ? action(prev) : action;
            lastCalendarWrite.current = Date.now();
            // Async save to avoid state update loops
            setTimeout(() => {
                saveData('calendarEvents', newValue);
            }, 0);
            return newValue;
        });
    };

    const handleCalendarCategoriesUpdate = (newCats: string[]) => {
        setCalendarCategories(newCats);
        saveData('calendarCategories', newCats);
    };

    const clearAiHistory = () => {
        // FULL RESET
        const emptyStats = { total: 0, history: [] };
        setAiStats(emptyStats);
        setTopicHistory({});

        setUsers(prev => {
            const clearedUsers = { ...prev };
            Object.keys(clearedUsers).forEach(key => {
                clearedUsers[key] = {
                    ...clearedUsers[key],
                    history: [],
                    msgCount: 0,
                    dailyMsgCount: 0
                };
            });
            // Need to save users immediately to reflect cleared history in DB
            saveData('users', clearedUsers);
            return clearedUsers;
        });

        // Force save
        saveData('aiStats', emptyStats); 
        saveData('topicHistory', {});
        
        addLog('Система', 'Полностью очищена вся история переписки и график активности', 'warning');
    };
    
    // --- GROUP MANAGEMENT ---
    const handleDeleteGroup = async (groupId: string) => {
        // 1. Leave Chat via API immediately without confirmation
        try {
            await apiCall('leaveChat', { chat_id: groupId }, config);
        } catch (e: any) {
            console.error('API Error leaving chat:', e);
        }
            
        // 2. Update State (auto-saves to Firebase) IMMEDIATELY
        setGroups(prev => {
            const newGroups = { ...prev };
            delete newGroups[groupId];
            return newGroups;
        });

        addLog('Группы', `Группа ${groupId} удалена (Бот покинул чат)`, 'danger');
    };

    // --- AUTO-SAVE EFFECTS ---
    // These effects trigger when React State changes, pushing data to Firebase.
    // We check 'canSave' to ensure we don't overwrite DB with empty initial state.

    useEffect(() => { if (canSave('config')) saveData('config', config); }, [config, loadedSections, isAuthenticated]);
    // Users are updated frequently, debounce could be added here if needed, but for now direct save is OK for <500 users
    useEffect(() => { if (canSave('users')) saveData('users', users); }, [users, loadedSections, isAuthenticated]);
    useEffect(() => { if (canSave('groups')) saveData('groups', groups); }, [groups, loadedSections, isAuthenticated]); 
    useEffect(() => { if (canSave('knowledgeBase')) saveData('knowledgeBase', knowledgeBase); }, [knowledgeBase, loadedSections, isAuthenticated]);
    useEffect(() => { if (canSave('commands')) saveData('commands', commands); }, [commands, loadedSections, isAuthenticated]);
    useEffect(() => { if (canSave('aiStats')) saveData('aiStats', aiStats); }, [aiStats, loadedSections, isAuthenticated]);
    useEffect(() => { if (canSave('categories')) saveData('categories', categories); }, [categories, loadedSections, isAuthenticated]);
    useEffect(() => { if (canSave('topicNames')) saveData('topicNames', topicNames); }, [topicNames, loadedSections, isAuthenticated]);
    useEffect(() => { if (canSave('disabledAiTopics')) saveData('disabledAiTopics', disabledAiTopics); }, [disabledAiTopics, loadedSections, isAuthenticated]);
    useEffect(() => { if (canSave('quickReplies')) saveData('quickReplies', quickReplies); }, [quickReplies, loadedSections, isAuthenticated]);
    useEffect(() => { if (canSave('auditLogs')) saveData('auditLogs', auditLogs); }, [auditLogs, loadedSections, isAuthenticated]);
    
    // Topic History optimization: Only save last 100 messages per topic to DB to save space
    useEffect(() => { 
        if (canSave('topicHistory')) { 
            const h = Object.entries(topicHistory).reduce((acc, [k, v]) => { 
                acc[k] = (v as Message[]).slice(-100); 
                return acc; 
            }, {} as Record<string, Message[]>); 
            saveData('topicHistory', h); 
        } 
    }, [topicHistory, loadedSections, isAuthenticated]);

    // Notification Logic (Checking every minute)
    useEffect(() => {
        const checkNotifications = async () => {
            const now = new Date();
            const currentHour = now.getHours().toString().padStart(2, '0');
            const currentMinute = now.getMinutes().toString().padStart(2, '0');
            const currentTimeStr = `${currentHour}:${currentMinute}`;
            
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const todayStr = `${year}-${month}-${day}`;

            if (lastNotificationTime.current === `${todayStr} ${currentTimeStr}`) return;
            lastNotificationTime.current = `${todayStr} ${currentTimeStr}`;

            if (config.enableCalendarAlerts !== false) {
                for (const event of calendarEvents) {
                    const eventTime = event.notifyTime || '09:00';
                    const notifyDateStr = event.notifyDate || event.startDate;

                    if (todayStr === notifyDateStr && currentTimeStr === eventTime) {
                        const msg = `⚡️ <b>${event.title}</b>\n\n` +
                                    `📅 <b>Даты:</b> ${event.startDate} — ${event.endDate}\n` +
                                    `📂 <i>Категория: ${event.category}</i>\n\n` +
                                    `${event.description || ''}`;
                        
                        const targetThread = event.topicId && event.topicId !== 'general' ? event.topicId : null;
                        
                        const inlineKeyboard = event.buttons && event.buttons.length > 0 
                            ? { inline_keyboard: event.buttons.map(b => {
                                const url = normalizeUrl(b.url);
                                return [ url ? { text: b.text, url } : { text: b.text, callback_data: 'cb_cal' } ];
                            }) }
                            : undefined;
                        
                        const markupString = inlineKeyboard ? JSON.stringify(inlineKeyboard) : undefined;

                        if (event.mediaUrl && event.mediaUrl.startsWith('data:')) {
                            try {
                                const blob = base64ToBlob(event.mediaUrl);
                                const fd = new FormData();
                                fd.append('chat_id', config.targetChatId);
                                fd.append('photo', blob, 'image.jpg');
                                fd.append('caption', msg);
                                fd.append('parse_mode', 'HTML');
                                if (markupString) fd.append('reply_markup', markupString);
                                if (targetThread) fd.append('message_thread_id', targetThread);
                                await apiCall('sendPhoto', fd, config, true);
                            } catch (e) {
                                console.error('Error sending event photo', e);
                            }
                        } else {
                            await apiCall('sendMessage', { 
                                chat_id: config.targetChatId, 
                                text: msg,
                                parse_mode: 'HTML',
                                reply_markup: inlineKeyboard, 
                                message_thread_id: targetThread
                            }, config);
                        }
                        
                        addLog('Календарь', `Уведомление о "${event.title}" отправлено`, 'info');
                    }
                }
            }

            if (currentHour === '00' && currentMinute === '00') {
                if (!hasClearedToday.current) {
                    addLog('Система', 'Ежедневное обслуживание (00:00)', 'info');
                    if (config.enableAutoTop) {
                        const topUsers = (Object.values(users) as UserType[]).filter((u: UserType) => u.dailyMsgCount > 0).sort((a, b) => b.dailyMsgCount - a.dailyMsgCount).slice(0, 10);
                        if (topUsers.length > 0) {
                            const list = topUsers.map((u, i) => `${i + 1}. ${u.name} — ${u.dailyMsgCount}`).join('\n');
                            const cmd = commands.find(c => c.id === 'sys_daily_top');
                            if (cmd) await apiCall('sendMessage', { chat_id: config.targetChatId, text: cmd.response.replace('{top_list}', list), message_thread_id: cmd.notificationTopicId || null }, config);
                        }
                    }
                    setUsers(prev => { const u = { ...prev }; Object.keys(u).forEach(k => { u[k] = { ...u[k], dailyMsgCount: 0, lastActiveDate: new Date().toLocaleDateString() }; }); return u; });
                    setAiStats({ total: 0, history: [] });
                    setTopicHistory({});
                    hasClearedToday.current = true;
                }
            } else {
                hasClearedToday.current = false;
            }
        };

        const interval = setInterval(checkNotifications, 30000); 
        checkNotifications(); 
        return () => clearInterval(interval);
    }, [users, config, aiStats, commands, loadedSections, calendarEvents]);

    useEffect(() => { setTopicUnreadCounts(prev => ({ ...prev, [activeTopic]: 0 })); }, [activeTopic]);

    const sendResponse = async (chatId: string | number, content: Command, userContext: any = {}, fileObj: File | null = null, topicId: string | null = null) => {
        const targetThreadId = (content.isSystem && content.notificationTopicId) ? content.notificationTopicId : topicId;
        
        let finalText = (content.response || content.trigger || '')
            .replace(/{name}/g, userContext.first_name || '')
            .replace(/{username}/g, userContext.username ? '@'+userContext.username : userContext.first_name || '')
            .replace(/{target_name}/g, userContext.target_name || 'Пользователь')
            .replace(/{warns}/g, String(userContext.warns !== undefined ? userContext.warns : 0));
            
        // Fix: Ensure mutual exclusivity of fields
        const inlineKeyboard = content.buttons?.length > 0 
            ? { inline_keyboard: content.buttons.map(b => {
                const url = normalizeUrl(b.url);
                return [ url ? { text: b.text, url } : { text: b.text, callback_data: 'cb' } ];
            }) }
            : undefined;
        
        const markupString = inlineKeyboard ? JSON.stringify(inlineKeyboard) : undefined;
        
        const bodyBase: any = { chat_id: chatId };
        if (targetThreadId) bodyBase.message_thread_id = targetThreadId;
        
        let finalFile = fileObj;
        if (content.mediaUrl && content.mediaUrl.startsWith('data:')) {
             try {
                 const blob = base64ToBlob(content.mediaUrl);
                 const isVideo = content.mediaUrl.startsWith('data:video');
                 finalFile = new File([blob], isVideo ? "video.mp4" : "image.jpg", { type: blob.type });
             } catch(e) { console.error("Base64 err", e); }
        }

        if ((content.mediaUrl && !content.mediaUrl.startsWith('data:')) || finalFile) {
            const fd = new FormData();
            Object.entries(bodyBase).forEach(([k,v]) => { if(v) fd.append(k,v as string); });
            
            if (finalFile) {
                 if (finalFile.type.startsWith('video')) fd.append('video', finalFile);
                 else fd.append('photo', finalFile);
            } else if (content.mediaUrl) {
                fd.append('photo', content.mediaUrl);
            }
            
            if(finalText) fd.append('caption', finalText);
            if(markupString) fd.append('reply_markup', markupString);
            
            const method = (finalFile && finalFile.type.startsWith('video')) ? 'sendVideo' : 'sendPhoto';
            await apiCall(method, fd, config, true);
        } else {
            await apiCall('sendMessage', { 
                ...bodyBase, 
                text: finalText, 
                reply_markup: inlineKeyboard 
            }, config);
        }

        const outgoingMediaUrl = content.mediaUrl || (finalFile ? URL.createObjectURL(finalFile) : undefined);
        const outgoingType = finalFile || content.mediaUrl ? 'photo' : 'text';
        
        // --- ADD TIMESTAMP HERE ---
        if (String(chatId) === config.targetChatId) {
             const tId = targetThreadId || 'general';
             const newMsg: Message = { id: Math.random().toString(), user: 'Bot', userId: 0, text: finalText, time: new Date().toLocaleTimeString(), timestamp: Date.now(), isIncoming: false, type: outgoingType, mediaUrl: outgoingMediaUrl, buttons: content.buttons || [] };
             setTopicHistory(prev => ({ ...prev, [tId]: [...(prev[tId] || []), newMsg] }));
        }

        if (users[chatId]) {
            setUsers(prev => {
                const u = prev[chatId];
                if (!u) return prev;
                // --- ADD TIMESTAMP HERE ---
                const newMsg = { 
                    dir: 'out', 
                    text: finalText, 
                    type: outgoingType, 
                    mediaUrl: outgoingMediaUrl, 
                    time: new Date().toLocaleTimeString(), 
                    timestamp: Date.now(), 
                    buttons: content.buttons || [],
                    isGroup: false
                };
                return { 
                    ...prev, 
                    [chatId]: { ...u, history: [...(u.history || []), newMsg as any] } 
                };
            });
        }
    };

    // Callback used by Broadcast component to update CRM history
    const handleBroadcastSent = (userId: number | string, text: string, type: 'text'|'photo'|'video', mediaUrl?: string) => {
        setUsers(prev => {
            const u = prev[userId];
            if (!u) return prev;
            // --- ADD TIMESTAMP HERE ---
            const newMsg = { 
                dir: 'out', 
                text: text, 
                type: type, 
                mediaUrl: mediaUrl, 
                time: new Date().toLocaleTimeString(), 
                timestamp: Date.now(), 
                isGroup: false
            };
            return { 
                ...prev, 
                [userId]: { ...u, history: [...(u.history || []), newMsg as any] } 
            };
        });
    };

    // --- MESSAGE HANDLER ---
    const handleUpdate = async (update: any) => {
        if (processedUpdateIds.current.has(update.update_id)) return;
        processedUpdateIds.current.add(update.update_id);
        if (processedUpdateIds.current.size > 1000) processedUpdateIds.current = new Set(Array.from(processedUpdateIds.current).slice(500));

        const msg = update.message || update.edited_message;
        if (msg) {
            const chatId = msg.chat.id;
            
            // --- SECURITY: Foreign Chat Block ---
            // If the chat is NOT the main target chat AND NOT in our known groups,
            // we treat it as a new "foreign" group.
            // By default, we add it as DISABLED.
            const isTargetChat = String(chatId) === String(config.targetChatId);
            const isPrivate = msg.chat.type === 'private';
            
            if (!isPrivate && !isTargetChat) {
                // If it's a new group we haven't seen, add it but DISABLE it by default
                if (!groups[chatId]) {
                    setGroups(prev => ({ 
                        ...prev, 
                        [chatId]: { 
                            id: chatId, 
                            title: msg.chat.title || 'Unknown Group', 
                            type: msg.chat.type, 
                            lastActive: new Date().toLocaleTimeString(), 
                            isDisabled: true // DEFAULT DISABLED
                        } 
                    }));
                    // Log attempt
                    addLog('Безопасность', `Бот добавлен в новую группу "${msg.chat.title}" (ID: ${chatId}). Автоматически отключено.`, 'warning');
                    return; // Stop processing
                }
                
                // If it exists but is disabled, ignore
                if (groups[chatId].isDisabled) {
                    return;
                }
            }

            // Normal Disabled Check
            if (groups[chatId] && groups[chatId].isDisabled) return;

            if (msg.new_chat_members) {
                const welcomeCmd = commands.find(c => c.id === 'welcome_event');
                if (welcomeCmd) {
                    for (const member of msg.new_chat_members) {
                        if (!member.is_bot) {
                            sendResponse(chatId, welcomeCmd, { first_name: member.first_name, username: member.username }, null, msg.message_thread_id);
                        }
                    }
                }
            }

            const user = msg.from;
            const text = (msg.text || msg.caption || '').trim();
            const today = new Date().toLocaleDateString();
            const nowTime = new Date().toLocaleTimeString('ru-RU');
            
            if (!msg.from.is_bot && (isPrivate || isTargetChat)) {
                if (document.hidden) showNotification(`Новое сообщение: ${user.first_name}`, text);
                playNotificationSound();
            }

            if (msg.chat.type === 'supergroup' || msg.chat.type === 'group') {
                setGroups(prev => ({ ...prev, [chatId]: { ...prev[chatId], id: chatId, title: msg.chat.title, type: msg.chat.type, lastActive: nowTime, isDisabled: prev[chatId]?.isDisabled || false } }));
            }
            // If private or target chat or enabled group
            if (!isPrivate && !groups[chatId] && !isTargetChat) return;

            const isIgnoredUser = user.id === 777000 || user.id === 1087968824 || user.is_bot;
            let senderRole: 'admin' | 'moderator' | 'user' = 'user';
            const adminList = config.adminIds.split(',').map(s => s.trim());
            if (adminList.includes(String(user.id)) || user.id === 1087968824 || user.id === 777000) senderRole = 'admin';

            if (config.bannedWords && !msg.from.is_bot && senderRole !== 'admin') {
                const bannedList = config.bannedWords.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
                if (bannedList.some(w => text.toLowerCase().includes(w))) {
                    await apiCall('deleteMessage', { chat_id: chatId, message_id: msg.message_id }, config);
                    return; 
                }
            }

            if (!isIgnoredUser) {
                setUsers(prev => {
                    const existing = prev[user.id];
                    let role = existing?.role || senderRole;
                    if (adminList.includes(String(user.id))) role = 'admin';

                    const u = existing || { id: user.id, name: user.first_name, username: user.username || '', status: 'active', role: role, joinDate: today, warnings: 0, msgCount: 0, dailyMsgCount: 0, lastActiveDate: today, history: [], notes: '', unreadCount: 0 };
                    
                    if (u.lastActiveDate !== today) { 
                        u.dailyMsgCount = 0; 
                        u.lastActiveDate = today; 
                    }
                    
                    const shouldIncrementUnread = isPrivate;
                    
                    // --- ADD TIMESTAMP HERE ---
                    return { ...prev, [user.id]: { ...u, msgCount: u.msgCount + 1, dailyMsgCount: u.dailyMsgCount + 1, lastSeen: nowTime, unreadCount: shouldIncrementUnread ? (u.unreadCount || 0) + 1 : (u.unreadCount || 0), history: [...(u.history || []), { dir: 'in', msgId: msg.message_id, text: text, type: msg.photo ? 'photo' : 'text', time: nowTime, timestamp: Date.now(), isIncoming: true, isGroup: !isPrivate }] } };
                });
            }

            let threadId = msg.message_thread_id ? String(msg.message_thread_id) : 'general';
            if (msg.forum_topic_created) setTopicNames(prev => ({ ...prev, [threadId]: msg.forum_topic_created.name }));
            else if (!topicNames[threadId] && (isTargetChat || groups[chatId])) setTopicNames(prev => ({ ...prev, [threadId]: threadId === 'general' ? 'Общий чат' : `Topic #${threadId}` }));

            if ((isTargetChat || groups[chatId]) && (activeTab !== 'livechat' || activeTopic !== threadId)) {
                setTopicUnreadCounts(prev => ({ ...prev, [threadId]: (prev[threadId] || 0) + 1 }));
            }

            if (isTargetChat || groups[chatId]) {
                // --- ADD TIMESTAMP HERE ---
                const newMessageObj: Message = { id: Math.random().toString(), msgId: msg.message_id, user: user.first_name, userId: user.id, text: text, time: nowTime, timestamp: Date.now(), isIncoming: true, type: msg.photo ? 'photo' : 'text' };
                setTopicHistory(prev => ({ ...prev, [threadId]: [...(prev[threadId] || []), newMessageObj] }));
            }

            // --- COMMANDS LOGIC ---
            let commandExecuted = false;
            
            const parts = text.split(' ');
            const commandName = parts[0].toLowerCase();
            
            const checkPermission = (cmd: Command) => {
                const allowed = cmd.allowedRoles || ['user', 'moderator', 'admin'];
                // Default to allowed if no roles defined
                if (!cmd.allowedRoles || cmd.allowedRoles.length === 0) return true;
                return allowed.includes(senderRole);
            };

            let targetUserId: number | null = null;
            let targetName = 'User';

            if (msg.reply_to_message) {
                targetUserId = msg.reply_to_message.from.id;
                targetName = msg.reply_to_message.from.first_name;
            }

            if (text.startsWith('/') && ['/mute', '/unmute', '/ban', '/unban', '/kick', '/warn', '/unwarn'].includes(commandName) && targetUserId) {
                 const sysCmdId = commandName === '/mute' ? 'cmd_mute' : commandName === '/ban' ? 'cmd_ban' : commandName === '/warn' ? 'cmd_warn' : 'cmd_kick'; 
                 const cmdConfig = commands.find(c => c.trigger === commandName) || commands.find(c => c.id === sysCmdId);
                 
                 // --- ADMIN PROTECTION ---
                 const targetIsAdmin = adminList.includes(String(targetUserId)) || targetUserId === 1087968824 || targetUserId === 777000;
                 if (targetIsAdmin) {
                     sendResponse(chatId, { 
                         id: 'admin_protect', 
                         trigger: '', 
                         matchType: 'exact', 
                         type: 'text', 
                         response: '⛔ Нельзя применять санкции к администраторам!', 
                         mediaUrl: '', 
                         buttons: [], 
                         isSystem: true 
                     }, {}, null, msg.message_thread_id);
                     commandExecuted = true;
                 } else if (cmdConfig && checkPermission(cmdConfig)) {
                    let success = false;
                    let responseCmdId = '';
                    let currentWarns = users[targetUserId]?.warnings || 0;

                    if (commandName === '/mute') {
                        const durationStr = parts[1] || '60m';
                        const multiplier = durationStr.endsWith('d') ? 86400 : durationStr.endsWith('h') ? 3600 : 60;
                        const val = parseInt(durationStr);
                        const seconds = val * multiplier;
                        const untilDate = Math.floor(Date.now() / 1000) + seconds;
                        await apiCall('restrictChatMember', { chat_id: chatId, user_id: targetUserId, permissions: JSON.stringify({ can_send_messages: false }), until_date: untilDate }, config);
                        setUsers(p => p[targetUserId!] ? ({ ...p, [targetUserId!]: { ...p[targetUserId!], status: 'muted' } }) : p);
                        responseCmdId = 'cmd_mute'; success = true;
                    } 
                    else if (commandName === '/unmute') {
                        const perms = { can_send_messages: true, can_send_media_messages: true, can_send_other_messages: true };
                        await apiCall('restrictChatMember', { chat_id: chatId, user_id: targetUserId, permissions: JSON.stringify(perms) }, config);
                        setUsers(p => p[targetUserId!] ? ({ ...p, [targetUserId!]: { ...p[targetUserId!], status: 'active' } }) : p);
                        responseCmdId = 'cmd_unmute'; success = true;
                    }
                    else if (commandName === '/ban') {
                        await apiCall('banChatMember', { chat_id: chatId, user_id: targetUserId }, config);
                        setUsers(p => p[targetUserId!] ? ({ ...p, [targetUserId!]: { ...p[targetUserId!], status: 'banned' } }) : p);
                        responseCmdId = 'cmd_ban'; success = true;
                    }
                    else if (commandName === '/unban') {
                        await apiCall('unbanChatMember', { chat_id: chatId, user_id: targetUserId, only_if_banned: true }, config);
                        setUsers(p => p[targetUserId!] ? ({ ...p, [targetUserId!]: { ...p[targetUserId!], status: 'active' } }) : p);
                        responseCmdId = 'cmd_unban'; success = true;
                    }
                    else if (commandName === '/kick') {
                        await apiCall('banChatMember', { chat_id: chatId, user_id: targetUserId, until_date: Math.floor(Date.now()/1000)+40 }, config);
                        responseCmdId = 'cmd_kick'; success = true;
                    }
                    else if (commandName === '/warn') {
                        const newWarns = currentWarns + 1;
                        currentWarns = newWarns;
                        if (newWarns >= 3) {
                            await apiCall('restrictChatMember', { chat_id: chatId, user_id: targetUserId, permissions: JSON.stringify({ can_send_messages: false }), until_date: Math.floor(Date.now()/1000)+172800 }, config);
                            responseCmdId = 'sys_warn_limit'; currentWarns = 3;
                            setUsers(p => p[targetUserId!] ? ({ ...p, [targetUserId!]: { ...p[targetUserId!], status: 'muted', warnings: 0 } }) : p);
                        } else {
                            responseCmdId = 'cmd_warn';
                            setUsers(p => p[targetUserId!] ? ({ ...p, [targetUserId!]: { ...p[targetUserId!], warnings: newWarns } }) : p);
                        }
                        success = true;
                    }
                    else if (commandName === '/unwarn') {
                        const newWarns = Math.max(0, currentWarns - 1);
                        currentWarns = newWarns;
                        responseCmdId = newWarns === 0 ? 'cmd_unwarn' : 'sys_unwarn';
                        setUsers(p => p[targetUserId!] ? ({ ...p, [targetUserId!]: { ...p[targetUserId!], warnings: newWarns } }) : p);
                        success = true;
                    }

                    if (success && responseCmdId) {
                        const respCmd = commands.find(c => c.id === responseCmdId) || cmdConfig;
                        if (respCmd) sendResponse(chatId, respCmd, { target_name: targetName, warns: currentWarns }, null, msg.message_thread_id);
                        commandExecuted = true;
                    }
                 }
            }
            
            if (!commandExecuted) {
                const foundCmd = commands.find(c => {
                    let match = false;
                    const trigger = c.trigger.toLowerCase().trim();
                    const msgTextLower = text.toLowerCase().trim();
                    
                    if (c.matchType === 'exact') {
                        if (msgTextLower === trigger) match = true;
                    } else if (c.matchType === 'start') {
                        if (msgTextLower.startsWith(trigger)) match = true;
                    } else if (c.matchType === 'contains') {
                        if (msgTextLower.includes(trigger)) match = true;
                    }
                    
                    if (!match) return false;
                    if (!checkPermission(c)) return false;
                    
                    // Improved Topic Logic: undefined/null/empty means "All Topics"
                    if (c.allowedTopicId && c.allowedTopicId !== '') {
                        if (c.allowedTopicId === 'private_only') { 
                            if (!isPrivate) return false; 
                        } else { 
                            if (isPrivate) return false; 
                            if (String(c.allowedTopicId) !== String(threadId)) return false; 
                        }
                    }
                    return true;
                });

                if (foundCmd) {
                    sendResponse(chatId, foundCmd, user, null, msg.message_thread_id);
                    commandExecuted = true;
                }
            }

            if (!commandExecuted) {
                if (isPrivate && !config.enablePM) return;
                const isAIRequest = (/хеликс|helix|h[eе]l[iі]x/i).test(text) && (!msg.from.is_bot || senderRole === 'admin');
                
                if (isAIRequest && !disabledAiTopics.includes(threadId)) {
                    const cleanQuestion = text.replace(new RegExp(/хеликс|helix|h[eе]l[iі]x/i, 'gi'), '').trim();
                    if (config.enableAI) {
                        setIsAiThinking(true);
                        try {
                            const kbContext = knowledgeBase.map(kb => `[${kb.category}] ${kb.title}: ${kb.response}`).join('\n');
                            let ans = await getAIResponse(cleanQuestion || 'Привет', config, kbContext);
                            if (ans) {
                                sendResponse(chatId, { id: 'ai', trigger: '', matchType: 'exact', type: 'text', response: ans, mediaUrl: '', buttons: [], isSystem: false }, user, null, msg.message_thread_id);
                                
                                setAiStats(prev => ({ total: prev.total + 1, history: [{ query: cleanQuestion || 'Hello', response: ans, time: Date.now() }, ...(prev.history || [])].slice(0, 500) }));
                            }
                        } catch (err) { console.error(err); } finally { setIsAiThinking(false); }
                    }
                }
            }
        }
    };

    const handleUpdateRef = useRef<(u: any) => Promise<void>>(async () => {});
    useEffect(() => { handleUpdateRef.current = handleUpdate; });

    useEffect(() => {
        if (!isRunning) return;
        let isCancelled = false;
        const fetchUpdates = async () => {
            if (isFetching.current) return;
            isFetching.current = true;
            try {
                const res = await apiCall('getUpdates', { offset: lastUpdateId + 1, timeout: 30 }, config);
                if (res.ok && res.result && !isCancelled) {
                    for (const update of res.result) { await handleUpdateRef.current(update); setLastUpdateId(update.update_id); }
                }
            } catch (e) { console.error(e); } finally { isFetching.current = false; if (!isCancelled && isRunning) setTimeout(fetchUpdates, 1000); }
        };
        fetchUpdates();
        return () => { isCancelled = true; };
    }, [isRunning, lastUpdateId, config]);

    const toggleAiForTopic = (tid: string) => setDisabledAiTopics(p => p.includes(tid) ? p.filter(t => t !== tid) : [...p, tid]);
    const renameTopic = (tid: string, name: string) => setTopicNames(p => ({ ...p, [tid]: name }));
    const handleClearTopic = (tid: string) => setTopicHistory(p => ({ ...p, [tid]: [] }));

    const totalUnread = (Object.values(users) as UserType[]).reduce((acc, u) => acc + (u.unreadCount || 0), 0);

    const TabButton = ({ id, iconKey, label, badge }: { id: string, iconKey: keyof typeof Icons, label: string, badge?: number }) => {
        const isActive = activeTab === id; const Icon = Icons[iconKey];
        return ( 
            <button 
                onClick={() => setActiveTab(id)} 
                className={`w-full flex items-center space-x-3 px-4 py-3.5 rounded-xl transition-all duration-300 group relative overflow-hidden ${isActive ? 'text-white bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg shadow-blue-500/20' : (id === 'users' && badge && badge > 0) ? 'text-blue-400 bg-blue-900/10 hover:bg-blue-900/20' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
            >
                <Icon size={20} className={`transition-colors relative z-10 ${isActive ? 'text-white' : 'text-gray-500 group-hover:text-white'}`} />
                <span className="font-medium text-sm relative z-10 flex-1 text-left">{label}</span>
                {badge && badge > 0 && <span className="relative z-10 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{badge}</span>}
                {isActive && <div className="absolute inset-0 bg-white/10 rounded-xl"></div>}
            </button> 
        );
    };

    return (
        <div className="flex h-screen bg-[#09090b] text-gray-100 font-sans overflow-hidden">
            <div className="w-72 bg-[#0c0c0e] border-r border-gray-800 flex flex-col shrink-0 relative z-20">
                <div className="p-8">
                    <div className="flex items-center space-x-3 text-blue-500 mb-2">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-900/30 text-white">
                            <Icons.Zap size={24} />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-white tracking-tight">Бот Helix</h1>
                            <span className="text-[10px] text-gray-500 font-medium uppercase tracking-widest">Панель админа</span>
                        </div>
                    </div>
                    <div className="flex items-center justify-between bg-black/30 rounded-lg p-2 border border-gray-800/50 mt-4">
                        <div className="flex items-center gap-2">
                             <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                             <span className="text-[10px] font-mono text-gray-400">{isRunning ? formatUptime(uptime) : 'OFFLINE'}</span>
                        </div>
                        <button onClick={toggleWakeLock} className={`p-1 rounded ${wakeLock ? 'text-yellow-400 bg-yellow-900/20' : 'text-gray-600 hover:text-white'}`} title="Режим 'Не спать' (Экран не гаснет)">
                            <Icons.Zap size={12}/>
                        </button>
                    </div>
                </div>
                
                <div className="px-4 space-y-2 flex-1 overflow-y-auto custom-scrollbar pb-4">
                    <div className="text-[10px] uppercase font-bold text-gray-600 px-4 mb-2 mt-2">Управление</div>
                    <TabButton id="dashboard" iconKey="Activity" label="Обзор" />
                    <TabButton id="livechat" iconKey="MessageCircle" label="Live Chat" />
                    <TabButton id="users" iconKey="Users" label="CRM Пользователи" badge={totalUnread} />
                    <TabButton id="broadcasts" iconKey="Zap" label="Рассылки" />
                    <div className="text-[10px] uppercase font-bold text-gray-600 px-4 mb-2 mt-6">Автоматизация</div>
                    <TabButton id="calendar" iconKey="Calendar" label="Календарь Событий" />
                    <TabButton id="commands" iconKey="Terminal" label="Команды" />
                    <TabButton id="knowledge" iconKey="BookOpen" label="База знаний" />
                    <div className="text-[10px] uppercase font-bold text-gray-600 px-4 mb-2 mt-6">Система</div>
                    <TabButton id="logs" iconKey="Shield" label="Журнал (Audit)" />
                    <TabButton id="settings" iconKey="Settings" label="Настройки" />
                </div>

                <div className="p-4 border-t border-gray-800/50 bg-[#0c0c0e]">
                    <button onClick={() => { setIsRunning(!isRunning); addLog('Система', isRunning ? 'Бот остановлен' : 'Бот запущен', 'info'); }} className={`w-full py-3 rounded-xl text-xs font-bold uppercase transition-all duration-300 shadow-lg ${isRunning ? 'bg-gray-800 text-red-400 hover:bg-red-900/20 border border-transparent' : 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-400 hover:to-teal-400 shadow-emerald-900/20'}`}>
                        <span className="flex items-center justify-center gap-2">
                            {isRunning ? <><Icons.Pause size={14}/> Остановить</> : <><Icons.Play size={14}/> Запустить Бота</>}
                        </span>
                    </button>
                </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0 bg-[#0f0f12] relative overflow-hidden">
                <div className="flex-1 overflow-auto p-8 scroll-smooth custom-scrollbar">
                    <div className="max-w-[95%] mx-auto h-full">
                        {activeTab === 'dashboard' && <Dashboard users={users} groups={groups} setGroups={setGroups} aiStats={aiStats} config={config} setConfig={setConfig} isAiThinking={isAiThinking} setAiStats={setAiStats} addLog={addLog} setActiveTab={setActiveTab} onStopBot={() => setIsRunning(false)} onClearAiStats={clearAiHistory} viewMode="overview" auditLogs={auditLogs} onDeleteGroup={handleDeleteGroup} />}
                        {activeTab === 'livechat' && <LiveChat topicNames={topicNames} topicHistory={topicHistory} activeTopic={activeTopic} setActiveTopic={setActiveTopic} isAiThinking={isAiThinking} disabledAiTopics={disabledAiTopics} onToggleAi={toggleAiForTopic} onClearTopic={handleClearTopic} onRenameTopic={renameTopic} unreadCounts={topicUnreadCounts} quickReplies={quickReplies} setQuickReplies={setQuickReplies} onSendMessage={(data) => { const tId = activeTopic === 'general' ? null : activeTopic; const cmd: Command = { id: 'manual', trigger: '', matchType: 'exact', type: 'text', response: data.text, mediaUrl: data.mediaUrl || '', buttons: data.buttons || [], isSystem: false }; sendResponse(config.targetChatId, cmd, {}, data.mediaFile || null, tId); }} />}
                        {activeTab === 'users' && <UserCRM users={users} setUsers={setUsers} config={config} commands={commands} topicNames={topicNames} addLog={addLog} />}
                        {activeTab === 'broadcasts' && <Broadcasts users={users} config={config} addLog={addLog} onBroadcastSent={handleBroadcastSent} />}
                        {activeTab === 'calendar' && <CalendarEvents events={calendarEvents} setEvents={handleCalendarUpdate} categories={calendarCategories} setCategories={handleCalendarCategoriesUpdate} topicNames={topicNames} addLog={addLog} config={config} />}
                        {activeTab === 'commands' && <Commands commands={commands} setCommands={setCommands} topicNames={topicNames} />}
                        {activeTab === 'knowledge' && <KnowledgeBase items={knowledgeBase} categories={categories} setItems={setKnowledgeBase} setCategories={setCategories} addLog={addLog} />}
                        {activeTab === 'logs' && <AuditLogs logs={auditLogs} setLogs={setAuditLogs} />}
                        {activeTab === 'settings' && <Dashboard users={users} groups={groups} setGroups={setGroups} aiStats={aiStats} config={config} setConfig={setConfig} isAiThinking={isAiThinking} setAiStats={setAiStats} addLog={addLog} setActiveTab={setActiveTab} onStopBot={() => setIsRunning(false)} onClearAiStats={clearAiHistory} viewMode="settings" />}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;
