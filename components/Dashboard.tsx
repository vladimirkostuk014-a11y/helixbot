
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
    
    // Manual Group Add State
    const [newGroupId, setNewGroupId] = useState('');
    
    // AI Playground State
    const [showPlayground, setShowPlayground] = useState(false);
    const [playgroundInput, setPlaygroundInput] = useState('');
    const [playgroundHistory, setPlaygroundHistory] = useState<{role: 'user'|'bot', text: string}[]>([]);
    const [isPlaygroundThinking, setIsPlaygroundThinking] = useState(false);
    const playgroundEndRef = useRef<HTMLDivElement>(null);

    // UI state for inline confirmation inside modal
    const [showAiClearConfirm, setShowAiClearConfirm] = useState(false);
    
    const userArray: User[] = Object.values(users);
    const activeUsers = userArray.filter(u => u.dailyMsgCount > 0).sort((a, b) => b.dailyMsgCount - a.dailyMsgCount);
    
    useEffect(() => {
        if (showPlayground && playgroundEndRef.current) {
            playgroundEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [playgroundHistory, showPlayground, isPlaygroundThinking]);

    // Calculates REAL activity for the CURRENT CALENDAR MONTH
    const getActivityData = () => {
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth(); // 0-indexed
        const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
        const dataMap = new Map<string, { date: string, messages: number, ai: number }>();

        for (let i = 1; i <= lastDayOfMonth; i++) {
            const d = new Date(year, month, i);
            const dateStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
            dataMap.set(dateStr, { date: dateStr, messages: 0, ai: 0 });
        }

        const isCurrentMonth = (ts: number) => {
            const d = new Date(ts);
            return d.getFullYear() === year && d.getMonth() === month;
        };

        userArray.forEach(user => {
            if (user.history) {
                user.history.forEach(msg => {
                    // STRICT FILTER: Only count messages from Groups (Chat)
                    if (msg.timestamp && isCurrentMonth(msg.timestamp) && msg.isGroup) {
                        const d = new Date(msg.timestamp);
                        const dateStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
                        if (dataMap.has(dateStr)) dataMap.get(dateStr)!.messages += 1;
                    }
                });
            }
        });

        if (aiStats.history) {
            aiStats.history.forEach(stat => {
                 if (isCurrentMonth(stat.time)) {
                    const d = new Date(stat.time);
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
        
        // Stop bot on save
        if (onStopBot) {
            onStopBot();
        }

        if (section === 'ai') setAiSaveStatus('Сохранено! (Бот остановлен)');
        else setBanSaveStatus('Сохранено! (Бот остановлен)');
        
        if (addLog) addLog('Настройки', `Обновлены настройки ${section === 'ai' ? 'AI' : 'Бан-лист'} (Перезапустите бота)`, 'warning');
        
        setTimeout(() => {
            if (section === 'ai') setAiSaveStatus('');
            else setBanSaveStatus('');
        }, 2000);
    };

    const toggleGroup = (groupId: string) => {
        if (!setGroups) return;
        setGroups(prev => ({
            ...prev,
            [groupId]: { ...prev[groupId], isDisabled: !prev[groupId].isDisabled }
        }));
    };

    const handleAddGroup = () => {
        if (!setGroups || !newGroupId.trim()) return;
        const id = newGroupId.trim();
        setGroups(prev => {
            if (prev[id]) return prev; // Already exists
            return {
                ...prev,
                [id]: {
                    id: parseInt(id),
                    title: `Group ${id} (Manual)`,
                    type: 'manual',
                    lastActive: new Date().toLocaleTimeString(),
                    isDisabled: false
                }
            };
        });
        setNewGroupId('');
        if (addLog) addLog('Группы', `Добавлена группа по ID: ${id}`, 'success');
    };

    const sendAiReport = async () => {
        const topList = getTopQuestions().slice(0, 10).map((item, i) => `${i+1}. ${item.query} — ${item.count} раз`).join('\n');
        
        if (topList) {
            const admins = config.adminIds.split(',').map(id => id.trim()).filter(id => id);
            for (const adminId of admins) {
                await apiCall('sendMessage', { chat_id: adminId, text: `🤖 **ТОП Вопросов (AI)**\n\n${topList}` }, config);
            }
            alert('ТОП вопросов отправлен администраторам');
        } else {
            alert('История запросов пуста');
        }
    };

    const handlePlaygroundSend = async () => {
        if (!playgroundInput.trim()) return;
        const msg = playgroundInput;
        setPlaygroundInput('');
        setPlaygroundHistory(prev => [...prev, { role: 'user', text: msg }]);
        setIsPlaygroundThinking(true);

        try {
            const response = await getAIResponse(msg, config, "База знаний: (В режиме песочницы используется ограниченная база)");
            setPlaygroundHistory(prev => [...prev, { role: 'bot', text: response }]);
        } catch (e) {
            setPlaygroundHistory(prev => [...prev, { role: 'bot', text: "Error: " + e }]);
        } finally {
            setIsPlaygroundThinking(false);
        }
    };

    const handleClearPlayground = () => {
        setPlaygroundHistory([]);
    };

    const handleClearChart = () => {
        // Immediate clear without confirmation as requested
        if (onClearAiStats) onClearAiStats();
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

    // --- RENDER FOR SETTINGS MODE ---
    if (viewMode === 'settings') {
        return (
            <div className="space-y-6">
                <div className="bg-[#121214] p-6 rounded-2xl border border-gray-800 shadow-xl relative overflow-hidden flex flex-col h-full">
                    <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-purple-500 to-indigo-500"></div>
                    
                    <div className="flex justify-between items-start mb-5 relative z-10">
                            <h3 className="font-bold text-lg text-white flex items-center gap-2"><Icons.Sparkles className="text-purple-400"/> AI Настройки (Helix)</h3>
                            {/* Status Indicator */}
                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border backdrop-blur-sm ${config.enableAI ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                                <div className={`w-2 h-2 rounded-full ${config.enableAI ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                                <span className="text-xs font-bold tracking-wider">{config.enableAI ? 'РАБОТАЕТ' : 'ОТКЛЮЧЕН'}</span>
                            </div>
                    </div>
                    
                    <div className="space-y-4 relative z-10 flex-1">
                        <div>
                            <label className="text-xs text-gray-400 font-bold uppercase mb-1 block">Личность</label>
                            <select 
                                value={config.aiPersonality || 'helpful'} 
                                onChange={e => setConfig({...config, aiPersonality: e.target.value})}
                                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2.5 text-white text-sm focus:border-purple-500 outline-none transition-colors"
                            >
                                <option value="helpful">😄 Хеликс (Обычный)</option>
                                <option value="kind">💖 Добряк</option>
                                <option value="official">🧐 Официальный</option>
                                <option value="joker">🤡 Шутник</option>
                                <option value="angry">😡 Злой</option>
                                <option value="toxic">☣️ Токсик</option>
                                <option value="gopnik">🍺 Гопник</option>
                                <option value="philosopher">🤔 Философ</option>
                                <option value="cyberpunk">🦾 Киберпанк</option>
                                <option value="grandma">👴 Дедушка</option>
                            </select>
                        </div>
                        
                        <div>
                            <label className="text-xs text-gray-400 font-bold uppercase mb-1 block">Стиль ответа</label>
                            <select 
                                value={config.aiBehavior || 'balanced'} 
                                onChange={e => setConfig({...config, aiBehavior: e.target.value})}
                                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2.5 text-white text-sm focus:border-purple-500 outline-none transition-colors"
                            >
                                <option value="balanced">⚖️ Сбалансированный</option>
                                <option value="concise">⚡ Коротко и ясно</option>
                                <option value="detailed">📜 Подробно и детально</option>
                                <option value="mentor">🎓 Наставник (Объясняет)</option>
                                <option value="passive">😐 Пассивный (Минимум слов)</option>
                            </select>
                        </div>

                        <div className="bg-gray-900/50 p-4 rounded-xl border border-gray-700">
                            <div className="mb-4">
                                <div className="flex justify-between text-xs text-gray-400 mb-1">
                                    <span>Креативность (Температура)</span>
                                    <span className="text-purple-400 font-bold">{config.aiTemperature || 0.7}</span>
                                </div>
                                <input type="range" min="0" max="2" step="0.1" value={config.aiTemperature || 0.7} onChange={e => setConfig({...config, aiTemperature: parseFloat(e.target.value)})} className="w-full accent-purple-500 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer"/>
                            </div>
                            <div className="mb-4">
                                <div className="flex justify-between text-xs text-gray-400 mb-1">
                                    <span>Длина ответа (Символы/Токены)</span>
                                    <span className="text-purple-400 font-bold">{config.aiMaxTokens || 1000}</span>
                                </div>
                                <input type="range" min="100" max="4000" step="100" value={config.aiMaxTokens || 1000} onChange={e => setConfig({...config, aiMaxTokens: parseInt(e.target.value)})} className="w-full accent-purple-500 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer"/>
                            </div>
                            <div className="flex flex-col gap-2 pt-2">
                                <label className="flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-gray-800 transition-colors border border-gray-800 hover:border-red-500/30">
                                    <input type="checkbox" checked={config.aiProfanity || false} onChange={e => setConfig({...config, aiProfanity: e.target.checked})} className="accent-red-500 w-4 h-4"/>
                                    <span className="text-sm text-red-300 font-bold">🤬 Режим мата (18+)</span>
                                </label>
                                <label className="flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-gray-800 transition-colors">
                                    <input type="checkbox" checked={config.enableAI} onChange={e => setConfig({...config, enableAI: e.target.checked})} className="accent-purple-500 w-4 h-4"/>
                                    <span className="text-sm text-gray-300">AI Авто-ответы</span>
                                </label>
                                <label className="flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-gray-800 transition-colors">
                                    <input type="checkbox" checked={config.enablePM !== false} onChange={e => setConfig({...config, enablePM: e.target.checked})} className="accent-blue-500 w-4 h-4"/>
                                    <span className="text-sm text-gray-300">Работа в ЛС</span>
                                </label>
                            </div>
                        </div>
                        
                        {/* AI Terminal / Logs */}
                        <div className="bg-black/40 rounded-xl border border-gray-800 p-3 font-mono text-xs text-gray-400 h-28 overflow-hidden relative">
                            <div className="absolute top-2 right-2 flex gap-1">
                                <div className="w-2 h-2 rounded-full bg-gray-600"></div>
                                <div className="w-2 h-2 rounded-full bg-gray-600"></div>
                            </div>
                            <div className="text-gray-500 border-b border-gray-800 pb-1 mb-2">HELIX_TERMINAL_V1.0</div>
                            {isAiThinking ? (
                                <div className="text-purple-400 animate-pulse">&gt; Generating response...</div>
                            ) : (
                                <div className="text-green-500">&gt; System Ready. Waiting for input.</div>
                            )}
                            <div className="mt-2 space-y-1 opacity-70">
                                {aiStats.history && aiStats.history.filter(h=>!h.cleared).slice(0, 2).map((h, i) => (
                                    <div key={i} className="truncate">&gt; {h.query}</div>
                                ))}
                            </div>
                        </div>
                        
                        <div className="flex gap-2 mt-auto">
                            <button 
                                onClick={() => setShowPlayground(true)} 
                                className="flex-1 bg-gradient-to-r from-gray-900 to-gray-800 hover:from-gray-800 hover:to-gray-700 text-purple-300 border border-purple-900/30 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg flex items-center justify-center gap-2 group"
                            >
                                <Icons.Terminal size={18} className="text-purple-500 group-hover:scale-110 transition-transform"/>
                                <span>Тест Личности</span>
                            </button>
                            <button onClick={() => handleSave('ai')} className="flex-[2] bg-purple-600 hover:bg-purple-500 text-white py-2 rounded-xl text-sm font-bold transition-colors shadow-lg shadow-purple-900/20">
                                {aiSaveStatus || 'Сохранить настройки'}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="bg-[#121214] p-6 rounded-2xl border border-gray-800 shadow-xl">
                        <h3 className="font-bold text-lg text-white mb-4 flex items-center gap-2"><Icons.Shield className="text-red-400"/> Фильтр слов (Бан)</h3>
                        <textarea 
                            value={config.bannedWords || ''} 
                            onChange={e => setConfig({...config, bannedWords: e.target.value})} 
                            className="w-full bg-gray-900 border border-gray-700 rounded-xl p-3 text-sm text-red-300 font-mono h-24 outline-none focus:border-red-500 resize-none" 
                            placeholder="слова через запятую..."
                        />
                        <button onClick={() => handleSave('ban')} className="w-full mt-4 bg-white text-black hover:bg-gray-200 py-3 rounded-xl text-sm font-bold transition-colors">
                        {banSaveStatus || 'Сохранить изменения'}
                    </button>
                </div>

                {/* AI Playground Modal - FIXED POSITIONING */}
                {showPlayground && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowPlayground(false)}>
                        <div className="bg-[#121214] border border-gray-700 rounded-xl w-full max-w-2xl shadow-2xl animate-slideIn flex flex-col h-[600px]" onClick={e => e.stopPropagation()}>
                            <div className="flex justify-between items-center p-4 border-b border-gray-800">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <Icons.Terminal size={20} className="text-purple-500"/> Тест Личности (Sandbox)
                                </h3>
                                <div className="flex items-center gap-2">
                                    <button 
                                        onClick={handleClearPlayground} 
                                        className="p-2 hover:bg-red-900/20 text-gray-500 hover:text-red-400 rounded-lg transition-colors"
                                        title="Очистить переписку"
                                    >
                                        <Icons.Trash2 size={18} />
                                    </button>
                                    <div className="w-px h-6 bg-gray-800 mx-1"></div>
                                    <button onClick={() => setShowPlayground(false)} className="text-gray-500 hover:text-white p-1"><Icons.X size={20}/></button>
                                </div>
                            </div>
                            
                            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black/20">
                                {playgroundHistory.length === 0 && (
                                    <div className="text-center text-gray-600 mt-20">
                                        <Icons.Sparkles size={48} className="mx-auto mb-2 opacity-20"/>
                                        <p>Напишите сообщение, чтобы проверить настройки личности.</p>
                                    </div>
                                )}
                                {playgroundHistory.map((msg, i) => (
                                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-800 text-gray-200 rounded-bl-none border border-gray-700'}`}>
                                            <div className="font-bold text-[10px] opacity-50 mb-1">{msg.role === 'user' ? 'Вы' : config.botName}</div>
                                            {msg.text}
                                        </div>
                                    </div>
                                ))}
                                {isPlaygroundThinking && (
                                    <div className="flex justify-start">
                                        <div className="bg-gray-800 text-purple-400 rounded-2xl rounded-bl-none px-4 py-2 text-xs flex items-center gap-2 border border-gray-700">
                                            <div className="flex space-x-1">
                                                <div className="w-1 h-1 bg-purple-400 rounded-full animate-bounce"></div>
                                                <div className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                                                <div className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                                            </div>
                                            <span>Печатает...</span>
                                        </div>
                                    </div>
                                )}
                                <div ref={playgroundEndRef}/>
                            </div>

                            <div className="p-4 border-t border-gray-800 bg-gray-900/50 rounded-b-xl flex gap-2">
                                <input 
                                    value={playgroundInput} 
                                    onChange={e => setPlaygroundInput(e.target.value)} 
                                    onKeyDown={e => e.key === 'Enter' && handlePlaygroundSend()}
                                    placeholder="Сообщение боту..." 
                                    className="flex-1 bg-black border border-gray-700 rounded-lg px-4 py-2 text-white outline-none focus:border-purple-500 transition-colors"
                                    autoFocus
                                />
                                <button onClick={handlePlaygroundSend} disabled={isPlaygroundThinking} className="bg-purple-600 hover:bg-purple-500 p-2 rounded-lg text-white transition-colors">
                                    <Icons.Send size={20}/>
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // --- RENDER FOR OVERVIEW MODE ---
    return (
        <div className="space-y-8 relative">
            
            {/* Groups Modal */}
            {showGroupModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowGroupModal(false)}>
                    <div className="bg-[#121214] border border-gray-700 rounded-xl w-full max-w-4xl shadow-2xl animate-slideIn p-6" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Icons.Folder size={20} className="text-yellow-500"/> Управление Группами</h3>
                            <button onClick={() => setShowGroupModal(false)}><Icons.X size={20} className="text-gray-500 hover:text-white"/></button>
                        </div>
                        
                        <div className="mb-4 flex gap-2 bg-gray-900 p-3 rounded-lg border border-gray-800">
                            <input value={newGroupId} onChange={e => setNewGroupId(e.target.value)} placeholder="ID группы (например -100...)" className="flex-1 bg-black border border-gray-700 rounded px-3 py-2 text-sm text-white"/>
                            <button onClick={handleAddGroup} className="bg-blue-600 hover:bg-blue-500 text-white px-4 rounded text-sm font-bold">Добавить</button>
                        </div>

                        <div className="space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar">
                            {Object.values(groups).length === 0 ? <p className="text-gray-500 text-center">Нет подключенных групп</p> : 
                            Object.values(groups).map((g: Group) => (
                                <div key={g.id} className="flex items-center justify-between bg-gray-900 p-4 rounded-lg border border-gray-800">
                                    <div>
                                        <div className="font-bold text-white text-lg">{g.title}</div>
                                        <div className="text-sm text-gray-500">ID: {g.id}</div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={() => toggleGroup(String(g.id))} 
                                            className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${g.isDisabled ? 'bg-red-900/50 text-red-400 hover:bg-red-900/70' : 'bg-green-900/50 text-green-400 hover:bg-green-900/70'}`}
                                        >
                                            {g.isDisabled ? 'ОТКЛЮЧЕН' : 'АКТИВЕН'}
                                        </button>
                                        {onDeleteGroup && (
                                            <button 
                                                onClick={() => onDeleteGroup(String(g.id))}
                                                className="bg-gray-800 hover:bg-red-900/40 text-gray-400 hover:text-red-400 p-2 rounded-lg transition-colors border border-gray-700 hover:border-red-900/50"
                                                title="Удалить группу и выйти из чата"
                                            >
                                                <Icons.Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Active Users Modal */}
            {showActiveModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowActiveModal(false)}>
                    <div className="bg-[#121214] border border-gray-700 rounded-xl w-full max-w-4xl shadow-2xl animate-slideIn p-6" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Icons.Activity size={20} className="text-green-500"/> Активные Сегодня ({activeUsers.length})</h3>
                            <button onClick={() => setShowActiveModal(false)}><Icons.X size={20} className="text-gray-500 hover:text-white"/></button>
                        </div>
                        <div className="space-y-2 max-h-[600px] overflow-y-auto custom-scrollbar">
                            {activeUsers.length === 0 ? <p className="text-gray-500 text-center py-4">Сегодня сообщений не было</p> : 
                            activeUsers.map((u, i) => (
                                <div key={u.id} className="flex items-center justify-between bg-gray-900 p-4 rounded-lg border border-gray-800">
                                    <div className="flex items-center gap-4">
                                        <div className="text-gray-500 font-mono text-sm w-8 text-center bg-gray-800 rounded py-1">#{i+1}</div>
                                        <div>
                                            <div className="font-bold text-white text-base">{u.name}</div>
                                            <div className="text-sm text-gray-500">@{u.username || '---'}</div>
                                        </div>
                                    </div>
                                    <div className="bg-green-900/30 text-green-400 px-3 py-1.5 rounded-lg text-sm font-bold">
                                        {u.dailyMsgCount} сообщ.
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* AI Stats Modal - Remains for detail view */}
            {showAiModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => { setShowAiModal(false); setShowAiClearConfirm(false); }}>
                    <div className="bg-[#121214] border border-gray-700 rounded-xl w-full max-w-5xl shadow-2xl animate-slideIn p-6" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Icons.Sparkles size={20} className="text-purple-500"/> Статистика AI</h3>
                            <button onClick={() => setShowAiModal(false)}><Icons.X size={20} className="text-gray-500 hover:text-white"/></button>
                        </div>
                        
                        <div className="flex gap-2 mb-4 bg-gray-900 p-1 rounded-lg">
                            <button onClick={() => setAiModalTab('history')} className={`flex-1 py-1.5 rounded text-sm font-bold transition-colors ${aiModalTab === 'history' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>История</button>
                            <button onClick={() => setAiModalTab('top')} className={`flex-1 py-1.5 rounded text-sm font-bold transition-colors ${aiModalTab === 'top' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>ТОП Вопросов</button>
                        </div>

                        {aiModalTab === 'history' && (
                            <>
                                <div className="mb-4">
                                    <button onClick={sendAiReport} className="w-full bg-purple-600 hover:bg-purple-500 text-white py-2 rounded-lg font-bold transition-colors flex items-center justify-center gap-2">
                                        <Icons.Send size={16}/> Отправить ТОП вопросов админам
                                    </button>
                                </div>
                                <div className="space-y-3 max-h-[600px] overflow-y-auto custom-scrollbar">
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
                            </>
                        )}

                        {aiModalTab === 'top' && (
                            <div className="space-y-2 max-h-[600px] overflow-y-auto custom-scrollbar">
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

            {/* KPI Cards */}
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

            {/* Main Content Area */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                
                {/* Main Activity Chart */}
                <div className="xl:col-span-2 bg-[#121214] p-6 rounded-2xl border border-gray-800 shadow-xl">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <Icons.Calendar size={20} className="text-blue-500"/> Динамика активности
                        </h3>
                        <div className="flex gap-2">
                            <button 
                                onClick={handleClearChart}
                                className="text-xs text-gray-500 hover:text-red-400 flex items-center gap-1 transition-colors px-2 py-1 rounded hover:bg-gray-800" 
                                title="Очистить историю AI ответов (график сбросится)"
                            >
                                <Icons.Trash2 size={12}/> Очистить
                            </button>
                            <span className="text-xs text-gray-500 bg-gray-800 px-3 py-1 rounded-full border border-gray-700">Только чаты • Текущий месяц</span>
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

                {/* Info Panel & Logs */}
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
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Последние события</span>
                            {isAiThinking && <span className="text-[10px] text-purple-400 animate-pulse">Обработка...</span>}
                        </div>
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
                            {auditLogs.length === 0 && <div className="text-center text-gray-600 text-xs py-4">Журнал пуст</div>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
