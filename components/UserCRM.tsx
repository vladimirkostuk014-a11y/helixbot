
import React, { useState, useRef, useEffect } from 'react';
import { Icons } from './Icons';
import { User, BotConfig, Message, InlineButton } from '../types';
import { apiCall } from '../services/api';
import { saveData, removeData } from '../services/firebase';

interface UserCRMProps {
    users: Record<string, User>;
    setUsers: React.Dispatch<React.SetStateAction<Record<string, User>>>;
    config: BotConfig;
    commands?: any[];
    topicNames?: Record<string, string>;
    addLog?: (action: string, details: string, type?: 'info' | 'warning' | 'danger' | 'success') => void;
}

const UserCRM: React.FC<UserCRMProps> = ({ users, setUsers, config, topicNames = {}, addLog }) => {
    const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    
    // Chat Inputs
    const [msgText, setMsgText] = useState('');
    const [mediaFile, setMediaFile] = useState<File | null>(null);
    const [buttons, setButtons] = useState<InlineButton[]>([]);
    const [btnDraft, setBtnDraft] = useState({ text: '', url: '' });
    const [showTools, setShowTools] = useState(false);

    const chatEndRef = useRef<HTMLDivElement>(null);
    
    const selectedUser = selectedUserId !== null ? users[String(selectedUserId)] : null;

    useEffect(() => {
        if (selectedUser && selectedUser.unreadCount) {
             setUsers(prev => ({ ...prev, [selectedUser.id]: { ...prev[selectedUser.id], unreadCount: 0 } }));
             saveData(`users/${selectedUser.id}/unreadCount`, 0);
        }
    }, [selectedUserId, users]);

    useEffect(() => {
        if (selectedUser && chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [selectedUser, selectedUser?.history]); 

    const getFilteredUsers = () => {
        return (Object.values(users) as User[]).filter((u: User) => {
            if (!u) return false;
            // Filter out system IDs and invalid IDs
            if (u.id < 0 || u.id === 777000 || u.id === 1087968824) return false;
            
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                const name = u.name ? u.name.toLowerCase() : '';
                const username = u.username ? u.username.toLowerCase() : '';
                const idStr = String(u.id);
                return name.includes(term) || username.includes(term) || idStr.includes(term);
            }
            return true;
        }).sort((a, b) => {
            if ((b.unreadCount || 0) !== (a.unreadCount || 0)) return (b.unreadCount || 0) - (a.unreadCount || 0);
            return new Date(b.lastSeen || 0).getTime() - new Date(a.lastSeen || 0).getTime();
        });
    };

    const handleSendMessage = async () => {
        if (!selectedUser) return;
        if (!msgText.trim() && !mediaFile) return;

        try {
            const markup = buttons.length > 0 ? JSON.stringify({ 
                inline_keyboard: buttons.map(b => [{ text: b.text, url: b.url }]) 
            }) : '';
            
            let res;
            const previewUrl = mediaFile ? URL.createObjectURL(mediaFile) : undefined;
            const msgType = mediaFile ? (mediaFile.type.startsWith('video') ? 'video' : 'photo') : 'text';

            if (mediaFile) {
                const fd = new FormData();
                fd.append('chat_id', String(selectedUser.id));
                const method = mediaFile.type.startsWith('video') ? 'sendVideo' : 'sendPhoto';
                fd.append(method === 'sendVideo' ? 'video' : 'photo', mediaFile, mediaFile.name);
                
                if (msgText) fd.append('caption', msgText);
                if (markup) fd.append('reply_markup', markup);
                fd.append('parse_mode', 'HTML');
                
                res = await apiCall(method, fd, config, true);
            } else {
                res = await apiCall('sendMessage', { 
                    chat_id: selectedUser.id, 
                    text: msgText,
                    parse_mode: 'HTML',
                    reply_markup: markup ? JSON.parse(markup) : undefined
                }, config);
            }

            if (res.ok) {
                const newMsg: Message = {
                    dir: 'out',
                    text: msgText,
                    type: msgType,
                    mediaUrl: previewUrl,
                    buttons: buttons,
                    time: new Date().toLocaleTimeString('ru-RU'),
                    timestamp: Date.now(),
                    isGroup: false,
                    user: 'Admin'
                };
                const updatedHistory = [...(selectedUser.history || []), newMsg];
                setUsers(prev => ({...prev, [selectedUser.id]: { ...selectedUser, history: updatedHistory }}));
                saveData(`users/${selectedUser.id}/history`, updatedHistory);
                
                setMsgText('');
                setMediaFile(null);
                setButtons([]);
                setShowTools(false);
            } else {
                alert(`Ошибка API: ${res.description || 'Unknown error'}`);
            }
        } catch (e: any) {
            alert('Ошибка сети или блокировка ботом: ' + e.message);
        }
    };

    const handleAddButton = () => {
        if (!btnDraft.text) return;
        setButtons([...buttons, btnDraft]);
        setBtnDraft({ text: '', url: '' });
    };

    // Helper to delete user by ID (used in list and detailed view)
    const performDeleteUser = async (userId: number, userName: string) => {
        if (window.confirm(`ВНИМАНИЕ! Вы хотите удалить пользователя ${userName} из базы данных навсегда?\nВся история переписки будет стерта.`)) {
             // 1. Clear selection if deleted user is selected
            if (selectedUserId === userId) {
                setSelectedUserId(null);
            }

            // 2. Optimistic update
            setUsers(prev => {
                const n = {...prev};
                delete n[String(userId)];
                return n;
            });

            // 3. Perform delete
            await removeData(`users/${userId}`);
            
            if (addLog) addLog('CRM', `Пользователь ${userName} удален из базы вручную`, 'danger');
        }
    }

    const handleDeleteUser = async () => {
        if (!selectedUserId || !selectedUser) return;
        await performDeleteUser(selectedUserId, selectedUser.name);
    };

    const handleMuteAction = async (action: 'mute' | 'unmute') => {
        if (!selectedUserId || !selectedUser) return;
        
        try {
            if (action === 'mute') {
                await apiCall('restrictChatMember', {
                    chat_id: config.targetChatId,
                    user_id: selectedUserId,
                    permissions: JSON.stringify({ can_send_messages: false }),
                    until_date: Math.floor(Date.now() / 1000) + 86400 // 24 hours
                }, config);
                
                setUsers(prev => ({ ...prev, [selectedUserId]: { ...prev[selectedUserId], status: 'muted' } }));
                saveData(`users/${selectedUserId}/status`, 'muted');
                if (addLog) addLog('Mute', `Заглушен ${selectedUser.name}`, 'warning');
            } else {
                await apiCall('restrictChatMember', {
                    chat_id: config.targetChatId,
                    user_id: selectedUserId,
                    permissions: JSON.stringify({ 
                        can_send_messages: true,
                        can_send_media_messages: true,
                        can_send_polls: true,
                        can_send_other_messages: true,
                        can_add_web_page_previews: true,
                        can_invite_users: true
                    })
                }, config);

                setUsers(prev => ({ ...prev, [selectedUserId]: { ...prev[selectedUserId], status: 'active', warnings: 0 } }));
                saveData(`users/${selectedUserId}/status`, 'active');
                saveData(`users/${selectedUserId}/warnings`, 0);
                if (addLog) addLog('Unmute', `Снят мут с ${selectedUser.name}`, 'success');
            }
        } catch (e: any) {
             alert('Ошибка API: ' + e.message);
        }
    };

    const handleBanAction = async (action: 'ban' | 'unban' | 'kick') => {
        if (!selectedUserId || !selectedUser) return;
        
        if (!window.confirm(`Вы уверены, что хотите ${action} пользователя ${selectedUser.name}?`)) return;

        try {
            if (action === 'kick') {
                await apiCall('banChatMember', { chat_id: config.targetChatId, user_id: selectedUserId }, config);
                await apiCall('unbanChatMember', { chat_id: config.targetChatId, user_id: selectedUserId }, config);
                if (addLog) addLog('Kick', `Кикнут ${selectedUser.name}`, 'warning');
            } else if (action === 'ban') {
                await apiCall('banChatMember', { chat_id: config.targetChatId, user_id: selectedUserId }, config);
                setUsers(prev => ({ ...prev, [selectedUserId]: { ...prev[selectedUserId], status: 'banned' } }));
                saveData(`users/${selectedUserId}/status`, 'banned');
                if (addLog) addLog('Ban', `Забанен ${selectedUser.name}`, 'danger');
            } else if (action === 'unban') {
                await apiCall('unbanChatMember', { chat_id: config.targetChatId, user_id: selectedUserId, only_if_banned: true }, config);
                setUsers(prev => ({ ...prev, [selectedUserId]: { ...prev[selectedUserId], status: 'active', warnings: 0 } }));
                saveData(`users/${selectedUserId}/status`, 'active');
                saveData(`users/${selectedUserId}/warnings`, 0);
                if (addLog) addLog('Unban', `Разбанен ${selectedUser.name}`, 'success');
            }
        } catch (e: any) {
            alert('Ошибка API: ' + e.message || e);
        }
    };

    const handleWarn = async (delta: number) => {
        if (!selectedUserId || !selectedUser) return;
        const currentWarns = selectedUser.warnings || 0;
        const newWarns = Math.max(0, Math.min(3, currentWarns + delta));
        
        setUsers(prev => ({ ...prev, [selectedUserId]: { ...prev[selectedUserId], warnings: newWarns } }));
        saveData(`users/${selectedUserId}/warnings`, newWarns);
        
        if (delta > 0) {
             await apiCall('sendMessage', { chat_id: config.targetChatId, text: `⚠️ <b>${selectedUser.name}</b>: предупреждение (${newWarns}/3)`, parse_mode: 'HTML' }, config);
        }
    };
    
    const visibleHistory = (selectedUser?.history || []).filter(msg => !msg.isGroup);

    return (
        <div className="flex h-full bg-[#0c0c0e] rounded-2xl overflow-hidden border border-gray-800 shadow-2xl">
            {/* Left Side: User List */}
            <div className={`w-full md:w-80 flex flex-col border-r border-gray-800 bg-[#121214] ${selectedUser ? 'hidden md:flex' : 'flex'}`}>
                <div className="p-4 border-b border-gray-800 bg-gray-900/50">
                    <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Поиск (ID, Имя, @username)..." className="w-full bg-black/40 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-blue-500 transition-colors"/>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {getFilteredUsers().length === 0 && <div className="text-center text-gray-500 py-10 text-xs">Нет данных</div>}
                    {getFilteredUsers().map((u: User) => (
                        <div key={u.id} onClick={() => setSelectedUserId(u.id)} className={`group relative p-3 border-b border-gray-800/30 cursor-pointer hover:bg-gray-800/50 transition-all ${selectedUserId === u.id ? 'bg-blue-900/10 border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'} ${u.status === 'banned' ? 'opacity-80 bg-red-900/10' : ''}`}>
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 shadow-lg relative ${u.status === 'banned' ? 'bg-red-900 text-red-200' : u.role === 'admin' ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-gray-300'}`}>
                                    {u.name.charAt(0)}
                                    {u.status === 'banned' && <div className="absolute -top-1 -right-1 bg-red-600 rounded-full p-0.5 border border-black"><Icons.X size={10} className="text-white"/></div>}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex justify-between items-center">
                                        <div className={`font-bold truncate text-sm ${u.status === 'banned' ? 'text-red-400' : 'text-gray-200'}`}>{u.name}</div>
                                        {u.status === 'banned' && <span className="text-[10px] bg-red-900/50 text-red-400 px-1.5 rounded">BAN</span>}
                                        {u.status === 'muted' && <span className="text-[10px] bg-yellow-900/50 text-yellow-400 px-1.5 rounded">MUTE</span>}
                                    </div>
                                    <div className="text-xs text-gray-500 truncate flex gap-1">
                                        <span>@{u.username || '---'}</span>
                                        <span className="text-gray-600">•</span>
                                        <span>ID: {u.id}</span>
                                    </div>
                                </div>
                                {u.unreadCount ? (<span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{u.unreadCount}</span>) : u.warnings > 0 && (<span className="bg-yellow-900/50 text-yellow-400 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">{u.warnings}⚠️</span>)}
                            </div>
                            {/* Delete button on hover for list item */}
                            <button 
                                onClick={(e) => { e.stopPropagation(); performDeleteUser(u.id, u.name); }} 
                                className="absolute right-2 top-1/2 -translate-y-1/2 bg-red-900/80 text-white p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700"
                                title="Удалить из базы"
                            >
                                <Icons.Trash2 size={16}/>
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Right Side: Chat & Details */}
            {selectedUser ? (
                <div className="flex-1 flex flex-col relative bg-[#09090b]">
                    {/* Header */}
                    <div className="h-16 border-b border-gray-800 flex items-center justify-between px-4 bg-[#121214]">
                        <div className="flex items-center gap-3">
                            <button className="md:hidden text-gray-400" onClick={() => setSelectedUserId(null)}><Icons.ChevronDown className="rotate-90" size={24}/></button>
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${selectedUser.status === 'banned' ? 'bg-red-600 text-white' : selectedUser.status === 'muted' ? 'bg-yellow-600 text-white' : 'bg-blue-600 text-white'}`}>
                                {selectedUser.name.charAt(0)}
                            </div>
                            <div>
                                <div className="font-bold text-white text-sm flex items-center gap-2">
                                    {selectedUser.name}
                                    <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-bold ${
                                        selectedUser.status === 'banned' ? 'bg-red-900 text-red-200' : 
                                        selectedUser.status === 'muted' ? 'bg-yellow-900 text-yellow-200' :
                                        'bg-green-900 text-green-200'
                                    }`}>{selectedUser.status}</span>
                                </div>
                                <div className="text-xs text-gray-400">Был: {selectedUser.lastSeen}</div>
                            </div>
                        </div>
                        <div className="flex gap-2 items-center">
                            <button onClick={handleDeleteUser} className="text-gray-500 hover:text-red-500 p-2 rounded-lg transition-colors flex items-center gap-2 text-xs font-bold bg-gray-900/50 hover:bg-gray-900 border border-gray-800" title="Удалить из базы">
                                <Icons.Trash2 size={16}/> Удалить
                            </button>
                            <div className="w-[1px] bg-gray-700 h-6 my-auto mx-1"></div>
                            
                            {/* Ban/Mute/Kick Controls */}
                            {selectedUser.status === 'banned' ? (
                                <button onClick={() => handleBanAction('unban')} className="bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2">
                                    <Icons.CheckSquare size={14}/> РАЗБАНИТЬ
                                </button>
                            ) : selectedUser.status === 'muted' ? (
                                <>
                                    <button onClick={() => handleMuteAction('unmute')} className="bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2">
                                        <Icons.Mic size={14}/> РАЗМУТИТЬ
                                    </button>
                                    <button onClick={() => handleBanAction('ban')} className="bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-900/50 px-3 py-1.5 rounded-lg text-xs font-bold">
                                        ЗАБАНИТЬ
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button onClick={() => handleMuteAction('mute')} className="bg-yellow-900/20 hover:bg-yellow-900/40 text-yellow-400 border border-yellow-500/30 px-3 py-1.5 rounded-lg text-xs font-bold">
                                        MUTE
                                    </button>
                                    <button onClick={() => handleBanAction('kick')} className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg text-xs font-bold">
                                        KICK
                                    </button>
                                    <button onClick={() => handleBanAction('ban')} className="bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-900/50 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2">
                                        <Icons.Slash size={14}/> BAN
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Content Area */}
                    <div className="flex-1 flex overflow-hidden">
                        {/* Chat History */}
                        <div className="flex-1 flex flex-col bg-black/20 relative" style={{backgroundImage: "url('https://web.telegram.org/img/bg_dark.png')", backgroundRepeat: 'repeat'}}>
                            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-0"></div>
                            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar relative z-10">
                                {visibleHistory.length === 0 && <div className="text-center text-gray-600 mt-10 text-sm">История ЛС пуста</div>}
                                {visibleHistory.map((msg, i) => (
                                    <div key={i} className={`flex w-full ${msg.dir === 'out' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm relative shadow-md ${msg.dir === 'out' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-800 text-gray-200 rounded-bl-none border border-gray-700'}`}>
                                            {msg.mediaUrl && (
                                                <div className="mb-2 rounded overflow-hidden">
                                                    {msg.type === 'video' ? <video src={msg.mediaUrl} controls className="max-h-48 rounded"/> : <img src={msg.mediaUrl} alt="media" className="max-h-48 rounded"/>}
                                                </div>
                                            )}
                                            <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>
                                            {msg.buttons && msg.buttons.length > 0 && (
                                                <div className="mt-2 space-y-1">
                                                    {msg.buttons.map((b, bi) => (
                                                        <a key={bi} href={b.url} target="_blank" rel="noopener noreferrer" className="block text-center bg-white/10 hover:bg-white/20 py-1 rounded text-xs text-blue-200">{b.text}</a>
                                                    ))}
                                                </div>
                                            )}
                                            <div className="text-[10px] opacity-60 text-right mt-1">{msg.time}</div>
                                        </div>
                                    </div>
                                ))}
                                <div ref={chatEndRef}/>
                            </div>
                            
                            {/* Rich Input Area */}
                            <div className="p-3 bg-gray-900 border-t border-gray-800 z-20 relative">
                                {showTools && (
                                    <div className="mb-2 p-2 bg-gray-800 rounded-lg animate-slideIn">
                                        <div className="flex items-center gap-2 mb-2">
                                            <label className="flex items-center gap-2 bg-black border border-gray-600 px-3 py-1.5 rounded text-xs text-white cursor-pointer hover:border-blue-500 transition-colors">
                                                <Icons.Upload size={14}/>
                                                {mediaFile ? mediaFile.name : 'Прикрепить фото/видео'}
                                                <input type="file" onChange={e => setMediaFile(e.target.files ? e.target.files[0] : null)} className="hidden"/>
                                            </label>
                                            {mediaFile && <button onClick={() => setMediaFile(null)} className="text-red-400 hover:text-red-300"><Icons.X size={16}/></button>}
                                        </div>
                                        <div className="flex gap-2">
                                            <input value={btnDraft.text} onChange={e => setBtnDraft({...btnDraft, text: e.target.value})} placeholder="Кнопка" className="w-1/3 bg-black border border-gray-600 rounded px-2 py-1 text-xs text-white"/>
                                            <input value={btnDraft.url} onChange={e => setBtnDraft({...btnDraft, url: e.target.value})} placeholder="URL" className="flex-1 bg-black border border-gray-600 rounded px-2 py-1 text-xs text-white"/>
                                            <button onClick={handleAddButton} className="bg-blue-600 px-2 rounded text-white"><Icons.Plus size={14}/></button>
                                        </div>
                                        {buttons.length > 0 && (
                                            <div className="flex flex-wrap gap-2 mt-2">
                                                {buttons.map((b, i) => (
                                                    <span key={i} className="bg-blue-900/30 border border-blue-500/30 px-2 py-0.5 rounded text-[10px] flex items-center gap-1 text-blue-200">{b.text} <button onClick={() => setButtons(buttons.filter((_, idx) => idx !== i))}><Icons.X size={10}/></button></span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                                <div className="flex gap-2 items-end">
                                    <button onClick={() => setShowTools(!showTools)} className={`p-2.5 rounded-lg transition-colors h-[42px] w-[42px] flex items-center justify-center ${showTools ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                                        <Icons.Plus size={20}/>
                                    </button>
                                    <textarea 
                                        value={msgText} 
                                        onChange={e => setMsgText(e.target.value)} 
                                        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())}
                                        placeholder="Написать пользователю от имени бота..." 
                                        className="w-full bg-black border border-gray-700 rounded-lg px-4 py-2.5 text-white outline-none focus:border-blue-500 transition-colors resize-none custom-scrollbar"
                                        style={{ minHeight: '42px', maxHeight: '120px' }}
                                    />
                                    <button onClick={handleSendMessage} className="bg-blue-600 hover:bg-blue-500 p-2.5 rounded-lg text-white transition-colors h-[42px] w-[42px] flex items-center justify-center">
                                        <Icons.Send size={20}/>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Right Panel: CRM Details */}
                        <div className="w-64 bg-gray-900/50 border-l border-gray-800 p-4 space-y-6 overflow-y-auto hidden xl:block">
                            <div>
                                <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Статистика</h3>
                                <div className="space-y-2">
                                    <div className="flex justify-between text-sm bg-black/40 p-2 rounded border border-gray-800"><span className="text-gray-400">Сообщений</span><span className="text-white font-bold">{selectedUser.msgCount}</span></div>
                                    <div className="flex justify-between text-sm bg-black/40 p-2 rounded border border-gray-800"><span className="text-gray-400">Варнов</span><span className="text-yellow-500 font-bold">{selectedUser.warnings}/3</span></div>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Управление Варнами</h3>
                                <div className="flex gap-2">
                                    <button onClick={() => handleWarn(-1)} className="flex-1 bg-gray-800 hover:bg-gray-700 py-2 rounded font-bold transition-colors text-white">-</button>
                                    <button onClick={() => handleWarn(1)} className="flex-1 bg-yellow-900/20 hover:bg-yellow-900/40 text-yellow-400 py-2 rounded font-bold border border-yellow-900/50 transition-colors">+</button>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Роль</h3>
                                <div className="grid grid-cols-2 gap-2">
                                    <button onClick={() => setUsers(prev => ({...prev, [selectedUser.id]: {...selectedUser, role: 'user'}}))} className={`py-1.5 rounded text-xs font-bold border ${selectedUser.role === 'user' ? 'bg-blue-600 text-white border-blue-500' : 'bg-transparent text-gray-500 border-gray-700'}`}>User</button>
                                    <button onClick={() => setUsers(prev => ({...prev, [selectedUser.id]: {...selectedUser, role: 'admin'}}))} className={`py-1.5 rounded text-xs font-bold border ${selectedUser.role === 'admin' ? 'bg-yellow-600 text-black border-yellow-500' : 'bg-transparent text-gray-500 border-gray-700'}`}>Admin</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-600 hidden md:flex bg-[#09090b]">
                    <div className="w-20 h-20 bg-gray-900 rounded-full flex items-center justify-center mb-4">
                        <Icons.Users size={40} className="opacity-20"/>
                    </div>
                    <p className="text-sm">Выберите пользователя для просмотра профиля и истории</p>
                </div>
            )}
        </div>
    );
};

export default UserCRM;
