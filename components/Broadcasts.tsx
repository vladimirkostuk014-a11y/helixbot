
import React, { useState } from 'react';
import { Icons } from './Icons';
import { User, BotConfig, InlineButton, Message } from '../types';
import { apiCall } from '../services/api';
import { saveData } from '../services/firebase';

interface BroadcastsProps {
    users: Record<string, User>;
    config: BotConfig;
    addLog?: (action: string, details: string, type?: 'info' | 'warning' | 'danger' | 'success') => void;
    onBroadcastSent?: (userId: number | string, text: string, type: 'text'|'photo'|'video', mediaUrl?: string) => void;
}

const Broadcasts: React.FC<BroadcastsProps> = ({ users, config, addLog, onBroadcastSent }) => {
    const [text, setText] = useState('');
    const [mediaFile, setMediaFile] = useState<File | null>(null);
    const [buttons, setButtons] = useState<InlineButton[]>([]);
    const [btnDraft, setBtnDraft] = useState({ text: '', url: '' });
    
    // Audience Selection
    const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set());
    const [isSending, setIsSending] = useState(false);
    const [progress, setProgress] = useState({ sent: 0, total: 0, failed: 0 });
    const [logs, setLogs] = useState<string[]>([]);
    const [filterSearch, setFilterSearch] = useState('');

    const handleAddButton = () => {
        if (!btnDraft.text) return;
        setButtons([...buttons, btnDraft]);
        setBtnDraft({ text: '', url: '' });
    };

    const toggleExclude = (id: number) => {
        const newSet = new Set(excludedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setExcludedIds(newSet);
    };

    // Filter valid users (not banned) AND SORT: Admins first, then Alphabetical
    const validUsers = (Object.values(users) as User[])
        .filter(u => u.status !== 'banned')
        .sort((a, b) => {
            // 1. Admins First
            if (a.role === 'admin' && b.role !== 'admin') return -1;
            if (a.role !== 'admin' && b.role === 'admin') return 1;
            // 2. Then Alphabetical by Name
            return a.name.localeCompare(b.name);
        });

    // Displayed users (filtered by search)
    const displayedUsers = validUsers.filter(u => 
        u.name.toLowerCase().includes(filterSearch.toLowerCase()) || 
        String(u.id).includes(filterSearch) ||
        (u.username && u.username.toLowerCase().includes(filterSearch.toLowerCase()))
    );

    // Target users for broadcast (not excluded)
    const targetUsers = validUsers.filter(u => !excludedIds.has(u.id));

    const startBroadcast = async () => {
        if (targetUsers.length === 0) { alert('Нет получателей'); return; }
        if (!text && !mediaFile) { alert('Добавьте текст или медиа'); return; }
        
        setIsSending(true);
        setLogs([]);
        setProgress({ sent: 0, total: targetUsers.length, failed: 0 });
        if (addLog) addLog('Рассылка', `Старт рассылки (${targetUsers.length} получателей)`, 'warning');

        // Prepare Markup Correctly
        const markup = buttons.length > 0 ? JSON.stringify({ 
            inline_keyboard: buttons.map(b => {
                let url = b.url;
                if (url && !url.startsWith('http')) url = `https://${url}`;
                return [ url ? { text: b.text, url } : { text: b.text, callback_data: 'cb' } ];
            }) 
        }) : undefined;
        
        // Prepare preview URL for CRM (local only)
        const previewUrl = mediaFile ? URL.createObjectURL(mediaFile) : undefined;
        const msgType = mediaFile ? (mediaFile.type.startsWith('video') ? 'video' : 'photo') : 'text';

        for (const user of targetUsers) {
            try {
                let res;
                if (mediaFile) {
                    const fd = new FormData();
                    fd.append('chat_id', String(user.id));
                    const method = mediaFile.type.startsWith('video') ? 'sendVideo' : 'sendPhoto';
                    fd.append(method === 'sendVideo' ? 'video' : 'photo', mediaFile);
                    if (text) fd.append('caption', text);
                    if (markup) fd.append('reply_markup', markup);
                    res = await apiCall(method, fd, config, true);
                } else {
                    res = await apiCall('sendMessage', { 
                        chat_id: user.id, 
                        text, 
                        reply_markup: markup ? JSON.parse(markup) : undefined 
                    }, config);
                }

                if (res.ok) {
                    setProgress(p => ({ ...p, sent: p.sent + 1 }));
                    
                    // --- SYNC WITH CRM HISTORY ---
                    const newMsg: Message = {
                        dir: 'out',
                        text: text,
                        type: msgType,
                        mediaUrl: previewUrl,
                        buttons: buttons,
                        time: new Date().toLocaleTimeString('ru-RU'),
                        timestamp: Date.now(),
                        isGroup: false,
                        user: 'Admin (Рассылка)'
                    };
                    
                    const currentHistory = user.history || [];
                    const updatedHistory = [...currentHistory, newMsg].slice(-50);
                    saveData(`users/${user.id}/history`, updatedHistory);

                    if (onBroadcastSent) {
                        onBroadcastSent(user.id, text, msgType, previewUrl);
                    }
                } else {
                    setProgress(p => ({ ...p, failed: p.failed + 1 }));
                    setLogs(l => [`Err ${user.name}: ${res.description}`, ...l]);
                }
            } catch (e: any) {
                setProgress(p => ({ ...p, failed: p.failed + 1 }));
            }
            await new Promise(r => setTimeout(r, 50)); 
        }
        setIsSending(false);
    };

    return (
        <div className="flex flex-col lg:flex-row h-full gap-6">
            {/* Left: Builder */}
            <div className="w-full lg:w-1/2 flex flex-col bg-[#121214] border border-gray-800 rounded-2xl overflow-hidden shadow-xl">
                <div className="p-5 border-b border-gray-800 bg-gradient-to-r from-gray-900 to-gray-800">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2"><Icons.Edit2 size={18} className="text-blue-500"/> Конструктор сообщения</h2>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    {/* Media Upload */}
                    <div className="group relative border-2 border-dashed border-gray-700 hover:border-blue-500 rounded-xl transition-colors bg-black/20 h-40 flex items-center justify-center cursor-pointer">
                        <input type="file" onChange={e => setMediaFile(e.target.files ? e.target.files[0] : null)} className="absolute inset-0 opacity-0 cursor-pointer z-10"/>
                        {mediaFile ? (
                            <div className="text-center">
                                <div className="text-green-400 font-bold mb-1 flex items-center justify-center gap-2"><Icons.Check size={20}/> Файл выбран</div>
                                <div className="text-xs text-gray-500">{mediaFile.name}</div>
                                <button onClick={(e) => {e.stopPropagation(); setMediaFile(null);}} className="mt-2 text-red-400 text-xs hover:underline z-20 relative">Удалить</button>
                            </div>
                        ) : (
                            <div className="text-center text-gray-500 group-hover:text-blue-400">
                                <Icons.Upload size={32} className="mx-auto mb-2"/>
                                <span className="text-sm font-bold">Нажмите для загрузки фото/видео</span>
                            </div>
                        )}
                    </div>

                    {/* Text Area */}
                    <div>
                        <textarea 
                            value={text} 
                            onChange={e => setText(e.target.value)} 
                            placeholder="Введите текст рассылки..." 
                            className="w-full bg-black border border-gray-700 rounded-xl p-4 text-white min-h-[150px] outline-none focus:border-blue-500 transition-colors resize-none text-sm leading-relaxed"
                        />
                    </div>

                    {/* Buttons */}
                    <div className="bg-black/30 p-4 rounded-xl border border-gray-800">
                        <label className="text-xs text-gray-500 uppercase font-bold mb-3 block">Кнопки (Ссылки)</label>
                        <div className="flex gap-2 mb-3">
                            <input value={btnDraft.text} onChange={e => setBtnDraft({...btnDraft, text: e.target.value})} placeholder="Текст" className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"/>
                            <input value={btnDraft.url} onChange={e => setBtnDraft({...btnDraft, url: e.target.value})} placeholder="URL" className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"/>
                            <button onClick={handleAddButton} className="bg-gray-800 hover:bg-gray-700 text-white px-3 rounded-lg"><Icons.Plus/></button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {buttons.map((b, i) => (
                                <span key={i} className="bg-blue-900/30 border border-blue-500/30 text-blue-200 px-3 py-1.5 rounded-lg text-sm flex items-center gap-2">
                                    {b.text} <button onClick={() => setButtons(buttons.filter((_, idx) => idx !== i))} className="hover:text-white"><Icons.X size={12}/></button>
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Right: Settings & Preview */}
            <div className="w-full lg:w-1/2 flex flex-col gap-6">
                {/* Audience List */}
                <div className="bg-[#121214] border border-gray-800 rounded-2xl flex flex-col flex-1 shadow-xl overflow-hidden min-h-[300px]">
                    <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
                        <h3 className="text-sm font-bold text-gray-400 uppercase flex items-center gap-2"><Icons.Users size={16}/> Получатели ({targetUsers.length})</h3>
                        <div className="flex gap-2 text-xs">
                             <button onClick={() => setExcludedIds(new Set())} className="text-blue-400 hover:underline">Выбрать всех</button>
                             <button onClick={() => {
                                 const all = new Set(validUsers.map(u => u.id));
                                 setExcludedIds(all);
                             }} className="text-gray-500 hover:underline">Снять всех</button>
                        </div>
                    </div>
                    
                    <div className="p-3 border-b border-gray-800">
                        <input value={filterSearch} onChange={e => setFilterSearch(e.target.value)} placeholder="Поиск пользователя..." className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none"/>
                    </div>

                    <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                        {displayedUsers.map(u => {
                            const isChecked = !excludedIds.has(u.id);
                            return (
                                <div key={u.id} onClick={() => toggleExclude(u.id)} className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${isChecked ? 'bg-blue-900/20 hover:bg-blue-900/30' : 'bg-gray-900/50 hover:bg-gray-800'}`}>
                                    <div className="flex items-center gap-3">
                                        <div className={`w-4 h-4 rounded border flex items-center justify-center ${isChecked ? 'bg-blue-600 border-blue-600' : 'border-gray-600'}`}>
                                            {isChecked && <Icons.Check size={10} className="text-white"/>}
                                        </div>
                                        <div>
                                            <div className="text-sm text-white font-medium">{u.name}</div>
                                            <div className="text-xs text-gray-500">@{u.username || '---'} • ID: {u.id}</div>
                                        </div>
                                    </div>
                                    {u.role === 'admin' && <Icons.Shield size={12} className="text-yellow-500"/>}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Send / Progress */}
                {isSending || progress.total > 0 ? (
                    <div className="h-48 bg-[#121214] border border-gray-800 rounded-2xl p-6 shadow-xl flex flex-col">
                        <h3 className="text-sm font-bold text-gray-400 uppercase mb-4">Статус выполнения</h3>
                        <div className="mb-4">
                            <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                                <div className="h-full bg-green-500 transition-all duration-300" style={{width: `${(progress.sent + progress.failed) / progress.total * 100}%`}}></div>
                            </div>
                            <div className="flex justify-between text-xs mt-2 font-mono">
                                <span className="text-green-400">OK: {progress.sent}</span>
                                <span className="text-red-400">ERR: {progress.failed}</span>
                            </div>
                        </div>
                        <div className="flex-1 bg-black/50 rounded-xl p-3 overflow-y-auto custom-scrollbar font-mono text-xs text-gray-500">
                            {logs.map((l, i) => <div key={i} className="mb-1 border-b border-gray-800/50 pb-1">{l}</div>)}
                        </div>
                    </div>
                ) : (
                    <button 
                        disabled={targetUsers.length === 0}
                        onClick={startBroadcast}
                        className={`w-full py-4 rounded-2xl font-bold text-lg shadow-xl transition-all flex items-center justify-center gap-3 h-20 ${targetUsers.length === 0 ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white hover:scale-[1.02]'}`}
                    >
                        <Icons.Send size={22}/> Запустить рассылку
                    </button>
                )}
            </div>
        </div>
    );
};

export default Broadcasts;
