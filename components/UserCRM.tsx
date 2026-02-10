
import React, { useState, useRef, useEffect } from 'react';
import { Icons } from './Icons';
import { User, BotConfig, InlineButton, Command } from '../types';
import { apiCall } from '../services/api';
import { saveData } from '../services/firebase';

interface UserCRMProps {
    users: Record<string, User>;
    setUsers: React.Dispatch<React.SetStateAction<Record<string, User>>>;
    config: BotConfig;
    commands?: Command[];
    topicNames?: Record<string, string>;
    addLog?: (action: string, details: string, type?: 'info' | 'warning' | 'danger' | 'success') => void;
}

const UserCRM: React.FC<UserCRMProps> = ({ users, setUsers, config, commands = [], topicNames = {}, addLog }) => {
    const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [msgText, setMsgText] = useState('');
    const [mediaFile, setMediaFile] = useState<File | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    
    // Derived state for safe access
    const selectedUser = selectedUserId && users[selectedUserId] ? users[selectedUserId] : null;

    useEffect(() => {
        if (selectedUser && selectedUser.unreadCount) {
             setUsers(prev => ({ ...prev, [selectedUser.id]: { ...prev[selectedUser.id], unreadCount: 0 } }));
             saveData(`users/${selectedUser.id}/unreadCount`, 0);
        }
    }, [selectedUserId]);

    useEffect(() => {
        if (selectedUser && chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [selectedUser, isSending]); 

    const getFilteredUsers = () => {
        return (Object.values(users) as User[]).filter((u: User) => {
            if (u.id < 0 || u.id === 777000 || u.id === 1087968824) return false;
            // Users with status 'left' are removed from DB by server, but if any linger, filter them
            if (u.status === 'left') return false; 
            
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                return u.name.toLowerCase().includes(term) || u.username?.toLowerCase().includes(term) || String(u.id).includes(term);
            }
            return true;
        }).sort((a, b) => (b.unreadCount || 0) - (a.unreadCount || 0) || new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
    };

    const handleKickUser = async () => {
        if (!selectedUserId || !selectedUser) return;
        if (window.confirm(`Вы точно хотите кикнуть ${selectedUser.name}?`)) {
            try {
                await apiCall('banChatMember', { chat_id: config.targetChatId, user_id: selectedUserId }, config);
                await apiCall('unbanChatMember', { chat_id: config.targetChatId, user_id: selectedUserId }, config);
                // The server listens to left_chat_member and will remove the user from Firebase
                // We just clear selection
                setSelectedUserId(null);
                if (addLog) addLog('Kick', `Пользователь ${selectedUser.name} исключен`, 'warning');
            } catch (e) { alert('Ошибка: ' + e); }
        }
    };

    const handleWarn = async (delta: number) => {
        if (!selectedUserId || !selectedUser) return;
        const currentWarns = selectedUser.warnings || 0;
        const newWarns = Math.max(0, Math.min(3, currentWarns + delta));
        
        // Optimistic update
        setUsers(prev => ({ ...prev, [selectedUserId]: { ...prev[selectedUserId], warnings: newWarns } }));
        saveData(`users/${selectedUserId}/warnings`, newWarns);
        
        // Send notification via bot
        if (delta > 0) {
             await apiCall('sendMessage', { chat_id: config.targetChatId, text: `⚠️ <b>${selectedUser.name}</b>: предупреждение (${newWarns}/3)`, parse_mode: 'HTML' }, config);
        }
    };

    const handleRoleChange = (role: 'admin' | 'user') => {
        if (!selectedUserId) return;
        setUsers(prev => ({ ...prev, [selectedUserId]: { ...prev[selectedUserId], role } }));
        saveData(`users/${selectedUserId}/role`, role);
    };

    return (
        <div className="flex h-full bg-[#0c0c0e] rounded-2xl overflow-hidden border border-gray-800 shadow-2xl">
            {/* User List */}
            <div className={`w-full md:w-80 flex flex-col border-r border-gray-800 bg-[#121214] ${selectedUser ? 'hidden md:flex' : 'flex'}`}>
                <div className="p-4 border-b border-gray-800">
                    <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Поиск участника..." className="w-full bg-black/40 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-blue-500 transition-colors"/>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {getFilteredUsers().map((u: User) => (
                        <div key={u.id} onClick={() => setSelectedUserId(u.id)} className={`p-4 border-b border-gray-800/50 cursor-pointer hover:bg-gray-800/50 transition-all ${selectedUserId === u.id ? 'bg-blue-900/10 border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'}`}>
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 shadow-lg ${u.role === 'admin' ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-gray-300'}`}>{u.name.charAt(0)}</div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex justify-between items-center">
                                        <div className="font-bold text-gray-200 truncate text-sm">{u.name}</div>
                                        {u.status === 'banned' && <Icons.Slash size={14} className="text-red-500"/>}
                                        {u.status === 'muted' && <Icons.Mic size={14} className="text-yellow-500"/>}
                                    </div>
                                    <div className="text-xs text-gray-500 truncate">@{u.username || u.id}</div>
                                </div>
                                {u.unreadCount ? (<span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{u.unreadCount}</span>) : u.warnings > 0 && (<span className="bg-red-900/50 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">{u.warnings} <Icons.AlertTriangle size={8}/></span>)}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main View */}
            {selectedUser ? (
                <div className="flex-1 flex flex-col relative bg-[#09090b]">
                    <div className="h-16 border-b border-gray-800 flex items-center justify-between px-4 md:px-6 bg-[#121214]">
                        <div className="flex items-center gap-4">
                            <button className="md:hidden text-gray-400" onClick={() => setSelectedUserId(null)}><Icons.ChevronDown className="rotate-90" size={24}/></button>
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${selectedUser.role === 'admin' ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-white'}`}>{selectedUser.name.charAt(0)}</div>
                            <div>
                                <div className="font-bold text-white text-sm">{selectedUser.name}</div>
                                <div className="text-xs text-gray-400">@{selectedUser.username || selectedUser.id} <span className="ml-2 px-1.5 rounded text-[10px] uppercase font-bold bg-gray-800 text-gray-400">{selectedUser.role}</span></div>
                            </div>
                        </div>
                        <button onClick={handleKickUser} className="bg-red-900/20 text-red-500 border border-red-900/40 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-red-900/40 transition-colors flex items-center gap-2">
                            <Icons.X size={14}/> ИСКЛЮЧИТЬ
                        </button>
                    </div>

                    <div className="flex-1 flex overflow-hidden">
                        <div className="flex-1 flex flex-col p-6 space-y-6">
                            <div className="bg-gray-900/50 p-6 rounded-2xl border border-gray-800">
                                <h3 className="text-sm font-bold text-gray-400 uppercase mb-4">Статус и Наказания</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="bg-black/40 p-4 rounded-xl border border-gray-800">
                                        <div className="flex justify-between items-center mb-3"><span className="text-xs text-gray-500">Предупреждения (Warns)</span><span className="text-xl font-mono text-yellow-500">{selectedUser.warnings || 0}/3</span></div>
                                        <div className="flex gap-2"><button onClick={() => handleWarn(-1)} className="flex-1 bg-gray-800 hover:bg-gray-700 py-2 rounded-lg font-bold transition-colors">-</button><button onClick={() => handleWarn(1)} className="flex-1 bg-red-900/20 hover:bg-red-900/40 text-red-400 py-2 rounded-lg font-bold border border-red-900/50 transition-colors">+</button></div>
                                    </div>
                                    <div className="bg-black/40 p-4 rounded-xl border border-gray-800">
                                        <div className="flex justify-between items-center mb-3"><span className="text-xs text-gray-500">Роль в системе</span></div>
                                        <div className="flex gap-2"><button onClick={() => handleRoleChange('admin')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${selectedUser.role === 'admin' ? 'bg-yellow-600 text-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>Админ</button><button onClick={() => handleRoleChange('user')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${selectedUser.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>Юзер</button></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-600 hidden md:flex">
                    <Icons.Users size={64} className="opacity-10 mb-4"/>
                    <p>Выберите пользователя для управления</p>
                </div>
            )}
        </div>
    );
};

export default UserCRM;
