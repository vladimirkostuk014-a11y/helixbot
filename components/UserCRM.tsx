
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
    const [mediaUrl, setMediaUrl] = useState('');
    const [mediaFile, setMediaFile] = useState<File | null>(null);
    const [buttons, setButtons] = useState<InlineButton[]>([]);
    const [btnDraft, setBtnDraft] = useState({ text: '', url: '' });
    const [showTools, setShowTools] = useState(false);

    const chatEndRef = useRef<HTMLDivElement>(null);
    const prevTotalUnreadRef = useRef(0);
    
    const selectedUser = selectedUserId ? users[selectedUserId] : null;

    // AUDIO NOTIFICATION
    useEffect(() => {
        const totalUnread = (Object.values(users) as User[]).reduce((acc, u) => acc + (u.unreadCount || 0), 0);
        if (totalUnread > prevTotalUnreadRef.current) {
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
            audio.volume = 0.5;
            audio.play().catch(e => console.log("Play blocked", e));
        }
        prevTotalUnreadRef.current = totalUnread;
    }, [users]);

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
    }, [selectedUser, users, isSending]); 

    const getFilteredUsers = () => {
        return (Object.values(users) as User[]).filter((u: User) => {
            if (u.id < 0) return false; 
            if (u.id === 777000 || u.id === 1087968824) return false;
            if (u.name.toLowerCase().includes('bot') || u.name === 'Group') return false; 
            
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                return u.name.toLowerCase().includes(term) || u.username?.toLowerCase().includes(term) || String(u.id).includes(term);
            }
            return true;
        }).sort((a, b) => (b.unreadCount || 0) - (a.unreadCount || 0) || new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
    };

    const handleRoleChange = (role: 'admin' | 'user') => {
        if (!selectedUserId) return;
        setUsers(prev => ({ ...prev, [selectedUserId]: { ...prev[selectedUserId], role } }));
        saveData(`users/${selectedUserId}/role`, role);
        if (addLog) addLog('Роль', `Пользователь ${selectedUser?.name} теперь ${role}`, 'warning');
    };

    const handleClearHistory = () => {
        if (!selectedUserId) return;
        if (window.confirm('Вы уверены, что хотите очистить переписку с этим пользователем?')) {
            setUsers(prev => ({ ...prev, [selectedUserId]: { ...prev[selectedUserId], history: [] } }));
            saveData(`users/${selectedUserId}/history`, []);
            if (addLog) addLog('CRM', `Очищена история с ${selectedUser?.name}`, 'info');
        }
    };

    const exportToCsv = () => {
        const userList = getFilteredUsers();
        if (userList.length === 0) return;
        const headers = ['ID', 'Name', 'Username', 'Role', 'Status', 'Messages', 'Last Seen', 'Warnings'];
        const rows = userList.map(u => [u.id, `"${u.name.replace(/"/g, '""')}"`, u.username || '', u.role, u.status, u.msgCount, u.lastSeen, u.warnings]);
        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `users_export_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleMute = async (minutes: number) => {
        if (!selectedUserId) return;
        const until = minutes === 0 ? 0 : Math.floor(Date.now() / 1000) + (minutes * 60);
        const perms = { can_send_messages: false };
        await apiCall('restrictChatMember', { chat_id: config.targetChatId, user_id: selectedUserId, permissions: JSON.stringify(perms), until_date: until }, config);
        setUsers(prev => ({ ...prev, [selectedUserId]: { ...prev[selectedUserId], status: 'muted' } }));
        saveData(`users/${selectedUserId}/status`, 'muted');
        if (addLog) addLog('Мут', `Выдан мут пользователю ${selectedUser?.name} (${minutes === 0 ? 'навсегда' : minutes + 'мин'})`, 'danger');
    };

    const handleUnmute = async () => {
        if (!selectedUserId) return;
        const perms = { can_send_messages: true, can_send_media_messages: true, can_send_other_messages: true };
        await apiCall('restrictChatMember', { chat_id: config.targetChatId, user_id: selectedUserId, permissions: JSON.stringify(perms) }, config);
        setUsers(prev => ({ ...prev, [selectedUserId]: { ...prev[selectedUserId], status: 'active' } }));
        saveData(`users/${selectedUserId}/status`, 'active');
        if (addLog) addLog('Снятие мута', `Снят мут с ${selectedUser?.name}`, 'success');
    };

    const handleBanToggle = async () => {
        if (!selectedUserId || !selectedUser) return;
        if (selectedUser.status === 'banned') {
            await apiCall('unbanChatMember', { chat_id: config.targetChatId, user_id: selectedUserId, only_if_banned: true }, config);
            setUsers(prev => ({ ...prev, [selectedUserId]: { ...prev[selectedUserId], status: 'active' } }));
            saveData(`users/${selectedUserId}/status`, 'active');
            if (addLog) addLog('Разбан', `Разбанен ${selectedUser.name}`, 'success');
        } else {
            await apiCall('banChatMember', { chat_id: config.targetChatId, user_id: selectedUserId }, config);
            setUsers(prev => ({ ...prev, [selectedUserId]: { ...prev[selectedUserId], status: 'banned' } }));
            saveData(`users/${selectedUserId}/status`, 'banned');
            if (addLog) addLog('Бан', `Забанен ${selectedUser.name}`, 'danger');
        }
    };

    const handleWarn = async (delta: number) => {
        if (!selectedUserId || !selectedUser) return;
        const currentWarns = selectedUser.warnings || 0;
        const newWarns = Math.max(0, Math.min(3, currentWarns + delta));
        setUsers(prev => ({ ...prev, [selectedUserId]: { ...prev[selectedUserId], warnings: newWarns } }));
        saveData(`users/${selectedUserId}/warnings`, newWarns);
        try {
            if (delta > 0 && newWarns < 3) await apiCall('sendMessage', { chat_id: config.targetChatId, text: `⚠️ @${selectedUser.username || selectedUser.name}, предупреждение (${newWarns}/3).` }, config);
            if (delta < 0) await apiCall('sendMessage', { chat_id: config.targetChatId, text: `🕊 @${selectedUser.username || selectedUser.name}, предупреждение снято. Счет: ${newWarns}/3.` }, config);
        } catch (e) { console.error(e); }
        if (newWarns >= 3 && delta > 0) {
            handleMute(2880); 
            await apiCall('sendMessage', { chat_id: config.targetChatId, text: `🛑 @${selectedUser.username || selectedUser.name} получил 3-й варн и заглушен на 48 часов.` }, config);
            setUsers(prev => ({ ...prev, [selectedUserId]: { ...prev[selectedUserId], warnings: 0 } }));
            saveData(`users/${selectedUserId}/warnings`, 0);
        }
    };

    const handleAddButton = () => {
        if (!btnDraft.text) return;
        setButtons([...buttons, btnDraft]);
        setBtnDraft({ text: '', url: '' });
    };

    const handleSendPrivate = async () => {
        if (!selectedUserId || (!msgText.trim() && !mediaFile && !mediaUrl)) return;
        setIsSending(true);
        try {
            const markup = buttons.length > 0 ? JSON.stringify({ inline_keyboard: buttons.map(b => [{ text: b.text, url: b.url }]) }) : undefined;
            let finalMediaUrl = mediaUrl;
            if (mediaFile) {
                const fd = new FormData();
                fd.append('chat_id', String(selectedUserId));
                const method = mediaFile.type.startsWith('video') ? 'sendVideo' : 'sendPhoto';
                fd.append(method === 'sendVideo' ? 'video' : 'photo', mediaFile);
                if (msgText) fd.append('caption', msgText);
                if (markup) fd.append('reply_markup', markup);
                await apiCall(method, fd, config, true);
                finalMediaUrl = URL.createObjectURL(mediaFile);
            } else if (mediaUrl) {
                await apiCall('sendPhoto', { chat_id: selectedUserId, photo: mediaUrl, caption: msgText, reply_markup: markup ? JSON.parse(markup) : undefined }, config);
            } else {
                await apiCall('sendMessage', { chat_id: selectedUserId, text: msgText, reply_markup: markup ? JSON.parse(markup) : undefined }, config);
            }
            const newMsg = { dir: 'out', text: msgText, type: (mediaFile || mediaUrl) ? 'photo' : 'text', mediaUrl: finalMediaUrl, buttons: buttons, time: new Date().toLocaleTimeString('ru-RU'), isGroup: false };
            const updatedHistory = [...(users[selectedUserId].history || []), newMsg];
            setUsers(prev => ({ ...prev, [selectedUserId]: { ...prev[selectedUserId], history: updatedHistory as any } }));
            saveData(`users/${selectedUserId}/history`, updatedHistory);
            setMsgText(''); setMediaFile(null); setMediaUrl(''); setButtons([]); setShowTools(false);
        } catch (e) { alert('Ошибка: ' + e); } finally { setIsSending(false); }
    };

    return (
        <div className="flex h-full bg-[#0c0c0e] rounded-2xl overflow-hidden border border-gray-800 shadow-2xl">
            {/* List */}
            <div className={`w-80 flex flex-col border-r border-gray-800 bg-[#121214] ${selectedUser ? 'hidden md:flex' : 'flex w-full'}`}>
                <div className="p-4 border-b border-gray-800 flex gap-2">
                    <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Поиск..." className="flex-1 bg-black/40 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-blue-500 transition-colors"/>
                    <button onClick={exportToCsv} className="bg-gray-800 hover:bg-gray-700 p-2 rounded-xl text-blue-400 border border-gray-700" title="Экспорт в CSV"><Icons.Upload size={18} className="rotate-180"/></button>
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
                                    <div className="text-xs text-gray-500 truncate">@{u.username || '---'}</div>
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
                    <div className="h-16 border-b border-gray-800 flex items-center justify-between px-6 bg-[#121214]">
                        <div className="flex items-center gap-4">
                            <button className="md:hidden text-gray-400" onClick={() => setSelectedUserId(null)}><Icons.ChevronRight className="rotate-180"/></button>
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${selectedUser.role === 'admin' ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-white'}`}>{selectedUser.name.charAt(0)}</div>
                            <div>
                                <div className="font-bold text-white text-sm">{selectedUser.name} <span className="text-xs font-normal text-gray-500 ml-2">ID: {selectedUser.id}</span></div>
                                <div className="text-xs text-gray-400 flex items-center gap-2">@{selectedUser.username || 'no_user'} <span className={`px-1.5 rounded text-[10px] uppercase font-bold ${selectedUser.role === 'admin' ? 'bg-yellow-900/40 text-yellow-500' : 'bg-gray-800 text-gray-500'}`}>{selectedUser.role}</span></div>
                            </div>
                        </div>
                        <button onClick={handleClearHistory} className="text-gray-500 hover:text-red-500 p-2 rounded-lg transition-colors border border-gray-700/50 hover:bg-gray-800"><Icons.Trash2 size={18}/></button>
                    </div>

                    <div className="flex flex-1 overflow-hidden">
                        <div className="flex-1 flex flex-col min-w-0 bg-black/20 relative">
                             <div className="absolute inset-0 opacity-5 pointer-events-none" style={{backgroundImage: 'radial-gradient(circle at 1px 1px, #333 1px, transparent 0)', backgroundSize: '20px 20px'}}></div>
                            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar flex flex-col-reverse relative z-10">
                                <div ref={chatEndRef}/>
                                {[...(selectedUser.history || []).filter(m => !m.isGroup)].reverse().map((msg, i) => {
                                    const isOut = msg.dir === 'out';
                                    return (
                                        <div key={i} className={`flex w-full ${isOut ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm shadow-md transition-all ${isOut ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-gray-800 text-gray-200 rounded-bl-sm border border-gray-700'}`}>
                                                {msg.mediaUrl && <img src={msg.mediaUrl} className="max-w-full rounded-lg mb-2 mt-1 max-h-40 object-cover"/>}
                                                {msg.text && <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>}
                                                {msg.buttons && msg.buttons.length > 0 && <div className="mt-2 pt-2 border-t border-white/20 flex flex-wrap gap-2">{msg.buttons.map((b, bi) => <span key={bi} className="bg-black/20 px-2 py-1 rounded text-xs">{b.text}</span>)}</div>}
                                                <div className="text-[10px] opacity-50 text-right mt-1 flex justify-end items-center gap-1">{msg.time}{isOut && <Icons.Check size={10}/>}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                                {(selectedUser.history || []).filter(m => !m.isGroup).length === 0 && (<div className="flex items-center justify-center h-full text-gray-600 text-sm">История сообщений пуста</div>)}
                            </div>
                            
                            <div className="p-4 bg-[#121214] border-t border-gray-800 relative z-20">
                                {showTools && (
                                    <div className="mb-3 p-3 bg-gray-800 rounded-lg border border-gray-700 animate-slideIn">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-[10px] uppercase text-gray-500 font-bold mb-1 block">Медиа</label>
                                                <div className="flex gap-2">
                                                    <input value={mediaUrl} onChange={e => setMediaUrl(e.target.value)} placeholder="URL..." className="flex-1 bg-black border border-gray-600 rounded px-2 py-1 text-xs text-white"/>
                                                    <label className="bg-gray-700 hover:bg-gray-600 px-2 rounded flex items-center justify-center cursor-pointer border border-gray-600"><Icons.Upload size={14}/><input type="file" onChange={e => setMediaFile(e.target.files ? e.target.files[0] : null)} className="hidden"/></label>
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-[10px] uppercase text-gray-500 font-bold mb-1 block">Кнопки</label>
                                                <div className="flex gap-2 mb-1">
                                                    <input value={btnDraft.text} onChange={e => setBtnDraft({...btnDraft, text: e.target.value})} placeholder="Txt" className="w-1/3 bg-black border border-gray-600 rounded px-2 py-1 text-xs text-white"/>
                                                    <input value={btnDraft.url} onChange={e => setBtnDraft({...btnDraft, url: e.target.value})} placeholder="Url" className="flex-1 bg-black border border-gray-600 rounded px-2 py-1 text-xs text-white"/>
                                                    <button onClick={handleAddButton} className="bg-gray-700 px-2 rounded hover:bg-gray-600"><Icons.Plus size={14}/></button>
                                                </div>
                                                <div className="flex flex-wrap gap-1">{buttons.map((b, i) => (<span key={i} className="text-[9px] bg-blue-900/50 text-blue-200 px-1 rounded border border-blue-800">{b.text}</span>))}</div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <button onClick={() => setShowTools(!showTools)} className={`p-3 rounded-xl transition-colors ${showTools ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}><Icons.Plus size={20}/></button>
                                    <textarea value={msgText} onChange={e => setMsgText(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendPrivate())} placeholder="Личное сообщение..." className="flex-1 bg-black border border-gray-700 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-blue-500 resize-none h-12"/>
                                    <button onClick={handleSendPrivate} disabled={isSending} className="bg-blue-600 hover:bg-blue-500 text-white w-12 rounded-xl flex items-center justify-center transition-colors shadow-lg shadow-blue-900/20"><Icons.Send size={20}/></button>
                                </div>
                            </div>
                        </div>

                        <div className="w-72 bg-[#121214] border-l border-gray-800 p-6 overflow-y-auto custom-scrollbar">
                            {selectedUser.role !== 'admin' && (
                                <>
                                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Наказания</h3>
                                    <div className="mb-6 p-4 bg-black/30 rounded-xl border border-gray-800">
                                        <div className="flex justify-between items-center mb-2"><span className="text-sm font-bold text-white flex items-center gap-2"><Icons.AlertTriangle size={14} className="text-yellow-500"/> Варны</span><span className="text-lg font-mono text-yellow-500">{selectedUser.warnings || 0}/3</span></div>
                                        <div className="flex gap-2"><button onClick={() => handleWarn(-1)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2 rounded-lg font-bold text-lg">-</button><button onClick={() => handleWarn(1)} className="flex-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-900/50 py-2 rounded-lg font-bold text-lg">+</button></div>
                                    </div>
                                    <div className="mb-6 p-4 bg-black/30 rounded-xl border border-gray-800">
                                        <div className="flex justify-between items-center mb-3"><span className="text-sm font-bold text-white flex items-center gap-2"><Icons.Mic size={14} className="text-blue-400"/> Мут</span>{selectedUser.status === 'muted' && <span className="text-[10px] bg-yellow-900/50 text-yellow-500 px-2 rounded">Активен</span>}</div>
                                        <div className="grid grid-cols-2 gap-2 mb-2"><button onClick={() => handleMute(10)} className="bg-gray-800 hover:bg-gray-700 text-xs py-2 rounded text-gray-300">10 мин</button><button onClick={() => handleMute(60)} className="bg-gray-800 hover:bg-gray-700 text-xs py-2 rounded text-gray-300">1 час</button><button onClick={() => handleMute(1440)} className="bg-gray-800 hover:bg-gray-700 text-xs py-2 rounded text-gray-300">24 ч</button><button onClick={() => handleMute(0)} className="bg-gray-800 hover:bg-gray-700 text-xs py-2 rounded text-gray-300">Вечно</button></div>
                                        <button onClick={handleUnmute} className="w-full bg-green-900/20 hover:bg-green-900/40 text-green-400 border border-green-900/50 text-xs py-2 rounded transition-colors">Снять Мут</button>
                                    </div>
                                    <div className="mb-6"><button onClick={handleBanToggle} className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${selectedUser.status === 'banned' ? 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/20' : 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/20'}`}>{selectedUser.status === 'banned' ? <><Icons.Check size={18}/> Разбанить</> : <><Icons.Slash size={18}/> ЗАБАНИТЬ</>}</button></div>
                                </>
                            )}
                             <div>
                                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Роль</h3>
                                <div className="flex bg-black rounded-lg p-1 border border-gray-800">
                                    <button onClick={() => handleRoleChange('user')} className={`flex-1 text-xs py-1.5 rounded transition-colors ${selectedUser.role === 'user' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-white'}`}>Юзер</button>
                                    <button onClick={() => handleRoleChange('admin')} className={`flex-1 text-xs py-1.5 rounded transition-colors ${selectedUser.role === 'admin' ? 'bg-yellow-600 text-black font-bold' : 'text-gray-500 hover:text-white'}`}>Админ</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-600 bg-[#0f0f12]">
                    <div className="w-24 h-24 bg-gray-900 rounded-full flex items-center justify-center mb-4 shadow-inner"><Icons.Users size={48} className="opacity-20"/></div>
                    <p className="font-medium">Выберите пользователя из списка</p>
                </div>
            )}
        </div>
    );
};

export default UserCRM;
