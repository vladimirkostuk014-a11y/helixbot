
import React, { useState, useEffect } from 'react';
import { Icons } from './components/Icons';
import Dashboard from './components/Dashboard';
import LiveChat from './components/LiveChat';
import KnowledgeBase from './components/KnowledgeBase';
import Commands from './components/Commands'; 
import Broadcasts from './components/Broadcasts'; 
import AuditLogs from './components/AuditLogs'; 
import CalendarEvents from './components/CalendarEvents';
import { BotConfig, Command, KnowledgeItem, AiStats, Group, QuickReply, LogEntry, CalendarEvent, User as UserType } from './types';
import { apiCall } from './services/api';
import UserCRM from './components/UserCRM';
import { subscribeToData, saveData } from './services/firebase'; 

const HARDCODED_CONFIG = {
    token: '7614990025:AAEGbRiUO3zPR1VFhwTPgQ4eHVX-eo5snPI',
    targetChatId: '-1003724305882',
    adminIds: '8098674553'
};

const GROQ_API_KEY = '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';

// Helper to reliably convert Firebase snapshots
const toArray = <T,>(data: any): T[] => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return Object.values(data);
};

const App = () => {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [isBotActive, setIsBotActive] = useState(true); 
    const [lastHeartbeat, setLastHeartbeat] = useState(0);
    const [loadedSections, setLoadedSections] = useState<Set<string>>(new Set());
    
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
        aiTemperature: 0.3,
        aiMaxTokens: 1000, 
        bannedWords: '' 
    });
    
    // Data States
    const [users, setUsers] = useState<Record<string, UserType>>({});
    const [groups, setGroups] = useState<Record<string, Group>>({}); 
    const [topicNames, setTopicNames] = useState<Record<string, string>>({ 'general': 'Общий чат (General)' }); 
    const [topicHistory, setTopicHistory] = useState<Record<string, any[]>>({ 'general': [] }); 
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

    // --- FIREBASE SUBSCRIPTIONS ---
    useEffect(() => {
        const unsubs: (Function | undefined)[] = [];
        const sub = (path: string, cb: (val: any) => void) => {
            const unsub = subscribeToData(path, cb);
            if (unsub) unsubs.push(unsub);
        };

        // 1. Config & Status
        sub('config', (val) => { 
            if (val) setConfig(prev => ({ ...prev, ...val })); 
            markLoaded('config'); 
        });
        
        sub('status/heartbeat', (val) => {
            if (val) setLastHeartbeat(val);
        });
        
        sub('status/active', (val) => {
            // Если в базе явно false, то false. Если undefined или true, то true.
            setIsBotActive(val !== false);
        });

        // 2. Data
        sub('users', (val) => { 
            if (val) { 
                const s = {...val}; 
                Object.values(s).forEach((u: any) => { 
                    if(!u.history) u.history = []; 
                    else u.history = toArray(u.history); 
                }); 
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
                const cleanHistory: Record<string, any[]> = {};
                Object.entries(val).forEach(([k, v]) => { cleanHistory[k] = toArray(v); });
                setTopicHistory(cleanHistory); 
            } else setTopicHistory({});
            markLoaded('topicHistory'); 
        });
        sub('calendarEvents', (val) => { setCalendarEvents(toArray(val)); markLoaded('calendarEvents'); });
        sub('calendarCategories', (val) => { if(val) setCalendarCategories(toArray(val)); markLoaded('calendarCategories'); });

        return () => unsubs.forEach(fn => fn && fn());
    }, []);

    // --- AUTO-SAVE (Front -> Firebase) ---
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
        addLog('Система', newState ? 'Бот переведен в АКТИВНЫЙ режим' : 'Бот поставлен на ПАУЗУ (Тихий режим)', 'warning');
    };

    const addLog = (action: string, details: string, type: 'info' | 'warning' | 'danger' | 'success' = 'info') => {
        const newLog: LogEntry = { id: Date.now().toString() + Math.random().toString().slice(2, 5), timestamp: Date.now(), admin: 'Admin Panel', action, details, type };
        const updatedLogs = [newLog, ...auditLogs].slice(0, 500);
        setAuditLogs(updatedLogs);
        saveData('auditLogs', updatedLogs);
    };

    const clearAiHistory = () => {
        saveData('aiStats', { total: 0, history: [] }); 
        saveData('topicHistory', {});
        const clearedUsers = { ...users };
        Object.keys(clearedUsers).forEach(key => {
            clearedUsers[key] = { ...clearedUsers[key], history: [], msgCount: 0, dailyMsgCount: 0 };
        });
        saveData('users', clearedUsers);
        addLog('Система', 'История очищена через панель', 'warning');
    };

    const handleCalendarUpdate = (action: React.SetStateAction<CalendarEvent[]>) => {
        setCalendarEvents(prev => {
            const newValue = typeof action === 'function' ? action(prev) : action;
            setTimeout(() => saveData('calendarEvents', newValue), 0);
            return newValue;
        });
    };

    const handleDeleteGroup = async (groupId: string) => {
        try {
            await apiCall('leaveChat', { chat_id: groupId }, config);
        } catch(e) {}
        const newGroups = { ...groups };
        delete newGroups[groupId];
        setGroups(newGroups);
        saveData('groups', newGroups);
        addLog('Группы', `Группа ${groupId} удалена`, 'danger');
    };

    // Calculate Uptime
    const isOnline = (Date.now() - lastHeartbeat) < 90000; // VPS Online if heartbeat < 90s

    const TabButton = ({ id, iconKey, label, badge }: any) => {
        const isActive = activeTab === id; const Icon = Icons[iconKey as keyof typeof Icons];
        return ( 
            <button onClick={() => setActiveTab(id)} className={`w-full flex items-center space-x-3 px-4 py-3.5 rounded-xl transition-all duration-300 group relative overflow-hidden ${isActive ? 'text-white bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <Icon size={20} className={`relative z-10 ${isActive ? 'text-white' : 'text-gray-500 group-hover:text-white'}`} />
                <span className="font-medium text-sm relative z-10 flex-1 text-left">{label}</span>
                {badge > 0 && <span className="relative z-10 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{badge}</span>}
                {isActive && <div className="absolute inset-0 bg-white/10 rounded-xl"></div>}
            </button> 
        );
    };

    return (
        <div className="flex h-screen bg-[#09090b] text-gray-100 font-sans overflow-hidden">
            <div className="w-72 bg-[#0c0c0e] border-r border-gray-800 flex flex-col shrink-0 relative z-20">
                <div className="p-8">
                    <div className="flex items-center space-x-3 text-blue-500 mb-2">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg text-white">
                            <Icons.Zap size={24} />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-white tracking-tight">Бот Helix</h1>
                            <span className="text-[10px] text-gray-500 font-medium uppercase tracking-widest">Админ Панель v2.2</span>
                        </div>
                    </div>
                    
                    {/* Status Box */}
                    <div className="bg-black/40 rounded-lg p-3 border border-gray-800/50 mt-4 space-y-2">
                        <div className="flex items-center justify-between">
                             <span className="text-[10px] text-gray-500 uppercase font-bold">Сервер (VPS)</span>
                             <div className="flex items-center gap-1.5">
                                 <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`}></div>
                                 <span className={`text-[10px] font-bold ${isOnline ? 'text-green-400' : 'text-red-400'}`}>{isOnline ? 'ОНЛАЙН' : 'ОФФЛАЙН'}</span>
                             </div>
                        </div>
                        <div className="flex items-center justify-between">
                             <span className="text-[10px] text-gray-500 uppercase font-bold">Режим ответа</span>
                             <span className={`text-[10px] font-bold px-1.5 rounded ${isBotActive ? 'bg-blue-900/30 text-blue-400' : 'bg-gray-800 text-gray-400'}`}>
                                {isBotActive ? 'АКТИВЕН' : 'ПАУЗА'}
                             </span>
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
                    <div className="text-[9px] text-center text-gray-600 mt-2">
                        {isBotActive ? 'Бот отвечает пользователям' : 'Бот молчит (только логи)'}
                    </div>
                </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0 bg-[#0f0f12] relative overflow-hidden">
                <div className="flex-1 overflow-auto p-8 scroll-smooth custom-scrollbar">
                    <div className="max-w-[95%] mx-auto h-full">
                        {activeTab === 'dashboard' && <Dashboard users={users} groups={groups} setGroups={setGroups} aiStats={aiStats} config={config} setConfig={setConfig} isAiThinking={false} setAiStats={setAiStats} addLog={addLog} setActiveTab={setActiveTab} onStopBot={() => setIsBotActive(false)} onClearAiStats={clearAiHistory} viewMode="overview" auditLogs={auditLogs} onDeleteGroup={handleDeleteGroup} />}
                        {activeTab === 'livechat' && <LiveChat topicNames={topicNames} topicHistory={topicHistory} activeTopic={activeTopic} setActiveTopic={setActiveTopic} disabledAiTopics={disabledAiTopics} onToggleAi={(tid) => { const list = disabledAiTopics.includes(tid) ? disabledAiTopics.filter(t => t !== tid) : [...disabledAiTopics, tid]; setDisabledAiTopics(list); saveData('disabledAiTopics', list); }} onClearTopic={(tid) => { const h = {...topicHistory, [tid]: []}; setTopicHistory(h); saveData('topicHistory', h); }} onRenameTopic={(id, name) => { const n = {...topicNames, [id]: name}; setTopicNames(n); saveData('topicNames', n); }} unreadCounts={{}} quickReplies={quickReplies} setQuickReplies={(qr) => { setQuickReplies(qr); saveData('quickReplies', qr); }} onSendMessage={(data) => { /* UI preview only */ }} />}
                        {activeTab === 'users' && <UserCRM users={users} setUsers={setUsers} config={config} commands={commands} topicNames={topicNames} addLog={addLog} />}
                        {activeTab === 'broadcasts' && <Broadcasts users={users} config={config} addLog={addLog} onBroadcastSent={(uid, txt, type, url) => { /* Update user history manually here if needed */ }} />}
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
