
import React, { useState, useEffect } from 'react';
import { Icons } from './components/Icons';
import Dashboard from './components/Dashboard';
import LiveChat from './components/LiveChat';
import KnowledgeBase from './components/KnowledgeBase';
import Commands from './components/Commands'; 
import Broadcasts from './components/Broadcasts'; 
import AuditLogs from './components/AuditLogs'; 
import CalendarEvents from './components/CalendarEvents';
import { BotConfig, Command, KnowledgeItem, AiStats, AiStat, Group, QuickReply, LogEntry, CalendarEvent, User as UserType } from './types';
import { apiCall } from './services/api';
import UserCRM from './components/UserCRM';
import { subscribeToData, saveData, removeData } from './services/firebase'; 

// Encrypted Password: 88005553535 -> Base64
const SECURE_HASH = "ODgwMDU1NTM1MzU=";

const HARDCODED_CONFIG = {
    token: '7614990025:AAEGbRiUO3zPR1VFhwTPgQ4eHVX-eo5snPI',
    targetChatId: '-1003724305882',
    adminIds: '8098674553'
};

const GROQ_API_KEY = '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';

const toArray = <T,>(data: any): T[] => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return Object.values(data);
};

const App = () => {
    // Auth State
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [passwordInput, setPasswordInput] = useState('');
    const [authError, setAuthError] = useState(false);

    const [activeTab, setActiveTab] = useState('dashboard');
    const [isBotActive, setIsBotActive] = useState(true); 
    const [lastHeartbeat, setLastHeartbeat] = useState(0);
    const [loadedSections, setLoadedSections] = useState<Set<string>>(new Set());
    const [isSidebarOpen, setIsSidebarOpen] = useState(false); // Mobile sidebar state
    
    // Config
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
        customProfanity: '',
        customProfanityList: [],
        aiTemperature: 0.3,
        aiMaxTokens: 1000,
        aiStrictness: 80, // Default High Accuracy
        bannedWords: '' 
    });
    
    // Data States
    const [users, setUsers] = useState<Record<string, UserType>>({});
    const [groups, setGroups] = useState<Record<string, Group>>({}); 
    const [topicNames, setTopicNames] = useState<Record<string, string>>({ 'general': 'Общий чат (General)' }); 
    const [topicHistory, setTopicHistory] = useState<Record<string, any[]>>({ 'general': [] }); 
    const [topicUnreads, setTopicUnreads] = useState<Record<string, number>>({});
    const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
    const [auditLogs, setAuditLogs] = useState<LogEntry[]>([]);
    const [disabledAiTopics, setDisabledAiTopics] = useState<string[]>([]); 
    const [activeTopic, setActiveTopic] = useState('general');
    const [categories, setCategories] = useState(['Общее', 'Ивенты', 'Бонусы', 'Герои', 'Разное']);
    const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
    const [calendarCategories, setCalendarCategories] = useState<string[]>([
        '⚔️ Битвы (PvP)', '💎 Фарм и Ресурсы', 'Ω Особые Ивенты', '🏆 Кубок Всех Звезд', '📅 Другое'
    ]);
    const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeItem[]>([]);
    const [commands, setCommands] = useState<Command[]>([]);
    const [aiStats, setAiStats] = useState<AiStats>({ total: 0, history: [] }); 

    const markLoaded = (section: string) => setLoadedSections(prev => new Set(prev).add(section));
    const canSave = (section: string) => loadedSections.has(section);

    // Auth Check on Mount
    useEffect(() => {
        const savedAuth = localStorage.getItem('helix_auth_token');
        if (savedAuth === SECURE_HASH) {
            setIsAuthenticated(true);
        }
    }, []);

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const inputHash = btoa(passwordInput);
            if (inputHash === SECURE_HASH) {
                setIsAuthenticated(true);
                localStorage.setItem('helix_auth_token', SECURE_HASH);
                setAuthError(false);
            } else {
                setAuthError(true);
            }
        } catch (e) {
            setAuthError(true);
        }
    };

    // --- FIREBASE SUBSCRIPTIONS ---
    useEffect(() => {
        if (!isAuthenticated) return; 

        const unsubs: (Function | undefined)[] = [];
        const sub = (path: string, cb: (val: any) => void) => {
            const unsub = subscribeToData(path, cb);
            if (unsub) unsubs.push(unsub);
        };

        sub('config', (val) => { if (val) setConfig(prev => ({ ...prev, ...val })); markLoaded('config'); });
        sub('status/heartbeat', (val) => { if (val) setLastHeartbeat(val); });
        sub('status/active', (val) => { setIsBotActive(val !== false); });
        sub('users', (val) => { 
            if (val) { 
                const s = {...val}; 
                Object.values(s).forEach((u: any) => { if(!u.history) u.history = []; else u.history = toArray(u.history); }); 
                setUsers(s); 
            } else setUsers({}); 
            markLoaded('users'); 
        });
        sub('groups', (val) => { setGroups(val || {}); markLoaded('groups'); }); 
        sub('knowledgeBase', (val) => { setKnowledgeBase(toArray(val)); markLoaded('knowledgeBase'); });
        sub('commands', (val) => { setCommands(toArray(val)); markLoaded('commands'); });
        sub('quickReplies', (val) => { setQuickReplies(toArray(val)); markLoaded('quickReplies'); });
        sub('auditLogs', (val) => { setAuditLogs(toArray(val)); markLoaded('auditLogs'); });
        
        sub('aiStats', (val) => { 
            if (val) { 
                const newStats = {
                    total: val.total || 0,
                    history: val.history ? toArray<AiStat>(val.history) : []
                };
                setAiStats(newStats); 
            } else {
                setAiStats({total: 0, history: []});
            }
            markLoaded('aiStats'); 
        });
        
        sub('categories', (val) => { if(val) setCategories(toArray(val)); markLoaded('categories'); });
        sub('topicNames', (val) => { if(val) setTopicNames(val); markLoaded('topicNames'); });
        sub('topicUnreads', (val) => { if(val) setTopicUnreads(val); else setTopicUnreads({}); markLoaded('topicUnreads'); });
        sub('disabledAiTopics', (val) => { if(val) setDisabledAiTopics(toArray(val)); else setDisabledAiTopics([]); markLoaded('disabledAiTopics'); });
        sub('topicHistory', (val) => { if(val) { const cleanHistory: Record<string, any[]> = {}; Object.entries(val).forEach(([k, v]) => { cleanHistory[k] = toArray(v); }); setTopicHistory(cleanHistory); } else setTopicHistory({}); markLoaded('topicHistory'); });
        sub('calendarEvents', (val) => { setCalendarEvents(toArray(val)); markLoaded('calendarEvents'); });
        sub('calendarCategories', (val) => { if(val) setCalendarCategories(toArray(val)); markLoaded('calendarCategories'); });

        return () => unsubs.forEach(fn => fn && fn());
    }, [isAuthenticated]);

    // --- AUTO-SAVE ---
    useEffect(() => { if (canSave('config')) saveData('config', config); }, [config, loadedSections]);
    useEffect(() => { if (canSave('users')) saveData('users', users); }, [users, loadedSections]);
    useEffect(() => { if (canSave('groups')) saveData('groups', groups); }, [groups, loadedSections]);
    useEffect(() => { if (canSave('knowledgeBase')) saveData('knowledgeBase', knowledgeBase); }, [knowledgeBase, loadedSections]);
    useEffect(() => { if (canSave('commands')) saveData('commands', commands); }, [commands, loadedSections]);
    useEffect(() => { if (canSave('categories')) saveData('categories', categories); }, [categories, loadedSections]);
    useEffect(() => { if (canSave('topicNames')) saveData('topicNames', topicNames); }, [topicNames, loadedSections]);
    useEffect(() => { if (canSave('disabledAiTopics')) saveData('disabledAiTopics', disabledAiTopics); }, [disabledAiTopics, loadedSections]);
    useEffect(() => { if (canSave('quickReplies')) saveData('quickReplies', quickReplies); }, [quickReplies, loadedSections]);
    
    // --- ACTIONS ---
    const toggleBotStatus = () => {
        const newState = !isBotActive;
        setIsBotActive(newState);
        saveData('status/active', newState);
        addLog('Система', newState ? 'Бот переведен в АКТИВНЫЙ режим' : 'Бот поставлен на ПАУЗУ', 'warning');
    };

    const addLog = (action: string, details: string, type: 'info' | 'warning' | 'danger' | 'success' = 'info') => {
        const newLog: LogEntry = { id: Date.now().toString() + Math.random().toString().slice(2, 5), timestamp: Date.now(), admin: 'Admin Panel', action, details, type };
        const updatedLogs = [newLog, ...auditLogs].slice(0, 500);
        setAuditLogs(updatedLogs);
        saveData('auditLogs', updatedLogs);
    };

    const clearAiHistory = () => {
        const emptyStats = { total: 0, history: [] };
        saveData('aiStats', emptyStats); 
        saveData('topicHistory', {});
        saveData('topicUnreads', {}); 
        setAiStats(emptyStats);
        setTopicHistory({});
        setTopicUnreads({});
        
        const clearedUsers = { ...users };
        Object.keys(clearedUsers).forEach(key => {
            clearedUsers[key] = { ...clearedUsers[key], history: [], msgCount: 0, dailyMsgCount: 0, unreadCount: 0 };
        });
        setUsers(clearedUsers);
        saveData('users', clearedUsers);
        addLog('Система', 'История и счетчики очищены через панель', 'warning');
    };

    const handleCalendarUpdate = (action: React.SetStateAction<CalendarEvent[]>) => {
        setCalendarEvents(prev => {
            const newValue = typeof action === 'function' ? action(prev) : action;
            setTimeout(() => saveData('calendarEvents', newValue), 0);
            return newValue;
        });
    };

    const handleDeleteGroup = async (groupId: string) => {
        try { await apiCall('leaveChat', { chat_id: groupId }, config); } catch(e) {}
        const newGroups = { ...groups };
        delete newGroups[groupId];
        setGroups(newGroups);
        saveData('groups', newGroups);
        addLog('Группы', `Группа ${groupId} удалена`, 'danger');
    };

    const handleMarkTopicRead = (tid: string) => {
        setTopicUnreads(prev => ({...prev, [tid]: 0}));
        saveData(`topicUnreads/${tid}`, 0);
        const topicMsgs = topicHistory[tid] || [];
        const userIdsInTopic = new Set<number>();
        topicMsgs.forEach(msg => {
            if (msg.userId && msg.isIncoming) userIdsInTopic.add(msg.userId);
        });
        const updatedUsers = { ...users };
        let hasChanges = false;
        userIdsInTopic.forEach(uid => {
            const user = updatedUsers[uid];
            if (user && user.unreadCount && user.unreadCount > 0) {
                updatedUsers[uid] = { ...user, unreadCount: 0 };
                saveData(`users/${uid}/unreadCount`, 0);
                hasChanges = true;
            }
        });
        if (hasChanges) setUsers(updatedUsers);
    };

    const handleLiveChatSend = async (data: { text: string; mediaUrl?: string; mediaFile?: File | null; buttons?: any[]; topicId: string }) => {
        const { text, mediaUrl, mediaFile, buttons, topicId } = data;
        try {
            const markup = buttons && buttons.length > 0 ? JSON.stringify({ 
                inline_keyboard: buttons.map(b => [{ text: b.text, url: b.url }]) 
            }) : undefined;
            const threadId = topicId !== 'general' ? topicId : undefined;

            if (mediaFile) {
                const fd = new FormData();
                fd.append('chat_id', config.targetChatId);
                const method = mediaFile.type.startsWith('video') ? 'sendVideo' : 'sendPhoto';
                fd.append(method === 'sendVideo' ? 'video' : 'photo', mediaFile);
                if (text) fd.append('caption', text);
                if (markup) fd.append('reply_markup', markup);
                if (threadId) fd.append('message_thread_id', threadId);
                await apiCall(method, fd, config, true);
            } else if (mediaUrl) {
                await apiCall('sendPhoto', { 
                    chat_id: config.targetChatId, 
                    photo: mediaUrl, 
                    caption: text, 
                    reply_markup: markup ? JSON.parse(markup) : undefined,
                    message_thread_id: threadId
                }, config);
            } else {
                await apiCall('sendMessage', { 
                    chat_id: config.targetChatId, 
                    text: text, 
                    reply_markup: markup ? JSON.parse(markup) : undefined,
                    message_thread_id: threadId
                }, config);
            }
            const newMsg = {
                dir: 'out',
                text: text,
                type: 'text',
                time: new Date().toLocaleTimeString('ru-RU'),
                timestamp: Date.now(),
                isIncoming: false,
                isGroup: true,
                user: 'Admin'
            };
            const updatedTopicHistory = [...(topicHistory[topicId] || []), newMsg];
            setTopicHistory(prev => ({ ...prev, [topicId]: updatedTopicHistory }));
            saveData(`topicHistory/${topicId}`, updatedTopicHistory);

        } catch (e) {
            console.error(e);
            alert('Ошибка отправки сообщения');
        }
    };

    const isOnline = (Date.now() - lastHeartbeat) < 90000; 

    if (!isAuthenticated) {
        return (
            <div className="flex h-screen bg-[#09090b] items-center justify-center p-4">
                <div className="w-full max-w-sm bg-[#121214] border border-gray-800 rounded-2xl shadow-2xl p-8 animate-slideIn">
                    <div className="flex justify-center mb-6">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg text-white">
                            <Icons.Shield size={32} />
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold text-center text-white mb-2">Helix Admin</h2>
                    <p className="text-gray-500 text-center text-sm mb-6">Введите код доступа</p>
                    
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div className="relative">
                            <input 
                                type="password" 
                                value={passwordInput}
                                onChange={(e) => setPasswordInput(e.target.value)}
                                className={`w-full bg-black border ${authError ? 'border-red-500' : 'border-gray-700'} rounded-xl px-4 py-3 text-white text-center tracking-widest outline-none focus:border-blue-500 transition-colors`}
                                placeholder="••••••••"
                                autoFocus
                            />
                        </div>
                        {authError && <div className="text-red-500 text-xs text-center font-bold">Неверный пароль</div>}
                        <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-colors shadow-lg">
                            Войти
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    const TabButton = ({ id, iconKey, label, badge }: any) => {
        const isActive = activeTab === id; const Icon = Icons[iconKey as keyof typeof Icons];
        return ( 
            <button 
                onClick={() => { setActiveTab(id); setIsSidebarOpen(false); }} 
                className={`w-full flex items-center space-x-3 px-4 py-3.5 rounded-xl transition-all duration-300 group relative overflow-hidden ${isActive ? 'text-white bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
            >
                <Icon size={20} className={`relative z-10 ${isActive ? 'text-white' : 'text-gray-500 group-hover:text-white'}`} />
                <span className="font-medium text-sm relative z-10 flex-1 text-left">{label}</span>
                {badge > 0 && <span className="relative z-10 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{badge}</span>}
                {isActive && <div className="absolute inset-0 bg-white/10 rounded-xl"></div>}
            </button> 
        );
    };

    return (
        <div className="flex h-screen bg-[#09090b] text-gray-100 font-sans overflow-hidden">
            {/* Mobile Header */}
            <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-[#0c0c0e] border-b border-gray-800 flex items-center justify-between px-4 z-40 shadow-lg">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white">
                        <Icons.Zap size={18} />
                    </div>
                    <span className="font-bold text-white">Helix Bot</span>
                </div>
                <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-gray-400 hover:text-white">
                    <Icons.Settings size={24} />
                </button>
            </div>

            {/* Mobile Sidebar Overlay */}
            {isSidebarOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 md:hidden" onClick={() => setIsSidebarOpen(false)} />
            )}

            {/* Sidebar */}
            <div className={`
                fixed inset-y-0 left-0 z-50 w-72 bg-[#0c0c0e] border-r border-gray-800 flex flex-col shrink-0 transition-transform duration-300
                md:relative md:translate-x-0
                ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            `}>
                <div className="p-8 hidden md:block">
                    <div className="flex items-center space-x-3 text-blue-500 mb-2">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg text-white">
                            <Icons.Zap size={24} />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-white tracking-tight">Бот Helix</h1>
                            <span className="text-[10px] text-gray-500 font-medium uppercase tracking-widest">Админ Панель v9.8</span>
                        </div>
                    </div>
                </div>

                <div className="md:hidden p-4 flex items-center justify-between border-b border-gray-800">
                    <span className="font-bold text-gray-400">Меню</span>
                    <button onClick={() => setIsSidebarOpen(false)}><Icons.X size={24}/></button>
                </div>
                
                <div className="px-6 mb-4">
                     <div className="bg-black/40 rounded-lg p-3 border border-gray-800/50 space-y-2">
                        <div className="flex items-center justify-between">
                             <span className="text-[10px] text-gray-500 uppercase font-bold">Сервер</span>
                             <div className="flex items-center gap-1.5">
                                 <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`}></div>
                                 <span className={`text-[10px] font-bold ${isOnline ? 'text-green-400' : 'text-red-400'}`}>{isOnline ? 'ОНЛАЙН' : 'ОФФЛАЙН'}</span>
                             </div>
                        </div>
                    </div>
                </div>
                
                <div className="px-4 space-y-2 flex-1 overflow-y-auto custom-scrollbar pb-4">
                    <TabButton id="dashboard" iconKey="Activity" label="Обзор" />
                    <TabButton id="livechat" iconKey="MessageCircle" label="Live Chat" />
                    <TabButton id="users" iconKey="Users" label="CRM Пользователи" />
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
                    <button 
                        onClick={toggleBotStatus} 
                        className={`w-full py-3 rounded-xl text-xs font-bold uppercase transition-all duration-300 shadow-lg border ${
                            isBotActive 
                            ? 'bg-gray-800 text-yellow-500 border-yellow-500/20 hover:bg-yellow-900/10' 
                            : 'bg-green-600 text-white border-green-500 hover:bg-green-500'
                        }`}
                    >
                        <span className="flex items-center justify-center gap-2">
                            {isBotActive ? <><Icons.Pause size={14}/> Поставить на Паузу</> : <><Icons.Play size={14}/> Активировать Бота</>}
                        </span>
                    </button>
                    <div className="mt-2 text-center">
                        <button 
                            onClick={() => { localStorage.removeItem('helix_auth_token'); setIsAuthenticated(false); }}
                            className="text-[10px] text-gray-500 hover:text-white underline"
                        >
                            Выйти из системы
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0 bg-[#0f0f12] relative overflow-hidden pt-16 md:pt-0">
                <div className="flex-1 overflow-auto p-4 md:p-8 scroll-smooth custom-scrollbar">
                    <div className="max-w-[100%] md:max-w-[95%] mx-auto h-full">
                        {activeTab === 'dashboard' && <Dashboard users={users} groups={groups} setGroups={setGroups} aiStats={aiStats} config={config} setConfig={setConfig} isAiThinking={false} setAiStats={setAiStats} addLog={addLog} setActiveTab={setActiveTab} onStopBot={() => setIsBotActive(false)} onClearAiStats={clearAiHistory} viewMode="overview" auditLogs={auditLogs} onDeleteGroup={handleDeleteGroup} />}
                        {activeTab === 'livechat' && <LiveChat 
                            topicNames={topicNames} 
                            topicHistory={topicHistory} 
                            activeTopic={activeTopic} 
                            setActiveTopic={setActiveTopic} 
                            disabledAiTopics={disabledAiTopics} 
                            unreadCounts={topicUnreads}
                            onToggleAi={(tid) => { const list = disabledAiTopics.includes(tid) ? disabledAiTopics.filter(t => t !== tid) : [...disabledAiTopics, tid]; setDisabledAiTopics(list); saveData('disabledAiTopics', list); }} 
                            onClearTopic={(tid) => { 
                                const h = {...topicHistory, [tid]: []}; 
                                setTopicHistory(h); 
                                saveData('topicHistory', h);
                                handleMarkTopicRead(tid);
                            }} 
                            onRenameTopic={(id, name) => { const n = {...topicNames, [id]: name}; setTopicNames(n); saveData('topicNames', n); }} 
                            quickReplies={quickReplies} 
                            setQuickReplies={(qr) => { setQuickReplies(qr); saveData('quickReplies', qr); }} 
                            onSendMessage={handleLiveChatSend} 
                            onAddTopic={(id, name) => { const n = {...topicNames, [id]: name}; setTopicNames(n); saveData('topicNames', n); addLog('LiveChat', `Добавлена тема ${name} (ID: ${id}) вручную`, 'success'); }} 
                            onDeleteTopic={(id) => { 
                                const n = {...topicNames}; delete n[id]; setTopicNames(n); saveData('topicNames', n); 
                                removeData(`topicHistory/${id}`);
                                removeData(`topicUnreads/${id}`);
                                setTopicUnreads(prev => { const p = {...prev}; delete p[id]; return p; });
                                addLog('LiveChat', `Тема ${id} удалена`, 'danger');
                                if (activeTopic === id) setActiveTopic('general');
                            }}
                            onMarkTopicRead={handleMarkTopicRead}
                        />}
                        {activeTab === 'users' && <UserCRM users={users} setUsers={setUsers} config={config} commands={commands} topicNames={topicNames} addLog={addLog} />}
                        {activeTab === 'broadcasts' && <Broadcasts users={users} config={config} addLog={addLog} onBroadcastSent={(uid, txt, type, url) => {}} />}
                        {activeTab === 'calendar' && <CalendarEvents events={calendarEvents} setEvents={handleCalendarUpdate} categories={calendarCategories} setCategories={(c) => { setCalendarCategories(c); saveData('calendarCategories', c); }} topicNames={topicNames} addLog={addLog} config={config} />}
                        {activeTab === 'commands' && <Commands commands={commands} setCommands={(c) => { setCommands(c); saveData('commands', c); }} topicNames={topicNames} />}
                        {activeTab === 'knowledge' && <KnowledgeBase items={knowledgeBase} categories={categories} setItems={(i) => { setKnowledgeBase(i); saveData('knowledgeBase', i); }} setCategories={(c) => { setCategories(c); saveData('categories', c); }} addLog={addLog} />}
                        {activeTab === 'logs' && <AuditLogs logs={auditLogs} setLogs={(l) => { setAuditLogs(l); saveData('auditLogs', l); }} />}
                        {activeTab === 'settings' && <Dashboard users={users} groups={groups} setGroups={setGroups} aiStats={aiStats} config={config} setConfig={setConfig} isAiThinking={false} setAiStats={setAiStats} addLog={addLog} setActiveTab={setActiveTab} onStopBot={() => setIsBotActive(false)} onClearAiStats={clearAiHistory} viewMode="settings" />}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;
