
import React, { useState, useEffect, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { User, AiStats, BotConfig, Group, LogEntry, KnowledgeItem } from '../types';
import { Icons } from './Icons';
import { apiCall, getAIResponse, generateSystemPrompt, DEFAULT_SYSTEM_PROMPT, DEFAULT_TOXIC_PROMPT } from '../services/api';
import { saveData } from '../services/firebase';

const SETTINGS_HASH = "ODk1Mg==";

interface DashboardProps {
    users: Record<string, User>;
    groups?: Record<string, Group>;
    setGroups?: React.Dispatch<React.SetStateAction<Record<string, Group>>>;
    aiStats: AiStats;
    config: BotConfig;
    setConfig: (c: BotConfig) => void;
    isAiThinking?: boolean;
    setAiStats?: (stats: AiStats) => void;
    addLog?: (action: string, details: string, type?: 'info' | 'warning' | 'danger' | 'success') => void;
    setActiveTab?: (tab: string) => void;
    onStopBot?: () => void;
    onClearAiStats?: () => void;
    viewMode?: 'overview' | 'settings';
    auditLogs?: LogEntry[];
    onDeleteGroup?: (groupId: string) => void;
    knowledgeBase?: KnowledgeItem[];
}

const Dashboard: React.FC<DashboardProps> = ({ users, groups = {}, setGroups, aiStats, config, setConfig, isAiThinking, setAiStats, addLog, setActiveTab, onStopBot, onClearAiStats, viewMode = 'overview', auditLogs = [], onDeleteGroup, knowledgeBase = [] }) => {
    const [aiSaveStatus, setAiSaveStatus] = useState('');
    const [showGroupModal, setShowGroupModal] = useState(false);
    const [showActiveModal, setShowActiveModal] = useState(false);
    const [showAiModal, setShowAiModal] = useState(false);
    const [aiModalTab, setAiModalTab] = useState<'history' | 'top'>('history');
    
    // Settings Auth
    const [isSettingsUnlocked, setIsSettingsUnlocked] = useState(() => {
        return sessionStorage.getItem('helix_settings_unlocked') === 'true';
    });
    const [settingsPass, setSettingsPass] = useState('');
    const [settingsError, setSettingsError] = useState(false);
    const [newProfanityWord, setNewProfanityWord] = useState('');
    const [showPlayground, setShowPlayground] = useState(false);
    const [playgroundInput, setPlaygroundInput] = useState('');
    const [playgroundHistory, setPlaygroundHistory] = useState<{role: 'user'|'bot', text: string}[]>([]);
    const [isPlaygroundThinking, setIsPlaygroundThinking] = useState(false);
    const playgroundEndRef = useRef<HTMLDivElement>(null);

    const userArray: User[] = Object.values(users);
    const realUsers = userArray.filter(u => u.id > 0 && u.id !== 777000 && u.id !== 1087968824);
    const activeUsers = realUsers.filter(u => u.dailyMsgCount > 0).sort((a, b) => b.dailyMsgCount - a.dailyMsgCount);
    
    useEffect(() => {
        if (showPlayground && playgroundEndRef.current) {
            playgroundEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [playgroundHistory, showPlayground, isPlaygroundThinking]);

    const handleSettingsLogin = (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (btoa(settingsPass) === SETTINGS_HASH) {
                setIsSettingsUnlocked(true);
                sessionStorage.setItem('helix_settings_unlocked', 'true');
                setSettingsError(false);
            } else {
                setSettingsError(true);
            }
        } catch { setSettingsError(true); }
    };
    
    const handleLockSettings = () => {
        setIsSettingsUnlocked(false);
        sessionStorage.removeItem('helix_settings_unlocked');
    };

    const getTopQuestions = () => {
        const counts: Record<string, number> = {};
        ((aiStats as any).history || []).filter((h: any) => !h.cleared).forEach((h: any) => {
            const q = h.query.toLowerCase().trim();
            if (q) counts[q] = (counts[q] || 0) + 1;
        });
        return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([q, c]) => ({ query: q, count: c }));
    };
    
    const handleSave = (section: 'ai' | 'ban') => {
        const cleanConfig = { ...config };
        if (cleanConfig.openaiApiKey) cleanConfig.openaiApiKey = cleanConfig.openaiApiKey.trim();
        saveData('config', cleanConfig);
        setAiSaveStatus('Сохранено!');
        if (addLog) addLog('Настройки', `Обновлены настройки ${section === 'ai' ? 'AI' : 'Бан-лист'}`, 'info');
        setTimeout(() => setAiSaveStatus(''), 2000);
    };

    const toggleGroup = (groupId: string) => {
        if (!setGroups) return;
        setGroups(prev => {
             const newGroups = {
                ...prev,
                [groupId]: { ...prev[groupId], isDisabled: !prev[groupId].isDisabled }
             };
             saveData('groups', newGroups);
             return newGroups;
        });
    };

    const handleSendTopToAdmins = async () => {
        const top = getTopQuestions().slice(0, 10);
        if (top.length === 0) return alert("Нет данных для отчета");
        const report = `📊 <b>ТОП-10 Вопросов Хеликсу:</b>\n\n` + top.map((t, i) => `${i+1}. ${t.query} (${t.count})`).join('\n');
        const admins = (Object.values(users) as User[]).filter(u => u.role === 'admin');
        for (const admin of admins) {
            await apiCall('sendMessage', { chat_id: admin.id, text: report, parse_mode: 'HTML' }, config);
        }
        alert(`Отчет отправлен.`);
    };

    const handlePlaygroundSend = async () => {
        if (!playgroundInput.trim()) return;
        const msg = playgroundInput;
        setPlaygroundInput('');
        setPlaygroundHistory(prev => [...prev, { role: 'user', text: msg }]);
        setIsPlaygroundThinking(true);
        try {
            const kbContext = knowledgeBase.length > 0 
                ? knowledgeBase.map(k => `ЗАПИСЬ [ID: ${k.id}]:\n- Раздел: ${k.category || 'Общее'}\n- Заголовок: ${k.title || 'Нет'}\n- Ключевые слова: ${k.triggers || 'Нет'}\n- Информация: ${k.response}`).join('\n\n---\n\n')
                : "База знаний пуста.";

            const response = await getAIResponse(msg, config, kbContext);
            setPlaygroundHistory(prev => [...prev, { role: 'bot', text: response }]);
        } catch (e) {
            setPlaygroundHistory(prev => [...prev, { role: 'bot', text: "Error: " + e }]);
        } finally {
            setIsPlaygroundThinking(false);
        }
    };
    
    const handleAddProfanity = () => {
        if (newProfanityWord.trim()) {
            const currentList = Array.isArray(config.customProfanityList) ? config.customProfanityList : [];
            if (!currentList.includes(newProfanityWord.trim())) {
                const newList = [...currentList, newProfanityWord.trim()];
                const newConfig = { ...config, customProfanityList: newList };
                setConfig(newConfig);
                saveData('config', newConfig); 
            }
            setNewProfanityWord('');
        }
    };

    const handleRemoveProfanity = (word: string) => {
        const currentList = Array.isArray(config.customProfanityList) ? config.customProfanityList : [];
        const newList = currentList.filter(w => w !== word);
        const newConfig = { ...config, customProfanityList: newList };
        setConfig(newConfig);
        saveData('config', newConfig); 
    };

    const getSimpleChartData = () => {
        const today = new Date();
        const data = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            d.setHours(0,0,0,0);
            const label = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
            let msgCount = 0;
            if (users) {
                Object.values(users).forEach(u => {
                    if (u.history) {
                        u.history.forEach(m => {
                            if (!m.timestamp) return;
                            const msgDate = new Date(m.timestamp);
                            msgDate.setHours(0,0,0,0);
                            if (msgDate.getTime() === d.getTime()) msgCount++;
                        });
                    }
                });
            }
            let aiCount = 0;
            if (aiStats && (aiStats as any).history) {
                (aiStats as any).history.forEach((stat: any) => {
                    const statDate = new Date(stat.time);
                    statDate.setHours(0,0,0,0);
                     if (statDate.getTime() === d.getTime()) aiCount++;
                });
            }
            data.push({ name: label, users: msgCount, ai: aiCount });
        }
        return data;
    };

    const KpiCard = ({ icon: Icon, title, value, color, gradient, onClick, actionIcon: ActionIcon }: any) => (
        <div onClick={onClick} className={`relative overflow-hidden p-6 rounded-2xl border border-gray-800 shadow-xl bg-gradient-to-br ${gradient} group cursor-pointer transition-transform hover:scale-[1.02]`}>
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Icon size={80} />
            </div>
            <div className="flex flex-col h-full justify-between relative z-10">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${color} bg-opacity-20`}>
                            <Icon size={24} className={color.replace('bg-', 'text-')} />
                        </div>
                        <span className="text-sm font-medium text-gray-300 uppercase tracking-wider">{title}</span>
                    </div>
                    {ActionIcon && <ActionIcon size={16} className="text-white opacity-50 group-hover:opacity-100"/>}
                </div>
                <div className="text-4xl font-black text-white tracking-tight">{value}</div>
            </div>
        </div>
    );

    if (viewMode === 'settings') {
        if (!isSettingsUnlocked) {
            return (
                <div className="flex items-center justify-center h-[calc(100vh-200px)]">
                    <div className="bg-[#121214] border border-gray-800 rounded-2xl p-8 w-full max-w-sm text-center shadow-2xl">
                        <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4 text-purple-500">
                            <Icons.Settings size={32}/>
                        </div>
                        <h2 className="text-xl font-bold text-white mb-2">Настройки Хеликса</h2>
                        <p className="text-gray-500 text-sm mb-6">Введите PIN-код для доступа</p>
                        <form onSubmit={handleSettingsLogin} className="space-y-4">
                            <input 
                                type="password" 
                                value={settingsPass} 
                                onChange={e => setSettingsPass(e.target.value)} 
                                className={`w-full bg-black border ${settingsError ? 'border-red-500' : 'border-gray-700'} rounded-xl px-4 py-3 text-white text-center tracking-[0.5em] text-lg outline-none focus:border-purple-500`}
                                placeholder="••••"
                                autoFocus
                                maxLength={4}
                            />
                            {settingsError && <div className="text-red-500 text-xs font-bold">Неверный PIN</div>}
                            <button className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-xl transition-colors">Открыть</button>
                        </form>
                    </div>
                </div>
            );
        }

        return (
             <div className="space-y-6">
                 <div className="bg-[#121214] p-6 rounded-2xl border border-gray-800 shadow-xl relative overflow-hidden flex flex-col h-full">
                    <div className="flex justify-between items-center mb-6 border-b border-gray-800 pb-4">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <Icons.Sparkles className="text-purple-500"/> Настройки Хеликса (AI)
                        </h2>
                        <button onClick={handleLockSettings} className="text-xs text-gray-500 hover:text-white">Закрыть доступ</button>
                    </div>
                    
                    <div className="space-y-6 relative z-10 flex-1 overflow-y-auto custom-scrollbar pr-2 pb-20">
                        {/* 1. MAIN SETTINGS GRID */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* API Key */}
                            <div className="bg-gray-900/50 p-4 rounded-xl border border-gray-700">
                                 <label className="text-xs text-gray-400 font-bold uppercase mb-2 block flex items-center gap-2">
                                    <Icons.Settings size={14}/> API Key (Groq/OpenAI)
                                 </label>
                                 <input 
                                    value={config.openaiApiKey || ''}
                                    onChange={e => setConfig({...config, openaiApiKey: e.target.value})}
                                    type="password"
                                    placeholder="gsk_..."
                                    className="w-full bg-black border border-gray-600 rounded-lg p-3 text-white text-sm focus:border-purple-500 outline-none transition-colors"
                                 />
                                 <p className="text-[10px] text-gray-500 mt-2">Ключ для доступа к LLM модели.</p>
                            </div>

                            {/* Model Selection */}
                            <div className="bg-gray-900/50 p-4 rounded-xl border border-gray-700">
                                <label className="text-xs text-gray-400 font-bold uppercase mb-2 block flex items-center gap-2">
                                    <Icons.Cpu size={14}/> Модель AI
                                </label>
                                <select value={config.aiModel || 'llama-3.3-70b-versatile'} onChange={e => setConfig({...config, aiModel: e.target.value})} className="w-full bg-black border border-gray-600 rounded-lg p-3 text-white text-sm focus:border-purple-500 outline-none transition-colors">
                                    <option value="llama-3.3-70b-versatile">🧠 Llama 3.3 70B (Основная)</option>
                                    <option value="llama-3.1-8b-instant">⚡ Llama 3.1 8B (Быстрая)</option>
                                    <option value="mixtral-8x7b-32768">🌪 Mixtral 8x7B</option>
                                    <option value="gemma-7b-it">💎 Gemma 7B</option>
                                </select>
                                <p className="text-[10px] text-gray-500 mt-2">Выберите "мозги" для Хеликса.</p>
                            </div>

                            {/* Personality */}
                            <div className="bg-gray-900/50 p-4 rounded-xl border border-gray-700">
                                <label className="text-xs text-gray-400 font-bold uppercase mb-2 block flex items-center gap-2">
                                    <Icons.User size={14}/> Личность Хеликса
                                </label>
                                <select value={config.aiPersonality || 'helpful'} onChange={e => setConfig({...config, aiPersonality: e.target.value})} className="w-full bg-black border border-gray-600 rounded-lg p-3 text-white text-sm focus:border-purple-500 outline-none transition-colors">
                                    <option value="helpful">🤝 Помощник (Дружелюбный)</option>
                                    <option value="teacher">👨‍🏫 Учитель (Подробный)</option>
                                    <option value="sarcastic">😏 Саркастичный (С юмором)</option>
                                    <option value="tech">💻 Технарь (Сухие факты)</option>
                                </select>
                                <p className="text-[10px] text-gray-500 mt-2">Влияет на тон общения (но не на факты).</p>
                            </div>

                            {/* Response Style */}
                            <div className="bg-gray-900/50 p-4 rounded-xl border border-gray-700">
                                <label className="text-xs text-gray-400 font-bold uppercase mb-2 block flex items-center gap-2">
                                    <Icons.MessageSquare size={14}/> Стиль ответов
                                </label>
                                <select value={config.aiResponseStyle || 'auto'} onChange={e => setConfig({...config, aiResponseStyle: e.target.value as any})} className="w-full bg-black border border-gray-600 rounded-lg p-3 text-white text-sm focus:border-purple-500 outline-none transition-colors">
                                    <option value="auto">🤖 Автоматически (Адаптивный)</option>
                                    <option value="brief">📝 Кратко (Только суть)</option>
                                    <option value="detailed">📚 Подробно (С деталями)</option>
                                </select>
                                <p className="text-[10px] text-gray-500 mt-2">Регулирует длину сообщений.</p>
                            </div>
                        </div>

                        {/* Info Block */}
                        <div className="bg-blue-900/20 border border-blue-900/50 p-4 rounded-xl flex gap-3 items-start">
                            <Icons.Info className="text-blue-400 shrink-0 mt-1" size={18}/>
                            <div>
                                <h4 className="text-blue-300 font-bold text-sm mb-1">Как это работает?</h4>
                                <p className="text-xs text-blue-200/70 leading-relaxed">
                                    Хеликс теперь работает в гибридном режиме. Если вы просто общаетесь ("Привет", "Как дела"), он будет поддерживать беседу согласно выбранной личности. 
                                    <br/><br/>
                                    Однако, если вы задаете вопрос, он <b>автоматически</b> ищет ответ в Базе Знаний. Если информации там нет, он честно об этом скажет. Вам больше не нужно настраивать "Строгость" — он сам понимает, когда нужно быть строгим.
                                </p>
                            </div>
                        </div>
                        
                         <div className="flex gap-2 pt-4">
                            <button onClick={() => setShowPlayground(true)} className="flex-1 bg-gray-800 text-purple-300 border border-purple-900/30 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-gray-700 transition-colors">
                                <Icons.Terminal size={18}/> Тест AI
                            </button>
                            <button onClick={() => handleSave('ai')} className="flex-[2] bg-purple-600 hover:bg-purple-500 text-white py-3 rounded-xl font-bold shadow-lg shadow-purple-900/20 transition-all hover:scale-[1.02] active:scale-95">
                                {aiSaveStatus || 'Сохранить настройки'}
                            </button>
                        </div>
                    </div>
                 </div>
                 
                {showPlayground && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowPlayground(false)}>
                        <div className="bg-[#121214] border border-gray-700 rounded-xl w-full max-w-2xl shadow-2xl animate-slideIn flex flex-col h-[600px]" onClick={e => e.stopPropagation()}>
                            <div className="flex justify-between items-center p-4 border-b border-gray-800">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2"><Icons.Terminal size={20} className="text-purple-500"/> Тест Личности (Sandbox)</h3>
                                <div className="flex gap-2">
                                    <button onClick={() => setPlaygroundHistory([])} className="text-xs text-gray-500 hover:text-white px-2 py-1 rounded hover:bg-gray-800 transition-colors">Очистить</button>
                                    <button onClick={() => setShowPlayground(false)}><Icons.X size={20} className="text-gray-500 hover:text-white"/></button>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black/20">
                                {playgroundHistory.map((msg, i) => (
                                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-800 text-gray-200 rounded-bl-none border border-gray-700'}`}>
                                            <div className="font-bold text-[10px] opacity-50 mb-1">{msg.role === 'user' ? 'Вы' : config.botName}</div>
                                            {msg.text}
                                        </div>
                                    </div>
                                ))}
                                {isPlaygroundThinking && <div className="text-purple-400 text-xs">Печатает...</div>}
                                <div ref={playgroundEndRef}/>
                            </div>
                            <div className="p-4 border-t border-gray-800 bg-gray-900/50 rounded-b-xl flex gap-2">
                                <input value={playgroundInput} onChange={e => setPlaygroundInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handlePlaygroundSend()} placeholder="Сообщение боту..." className="flex-1 bg-black border border-gray-700 rounded-lg px-4 py-2 text-white outline-none focus:border-purple-500 transition-colors" autoFocus/>
                                <button onClick={handlePlaygroundSend} disabled={isPlaygroundThinking} className="bg-purple-600 hover:bg-purple-500 p-2 rounded-lg text-white transition-colors"><Icons.Send size={20}/></button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }
    
    // ... rest of the component (KPICards, Charts, etc. remains unchanged)
    
    return (
        <div className="space-y-8 relative">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <KpiCard 
                    icon={Icons.Users} title="Всего пользователей" 
                    value={realUsers.length} 
                    color="bg-blue-500" gradient="from-gray-900 to-gray-800 hover:to-gray-700"
                    onClick={() => setActiveTab && setActiveTab('users')} 
                />
                <KpiCard 
                    icon={Icons.Activity} title="Активные сегодня" 
                    value={activeUsers.length} 
                    color="bg-green-500" gradient="from-gray-900 to-gray-800 hover:to-gray-700" 
                    onClick={() => setShowActiveModal(true)}
                />
                <KpiCard 
                    icon={Icons.Folder} title="Группы" 
                    value={Object.values(groups).length} 
                    color="bg-yellow-500" gradient="from-gray-900 to-gray-800 hover:to-gray-700"
                    onClick={() => setShowGroupModal(true)}
                    actionIcon={Icons.Settings}
                />
                <KpiCard 
                    icon={Icons.Sparkles} title="AI Ответы" 
                    value={aiStats.total} 
                    color="bg-purple-500" gradient="from-gray-900 to-gray-800 hover:to-gray-700" 
                    onClick={() => setShowAiModal(true)}
                    actionIcon={Icons.Send}
                />
            </div>

            {/* Charts Area */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                <div className="xl:col-span-2 bg-[#121214] p-6 rounded-2xl border border-gray-800 shadow-xl">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <Icons.Calendar size={20} className="text-blue-500"/> Статистика (7 дней)
                        </h3>
                        <div className="flex gap-2">
                            <button onClick={onClearAiStats} className="text-xs text-gray-500 hover:text-red-400 flex items-center gap-1 transition-colors px-2 py-1 rounded hover:bg-gray-800">
                                <Icons.Trash2 size={12}/> Очистить
                            </button>
                        </div>
                    </div>
                    <div className="h-[350px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={getSimpleChartData()}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                                <XAxis dataKey="name" stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} dy={10} />
                                <YAxis stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} dx={-10} allowDecimals={false} />
                                <Tooltip 
                                    contentStyle={{backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '12px'}} 
                                    cursor={{fill: '#27272a'}}
                                />
                                <Legend wrapperStyle={{paddingTop: '20px'}}/>
                                <Bar dataKey="users" name="Все сообщения" fill="#3B82F6" radius={[4, 4, 0, 0]} barSize={30} />
                                <Bar dataKey="ai" name="Ответы AI" fill="#8B5CF6" radius={[4, 4, 0, 0]} barSize={30} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                
                {/* Status Card & Logs */}
                <div className="bg-[#121214] rounded-2xl border border-gray-800 shadow-xl flex flex-col h-full overflow-hidden">
                    <div className="p-6 border-b border-gray-800 text-center bg-gradient-to-b from-gray-900 to-[#121214]">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 text-white transition-all duration-500 ${isAiThinking ? 'bg-purple-600 shadow-[0_0_20px_rgba(147,51,234,0.5)] scale-110' : 'bg-gray-800'}`}>
                            {isAiThinking ? <Icons.Sparkles size={24} className="animate-spin-slow"/> : <Icons.Zap size={24}/>}
                        </div>
                        <h3 className="text-lg font-bold text-white mb-1">
                            {isAiThinking ? <span className="text-purple-400 animate-pulse">Думает...</span> : "Статус Бота"}
                        </h3>
                        <p className="text-gray-400 text-xs">
                            {isAiThinking ? "Генерация ответа" : "Система стабильна"}
                        </p>
                    </div>
                    <div className="flex-1 p-4 overflow-y-auto custom-scrollbar bg-black/20">
                        <div className="space-y-3">
                            {auditLogs.slice(0, 5).map((log, i) => (
                                <div key={i} className="flex gap-3 items-start group">
                                    <div className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${log.type === 'danger' ? 'bg-red-500' : log.type === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'}`}></div>
                                    <div className="min-w-0">
                                        <div className="text-xs text-gray-300 font-medium truncate">{log.action}</div>
                                        <div className="text--[10px] text-gray-500 truncate">{new Date(log.timestamp).toLocaleTimeString()}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            
            {showActiveModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowActiveModal(false)}>
                    <div className="bg-[#121214] border border-gray-700 rounded-xl w-full max-w-2xl shadow-2xl p-6 animate-slideIn" onClick={e => e.stopPropagation()}>
                         <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Icons.Activity size={20} className="text-green-500"/> Активность</h3>
                            <button onClick={() => setShowActiveModal(false)}><Icons.X size={20} className="text-gray-500 hover:text-white"/></button>
                        </div>
                        <div className="max-h-[500px] overflow-y-auto custom-scrollbar space-y-2">
                            {activeUsers.length === 0 ? <p className="text-gray-500 text-center">Нет активности</p> : 
                            activeUsers.map((u, i) => (
                                <div key={u.id} className="flex items-center justify-between p-3 bg-gray-900 rounded-lg border border-gray-800">
                                    <div className="text-white text-sm font-bold">{i+1}. {u.name}</div>
                                    <div className="text-green-400 font-bold">{u.dailyMsgCount} сбщ</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
            
            {showGroupModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowGroupModal(false)}>
                     <div className="bg-[#121214] border border-gray-700 rounded-xl w-full max-w-3xl shadow-2xl p-6 animate-slideIn" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Icons.Folder size={20} className="text-yellow-500"/> Группы</h3>
                            <button onClick={() => setShowGroupModal(false)}><Icons.X size={20} className="text-gray-500 hover:text-white"/></button>
                        </div>
                        <div className="max-h-[500px] overflow-y-auto custom-scrollbar space-y-3">
                            {(Object.values(groups) as Group[]).map((g) => (
                                <div key={g.id} className="flex items-center justify-between p-4 bg-gray-900 rounded-lg border border-gray-800">
                                    <div className="text-white font-bold">{g.title}</div>
                                    <div className="flex gap-2">
                                        <button onClick={() => toggleGroup(String(g.id))} className={`px-3 py-1 rounded text-xs ${g.isDisabled ? 'bg-red-900 text-red-300' : 'bg-green-900 text-green-300'}`}>{g.isDisabled ? 'OFF' : 'ON'}</button>
                                        <button onClick={() => { if(window.confirm('Выйти?')) onDeleteGroup?.(String(g.id)); }} className="p-1 text-gray-500 hover:text-red-500"><Icons.Trash2 size={16}/></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {showAiModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowAiModal(false)}>
                    <div className="bg-[#121214] border border-gray-700 rounded-xl w-full max-w-4xl shadow-2xl animate-slideIn p-6" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Icons.Sparkles size={20} className="text-purple-500"/> Статистика AI</h3>
                            <div className="flex gap-2">
                                <button onClick={handleSendTopToAdmins} className="bg-purple-900/40 hover:bg-purple-900/60 text-purple-300 border border-purple-500/30 px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1">
                                    <Icons.Send size={14}/> Отправить ТОП Админам
                                </button>
                                <button onClick={() => setShowAiModal(false)}><Icons.X size={20} className="text-gray-500 hover:text-white"/></button>
                            </div>
                        </div>
                        
                        <div className="flex gap-2 mb-4 bg-gray-900 p-1 rounded-lg">
                            <button onClick={() => setAiModalTab('history')} className={`flex-1 py-1.5 rounded text-sm font-bold transition-colors ${aiModalTab === 'history' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>История</button>
                            <button onClick={() => setAiModalTab('top')} className={`flex-1 py-1.5 rounded text-sm font-bold transition-colors ${aiModalTab === 'top' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>ТОП Вопросов</button>
                        </div>

                        {aiModalTab === 'history' && (
                            <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar">
                                {((aiStats as any).history || []).filter((h: any) => !h.cleared).slice(0, 100).map((h: any, i: number) => (
                                    <div key={i} className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                                        <div className="flex justify-between text-xs text-gray-500 mb-2"><span>#{i+1}</span><span>{new Date(h.time).toLocaleString('ru-RU')}</span></div>
                                        <div className="text-white text-sm font-bold mb-1">Q: {h.query}</div>
                                        <div className="text-gray-400 text-sm pl-2 border-l-2 border-purple-900 whitespace-pre-wrap">A: {h.response}</div>
                                    </div>
                                ))}
                            </div>
                        )}

                         {aiModalTab === 'top' && (
                            <div className="space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar">
                                {getTopQuestions().slice(0, 50).map((item, i) => (
                                    <div key={i} className="bg-gray-900 p-4 rounded-lg border border-gray-800 flex items-center justify-between">
                                        <div className="text-white text-sm font-bold">{i+1}. {item.query}</div>
                                        <div className="bg-purple-900/40 text-purple-300 px-3 py-1 rounded text-sm font-bold">{item.count} раз</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;
