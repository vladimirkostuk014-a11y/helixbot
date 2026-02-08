
import React, { useState, useEffect, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { User, AiStats, BotConfig, Group, LogEntry } from '../types';
import { Icons } from './Icons';
import { apiCall, getAIResponse } from '../services/api';

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
}

const Dashboard: React.FC<DashboardProps> = ({ users, groups = {}, setGroups, aiStats, config, setConfig, isAiThinking, setAiStats, addLog, setActiveTab, onStopBot, onClearAiStats, viewMode = 'overview', auditLogs = [], onDeleteGroup }) => {
    const [aiSaveStatus, setAiSaveStatus] = useState('');
    const [banSaveStatus, setBanSaveStatus] = useState('');
    const [showGroupModal, setShowGroupModal] = useState(false);
    const [showActiveModal, setShowActiveModal] = useState(false);
    const [showAiModal, setShowAiModal] = useState(false);
    const [aiModalTab, setAiModalTab] = useState<'history' | 'top'>('history');
    
    // AI Playground State
    const [showPlayground, setShowPlayground] = useState(false);
    const [playgroundInput, setPlaygroundInput] = useState('');
    const [playgroundHistory, setPlaygroundHistory] = useState<{role: 'user'|'bot', text: string}[]>([]);
    const [isPlaygroundThinking, setIsPlaygroundThinking] = useState(false);
    const playgroundEndRef = useRef<HTMLDivElement>(null);

    const userArray: User[] = Object.values(users);
    const activeUsers = userArray.filter(u => u.dailyMsgCount > 0 && u.id > 0).sort((a, b) => b.dailyMsgCount - a.dailyMsgCount);
    
    useEffect(() => {
        if (showPlayground && playgroundEndRef.current) {
            playgroundEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [playgroundHistory, showPlayground, isPlaygroundThinking]);

    const getActivityData = () => {
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth(); 
        const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
        const dataMap = new Map<string, { date: string, messages: number, ai: number }>();

        // Pre-fill days
        for (let i = 1; i <= lastDayOfMonth; i++) {
            const d = new Date(year, month, i);
            const dateStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
            dataMap.set(dateStr, { date: dateStr, messages: 0, ai: 0 });
        }

        userArray.forEach(user => {
            if (user.history) {
                user.history.forEach(msg => {
                    let msgDate: Date;
                    if (msg.timestamp) {
                        msgDate = new Date(msg.timestamp);
                    } else {
                        msgDate = new Date(); 
                    }

                    if (msgDate.getFullYear() === year && msgDate.getMonth() === month && msg.isGroup) {
                        const dateStr = msgDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
                        if (dataMap.has(dateStr)) {
                            const entry = dataMap.get(dateStr)!;
                            entry.messages += 1;
                        }
                    }
                });
            }
        });

        if (aiStats.history) {
            aiStats.history.forEach(stat => {
                 const d = new Date(stat.time);
                 if (d.getFullYear() === year && d.getMonth() === month) {
                    const dateStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
                    if (dataMap.has(dateStr)) dataMap.get(dateStr)!.ai += 1;
                 }
            });
        }
        return Array.from(dataMap.values());
    };
    
    const getTopQuestions = () => {
        const counts: Record<string, number> = {};
        (aiStats.history || []).filter(h => !h.cleared).forEach(h => {
            const q = h.query.toLowerCase().trim();
            if (q) counts[q] = (counts[q] || 0) + 1;
        });
        return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([q, c]) => ({ query: q, count: c }));
    };
    
    const handleSave = (section: 'ai' | 'ban') => {
        setConfig({...config}); 
        if (section === 'ai') setAiSaveStatus('Сохранено!');
        else setBanSaveStatus('Сохранено!');
        if (addLog) addLog('Настройки', `Обновлены настройки ${section === 'ai' ? 'AI' : 'Бан-лист'}`, 'info');
        setTimeout(() => { if (section === 'ai') setAiSaveStatus(''); else setBanSaveStatus(''); }, 2000);
    };

    const toggleGroup = (groupId: string) => {
        if (!setGroups) return;
        setGroups(prev => ({
            ...prev,
            [groupId]: { ...prev[groupId], isDisabled: !prev[groupId].isDisabled }
        }));
    };

    const handlePlaygroundSend = async () => {
        if (!playgroundInput.trim()) return;
        const msg = playgroundInput;
        setPlaygroundInput('');
        setPlaygroundHistory(prev => [...prev, { role: 'user', text: msg }]);
        setIsPlaygroundThinking(true);
        try {
            const response = await getAIResponse(msg, config, "База знаний: (Песочница)");
            setPlaygroundHistory(prev => [...prev, { role: 'bot', text: response }]);
        } catch (e) {
            setPlaygroundHistory(prev => [...prev, { role: 'bot', text: "Error: " + e }]);
        } finally {
            setIsPlaygroundThinking(false);
        }
    };

    const handleClearChart = () => { if (onClearAiStats) onClearAiStats(); };

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
        return (
             <div className="space-y-6">
                 {/* AI Settings Block */}
                 <div className="bg-[#121214] p-6 rounded-2xl border border-gray-800 shadow-xl relative overflow-hidden flex flex-col h-full">
                    {/* ... (Same as before) ... */}
                    <div className="space-y-4 relative z-10 flex-1">
                        <div>
                            <label className="text-xs text-gray-400 font-bold uppercase mb-1 block">Личность</label>
                            <select value={config.aiPersonality || 'helpful'} onChange={e => setConfig({...config, aiPersonality: e.target.value})} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2.5 text-white text-sm focus:border-purple-500 outline-none transition-colors">
                                <option value="helpful">😄 Хеликс (Обычный)</option>
                                <option value="kind">💖 Добряк</option>
                                <option value="official">🧐 Официальный</option>
                                <option value="joker">🤡 Шутник</option>
                                <option value="angry">😡 Злой</option>
                                <option value="toxic">☣️ Токсик</option>
                                <option value="gopnik">🍺 Гопник (Мат)</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-gray-400 font-bold uppercase mb-1 block">Стиль ответа</label>
                            <select value={config.aiBehavior || 'balanced'} onChange={e => setConfig({...config, aiBehavior: e.target.value})} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2.5 text-white text-sm focus:border-purple-500 outline-none transition-colors">
                                <option value="balanced">⚖️ Сбалансированный</option>
                                <option value="concise">⚡ Коротко и ясно</option>
                                <option value="detailed">📜 Подробно и детально</option>
                            </select>
                        </div>
                        <div className="bg-gray-900/50 p-4 rounded-xl border border-gray-700">
                             <label className="flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-gray-800 transition-colors border border-gray-800 hover:border-red-500/30">
                                <input type="checkbox" checked={config.aiProfanity || false} onChange={e => setConfig({...config, aiProfanity: e.target.checked})} className="accent-red-500 w-4 h-4"/>
                                <span className="text-sm text-red-300 font-bold">🤬 Режим мата (18+)</span>
                            </label>
                        </div>
                         <div className="flex gap-2 mt-auto">
                            <button onClick={() => setShowPlayground(true)} className="flex-1 bg-gradient-to-r from-gray-900 to-gray-800 hover:from-gray-800 hover:to-gray-700 text-purple-300 border border-purple-900/30 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg flex items-center justify-center gap-2 group">
                                <Icons.Terminal size={18} className="text-purple-500 group-hover:scale-110 transition-transform"/>
                                <span>Тест Личности</span>
                            </button>
                            <button onClick={() => handleSave('ai')} className="flex-[2] bg-purple-600 hover:bg-purple-500 text-white py-2 rounded-xl text-sm font-bold transition-colors shadow-lg shadow-purple-900/20">
                                {aiSaveStatus || 'Сохранить настройки'}
                            </button>
                        </div>
                    </div>
                 </div>

                {/* Playground Modal */}
                {showPlayground && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowPlayground(false)}>
                        <div className="bg-[#121214] border border-gray-700 rounded-xl w-full max-w-2xl shadow-2xl animate-slideIn flex flex-col h-[600px]" onClick={e => e.stopPropagation()}>
                            <div className="flex justify-between items-center p-4 border-b border-gray-800">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2"><Icons.Terminal size={20} className="text-purple-500"/> Тест Личности (Sandbox)</h3>
                                <button onClick={() => setShowPlayground(false)}><Icons.X size={20} className="text-gray-500 hover:text-white"/></button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black/20">
                                {playgroundHistory.map((msg, i) => (
                                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-800 text-gray-200 rounded-bl-none border border-gray-700'}`}>
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

    return (
        <div className="space-y-8 relative">
            {/* Active Users Modal */}
            {showActiveModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowActiveModal(false)}>
                    <div className="bg-[#121214] border border-gray-700 rounded-xl w-full max-w-2xl shadow-2xl p-6 animate-slideIn" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Icons.Activity size={20} className="text-green-500"/> Активность (Daily Top)</h3>
                            <button onClick={() => setShowActiveModal(false)}><Icons.X size={20} className="text-gray-500 hover:text-white"/></button>
                        </div>
                        <div className="max-h-[500px] overflow-y-auto custom-scrollbar space-y-2">
                            {activeUsers.length === 0 ? <p className="text-gray-500 text-center">Нет активности сегодня</p> : 
                            activeUsers.map((u, i) => (
                                <div key={u.id} className="flex items-center justify-between p-3 bg-gray-900 rounded-lg border border-gray-800">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center font-bold text-xs">{i+1}</div>
                                        <div>
                                            <div className="text-white font-bold text-sm">{u.name}</div>
                                            <div className="text-xs text-gray-500">@{u.username}</div>
                                        </div>
                                    </div>
                                    <div className="text-green-400 font-bold">{u.dailyMsgCount} сбщ</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Groups Modal */}
            {showGroupModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowGroupModal(false)}>
                    <div className="bg-[#121214] border border-gray-700 rounded-xl w-full max-w-3xl shadow-2xl p-6 animate-slideIn" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Icons.Folder size={20} className="text-yellow-500"/> Подключенные Группы</h3>
                            <button onClick={() => setShowGroupModal(false)}><Icons.X size={20} className="text-gray-500 hover:text-white"/></button>
                        </div>
                        <div className="max-h-[500px] overflow-y-auto custom-scrollbar space-y-3">
                            {Object.values(groups).length === 0 ? <p className="text-gray-500 text-center">Бот еще не добавлен в группы</p> : 
                            Object.values(groups).map((g) => (
                                <div key={g.id} className="flex items-center justify-between p-4 bg-gray-900 rounded-lg border border-gray-800">
                                    <div>
                                        <div className="text-white font-bold">{g.title}</div>
                                        <div className="text-xs text-gray-500">ID: {g.id} • Тип: {g.type}</div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button 
                                            onClick={() => toggleGroup(String(g.id))} 
                                            className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${g.isDisabled ? 'bg-red-900/30 text-red-400' : 'bg-green-900/30 text-green-400'}`}
                                        >
                                            {g.isDisabled ? 'Бот Выкл' : 'Бот Вкл'}
                                        </button>
                                        <button 
                                            onClick={() => { if(window.confirm('Выйти из группы? Бот покинет чат.')) onDeleteGroup?.(String(g.id)); }}
                                            className="p-2 text-gray-500 hover:text-red-500 transition-colors"
                                            title="Выйти из группы"
                                        >
                                            <Icons.Trash2 size={16}/>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* AI Modal */}
            {showAiModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowAiModal(false)}>
                    <div className="bg-[#121214] border border-gray-700 rounded-xl w-full max-w-4xl shadow-2xl animate-slideIn p-6" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Icons.Sparkles size={20} className="text-purple-500"/> Статистика AI</h3>
                            <button onClick={() => setShowAiModal(false)}><Icons.X size={20} className="text-gray-500 hover:text-white"/></button>
                        </div>
                        
                        <div className="flex gap-2 mb-4 bg-gray-900 p-1 rounded-lg">
                            <button onClick={() => setAiModalTab('history')} className={`flex-1 py-1.5 rounded text-sm font-bold transition-colors ${aiModalTab === 'history' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>История</button>
                            <button onClick={() => setAiModalTab('top')} className={`flex-1 py-1.5 rounded text-sm font-bold transition-colors ${aiModalTab === 'top' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>ТОП Вопросов</button>
                        </div>

                        {aiModalTab === 'history' && (
                            <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar">
                                {(aiStats.history || []).filter(h => !h.cleared).length === 0 ? <p className="text-gray-500 text-center py-4">История пуста</p> : 
                                (aiStats.history || []).filter(h => !h.cleared).slice(0, 100).map((h, i) => (
                                    <div key={i} className="bg-gray-900 p-4 rounded-lg border border-gray-800 hover:border-gray-700 transition-colors">
                                        <div className="flex justify-between text-xs text-gray-500 mb-2">
                                            <span>Запрос #{i+1}</span>
                                            <span>{new Date(h.time).toLocaleString('ru-RU')}</span>
                                        </div>
                                        <div className="text-white text-sm font-bold mb-1">Q: {h.query}</div>
                                        <div className="text-gray-400 text-sm leading-relaxed border-l-2 border-purple-900/50 pl-2 mt-2">A: {h.response}</div>
                                    </div>
                                ))}
                            </div>
                        )}

                         {aiModalTab === 'top' && (
                            <div className="space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar">
                                {getTopQuestions().length === 0 ? <p className="text-gray-500 text-center py-4">Нет данных</p> : 
                                getTopQuestions().slice(0, 50).map((item, i) => (
                                    <div key={i} className="bg-gray-900 p-4 rounded-lg border border-gray-800 flex items-center justify-between hover:bg-gray-800 transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className={`w-8 h-8 rounded flex items-center justify-center text-sm font-bold ${i < 3 ? 'bg-yellow-600 text-white' : 'bg-gray-800 text-gray-500'}`}>{i+1}</div>
                                            <div className="text-white text-base font-medium">{item.query}</div>
                                        </div>
                                        <div className="bg-purple-900/40 text-purple-300 px-3 py-1 rounded text-sm font-bold">{item.count} раз</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
            
            {/* KPI Cards and Charts */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <KpiCard 
                    icon={Icons.Users} title="Всего пользователей" 
                    value={Object.keys(users).length} 
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

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                <div className="xl:col-span-2 bg-[#121214] p-6 rounded-2xl border border-gray-800 shadow-xl">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <Icons.Calendar size={20} className="text-blue-500"/> Динамика активности
                        </h3>
                        <div className="flex gap-2">
                            <button 
                                onClick={handleClearChart}
                                className="text-xs text-gray-500 hover:text-red-400 flex items-center gap-1 transition-colors px-2 py-1 rounded hover:bg-gray-800" 
                            >
                                <Icons.Trash2 size={12}/> Очистить
                            </button>
                        </div>
                    </div>
                    <div className="h-[350px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={getActivityData()}>
                                <defs>
                                    <linearGradient id="colorMsg" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                                    </linearGradient>
                                    <linearGradient id="colorAi" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="date" stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} dy={10} interval={Math.floor(getActivityData().length / 6)} />
                                <YAxis stroke="#4b5563" fontSize={12} tickLine={false} axisLine={false} dx={-10} allowDecimals={false} />
                                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                                <Tooltip 
                                    contentStyle={{backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'}}
                                    itemStyle={{fontSize: '12px', fontWeight: 'bold'}}
                                />
                                <Area type="monotone" dataKey="messages" name="Сообщения (Чат)" stroke="#3B82F6" strokeWidth={3} fillOpacity={1} fill="url(#colorMsg)" />
                                <Area type="monotone" dataKey="ai" name="AI Ответы" stroke="#8B5CF6" strokeWidth={3} fillOpacity={1} fill="url(#colorAi)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                
                <div className="bg-[#121214] rounded-2xl border border-gray-800 shadow-xl flex flex-col h-full overflow-hidden">
                    <div className="p-6 border-b border-gray-800 text-center bg-gradient-to-b from-gray-900 to-[#121214]">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 text-white transition-all duration-500 ${isAiThinking ? 'bg-purple-600 shadow-[0_0_20px_rgba(147,51,234,0.5)] scale-110' : 'bg-gray-800'}`}>
                            {isAiThinking ? <Icons.Sparkles size={24} className="animate-spin-slow"/> : <Icons.Zap size={24}/>}
                        </div>
                        <h3 className="text-lg font-bold text-white mb-1">
                            {isAiThinking ? <span className="text-purple-400 animate-pulse">Хеликс думает...</span> : "Статус Бота"}
                        </h3>
                        <p className="text-gray-400 text-xs">
                            {isAiThinking ? "Генерация ответа" : "Система работает стабильно."}
                        </p>
                    </div>
                    
                    <div className="flex-1 p-4 overflow-y-auto custom-scrollbar bg-black/20">
                        <div className="space-y-3">
                            {auditLogs.slice(0, 5).map((log, i) => (
                                <div key={i} className="flex gap-3 items-start group animate-slideIn">
                                    <div className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                                        log.type === 'danger' ? 'bg-red-500' : 
                                        log.type === 'warning' ? 'bg-yellow-500' : 
                                        'bg-blue-500'
                                    }`}></div>
                                    <div className="min-w-0">
                                        <div className="text-xs text-gray-300 font-medium truncate">{log.action}</div>
                                        <div className="text-[10px] text-gray-500 truncate">{new Date(log.timestamp).toLocaleTimeString()}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
