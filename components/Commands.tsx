
import React, { useState } from 'react';
import { Icons } from './Icons';
import { Command, InlineButton } from '../types';
import { saveData } from '../services/firebase';

interface CommandsProps {
    commands: Command[];
    setCommands: (cmds: Command[]) => void;
    topicNames?: Record<string, string>;
}

const COLORS = [
    { bg: 'bg-gray-800/30', border: 'border-gray-700/50', name: 'Default' },
    { bg: 'bg-blue-900/20', border: 'border-blue-500/50', name: 'Blue' },
    { bg: 'bg-red-900/20', border: 'border-red-500/50', name: 'Red' },
    { bg: 'bg-green-900/20', border: 'border-green-500/50', name: 'Green' },
    { bg: 'bg-yellow-900/20', border: 'border-yellow-500/50', name: 'Yellow' },
    { bg: 'bg-purple-900/20', border: 'border-purple-500/50', name: 'Purple' },
];

const Commands: React.FC<CommandsProps> = ({ commands, setCommands, topicNames = {} }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [currentCmd, setCurrentCmd] = useState<Partial<Command>>({});
    const [buttonDraft, setButtonDraft] = useState<InlineButton>({ text: '', url: '' });
    const [collapsed, setCollapsed] = useState({ system: true, custom: true });
    
    // Media Upload State for Commands
    const [previewMedia, setPreviewMedia] = useState<string | null>(null);

    const handleSave = () => {
        if (!currentCmd.trigger) return;
        const newCmd: Command = {
            id: currentCmd.id || Math.random().toString(36).substr(2, 9),
            trigger: currentCmd.trigger,
            matchType: currentCmd.matchType || 'exact',
            type: currentCmd.mediaUrl ? 'photo' : 'text',
            response: currentCmd.response || '',
            mediaUrl: currentCmd.mediaUrl || '',
            buttons: currentCmd.buttons || [],
            isSystem: currentCmd.isSystem || false,
            muteDuration: currentCmd.muteDuration, 
            allowedTopicId: currentCmd.allowedTopicId || undefined,
            notificationTopicId: currentCmd.notificationTopicId || undefined,
            allowedRoles: currentCmd.allowedRoles || ['user', 'admin'],
            color: currentCmd.color 
        };

        let newCommands;
        if (currentCmd.id) {
            newCommands = commands.map(c => c.id === currentCmd.id ? newCmd : c);
        } else {
            newCommands = [...commands, newCmd];
        }
        setCommands(newCommands);
        saveData('commands', newCommands); // Explicit Save
        setIsEditing(false);
        setPreviewMedia(null);
    };

    const handleDelete = (id: string | number) => {
        const newCommands = commands.filter(c => c.id !== id);
        setCommands(newCommands);
        saveData('commands', newCommands); // Explicit Save
        setIsEditing(false);
    };
    
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const res = reader.result as string;
                setCurrentCmd(prev => ({ ...prev, mediaUrl: res }));
                setPreviewMedia(res);
            };
            reader.readAsDataURL(file);
        }
    };
    
    const handleAddButton = () => {
        if (buttonDraft.text) {
             setCurrentCmd(prev => ({ ...prev, buttons: [...(prev.buttons || []), buttonDraft] }));
             setButtonDraft({ text: '', url: '' });
        }
    };

    const toggleRole = (role: 'user' | 'admin') => {
        const currentRoles = currentCmd.allowedRoles || ['user', 'admin'];
        if (currentRoles.includes(role)) {
            setCurrentCmd({ ...currentCmd, allowedRoles: currentRoles.filter(r => r !== role) as any });
        } else {
            setCurrentCmd({ ...currentCmd, allowedRoles: [...currentRoles, role] as any });
        }
    };

    const systemCmds = commands
        .filter(c => c.isSystem)
        .sort((a, b) => (a.color || 'Default').localeCompare(b.color || 'Default'));
        
    const customCmds = commands.filter(c => !c.isSystem);

    const getCmdStyle = (colorName?: string) => {
        const theme = COLORS.find(c => c.name === colorName) || COLORS[0];
        return `${theme.bg} ${theme.border}`;
    };
    
    const isWelcomeOrTop = currentCmd.trigger === '_welcome_' || currentCmd.trigger === '_daily_top_';

    return (
        <div className="flex flex-col lg:flex-row gap-6 h-full">
            <div className="w-full lg:w-1/3 bg-gray-800/30 border border-gray-700 rounded-xl overflow-hidden flex flex-col h-[300px] lg:h-full">
                <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900/50">
                    <span className="font-medium text-white flex items-center gap-2"><Icons.Terminal size={18}/> Команды</span>
                    <button onClick={() => { setIsEditing(true); setCurrentCmd({ trigger: '/', matchType: 'exact', buttons: [], allowedRoles: ['user', 'admin'] }); setPreviewMedia(null); }} className="p-1.5 text-gray-400 hover:text-white bg-gray-800 rounded-md"><Icons.Plus size={18}/></button>
                </div>
                <div className="overflow-y-auto p-2 custom-scrollbar space-y-2">
                    {/* Groups */}
                    {[{ title: 'Системные', list: systemCmds, open: collapsed.system, toggle: () => setCollapsed(p => ({...p, system: !p.system})) }, 
                      { title: 'Пользовательские', list: customCmds, open: collapsed.custom, toggle: () => setCollapsed(p => ({...p, custom: !p.custom})) }]
                    .map((grp, i) => (
                        <div key={i}>
                            <div onClick={grp.toggle} className="flex justify-between items-center px-3 py-2 bg-gray-900/50 rounded cursor-pointer hover:bg-gray-800">
                                <span className="font-bold text-gray-400 text-xs uppercase flex items-center gap-2">
                                    {grp.open ? <Icons.ChevronRight size={12}/> : <Icons.ChevronDown size={12}/>} {grp.title} ({grp.list.length})
                                </span>
                            </div>
                            {!grp.open && (
                                <div className="mt-1 space-y-1 pl-2">
                                    {grp.list.map(cmd => (
                                        <div key={cmd.id} onClick={() => { setCurrentCmd(cmd); setPreviewMedia(cmd.mediaUrl || null); setIsEditing(true); }} className={`p-3 rounded cursor-pointer border transition-colors ${getCmdStyle(cmd.color)} ${currentCmd.id === cmd.id ? 'ring-1 ring-white' : 'hover:brightness-110'}`}>
                                            <div className="flex justify-between items-center">
                                                <span className={`font-bold ${cmd.isSystem ? 'text-yellow-400' : 'text-blue-400'}`}>{cmd.trigger}</span>
                                                {cmd.mediaUrl && <Icons.Upload size={12} className="text-gray-400"/>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                    
                    {/* Hardcoded Special Commands Add Buttons if missing */}
                    {!commands.find(c => c.trigger === '_welcome_') && (
                        <button onClick={() => { setCurrentCmd({ trigger: '_welcome_', isSystem: true, response: 'Привет, {user}!', buttons: [], matchType: 'exact', color: 'Green' }); setIsEditing(true); }} className="w-full py-2 bg-green-900/20 text-green-400 border border-green-500/30 rounded text-xs font-bold">+ Добавить Приветствие (_welcome_)</button>
                    )}
                    {!commands.find(c => c.trigger === '_daily_top_') && (
                        <button onClick={() => { setCurrentCmd({ trigger: '_daily_top_', isSystem: true, response: '🏆 Топ за день:', buttons: [], matchType: 'exact', color: 'Gold' }); setIsEditing(true); }} className="w-full py-2 bg-yellow-900/20 text-yellow-400 border border-yellow-500/30 rounded text-xs font-bold">+ Добавить Топ Дня (_daily_top_)</button>
                    )}
                </div>
            </div>
            
            <div className="w-full lg:w-2/3 bg-gray-800/30 border border-gray-700 rounded-xl p-6 overflow-y-auto custom-scrollbar">
                {isEditing ? (
                    <div className="space-y-5">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            {currentCmd.id ? 'Настройка команды' : 'Создание команды'}
                            {currentCmd.isSystem && <span className="text-xs bg-yellow-600 px-2 py-0.5 rounded text-black font-bold">SYSTEM</span>}
                        </h3>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs text-gray-500 uppercase font-bold block mb-1">Триггер</label>
                                <input disabled={currentCmd.isSystem} value={currentCmd.trigger} onChange={e => setCurrentCmd({...currentCmd, trigger: e.target.value})} className={`w-full bg-gray-900 border border-gray-600 rounded p-2.5 text-white ${currentCmd.isSystem ? 'opacity-50 cursor-not-allowed' : ''}`} placeholder="/start"/>
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 uppercase font-bold block mb-1">
                                    {currentCmd.isSystem ? 'Куда писать отчет' : 'Где работает'}
                                </label>
                                <select 
                                    value={currentCmd.isSystem ? (currentCmd.notificationTopicId || '') : (currentCmd.allowedTopicId || '')} 
                                    onChange={e => {
                                        const val = e.target.value || undefined;
                                        if (currentCmd.isSystem) setCurrentCmd({...currentCmd, notificationTopicId: val});
                                        else setCurrentCmd({...currentCmd, allowedTopicId: val});
                                    }} 
                                    className="w-full bg-gray-900 border border-gray-600 rounded p-2.5 text-white outline-none"
                                >
                                    <option value="">{currentCmd.isSystem ? 'В тот же чат' : 'Везде (Все чаты)'}</option>
                                    {!currentCmd.isSystem && <option value="private_only">Только ЛС</option>}
                                    {Object.entries(topicNames).map(([id, name]) => (
                                        <option key={id} value={id}>{name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        
                        {currentCmd.trigger === '/mute' && (
                             <div className="bg-yellow-900/20 p-4 rounded-xl border border-yellow-700/50">
                                <label className="text-xs text-yellow-500 uppercase font-bold block mb-1">Длительность мута (минуты)</label>
                                <input 
                                    type="number"
                                    value={currentCmd.muteDuration || 60} 
                                    onChange={e => setCurrentCmd({...currentCmd, muteDuration: parseInt(e.target.value)})} 
                                    className="w-full bg-black border border-yellow-700/50 rounded p-2.5 text-white outline-none focus:border-yellow-500"
                                    placeholder="60"
                                />
                             </div>
                        )}
                        
                        {/* Media Upload Section */}
                        <div className="bg-gray-900/50 p-4 rounded-xl border border-gray-700">
                             <label className="text-xs text-gray-500 uppercase font-bold block mb-2">Медиа (Фото/Видео)</label>
                             <div className="flex gap-4 items-center">
                                 <label className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded cursor-pointer border border-gray-600 transition-colors">
                                     <Icons.Upload size={16}/>
                                     <span className="text-xs font-bold text-gray-300">Загрузить файл</span>
                                     <input type="file" onChange={handleFileUpload} className="hidden"/>
                                 </label>
                                 {(currentCmd.mediaUrl || previewMedia) && (
                                     <div className="relative group w-20 h-20 bg-black rounded border border-gray-600 overflow-hidden">
                                         <img src={previewMedia || currentCmd.mediaUrl} alt="Preview" className="w-full h-full object-cover"/>
                                         <button onClick={() => { setCurrentCmd({...currentCmd, mediaUrl: ''}); setPreviewMedia(null); }} className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 text-red-400"><Icons.Trash2 size={20}/></button>
                                     </div>
                                 )}
                             </div>
                        </div>

                        {/* Inline Buttons Section */}
                        <div className="bg-gray-900/50 p-4 rounded-xl border border-gray-700">
                            <label className="text-xs text-gray-500 uppercase font-bold block mb-2">Кнопки (Ссылки)</label>
                            <div className="flex gap-2 mb-2">
                                <input value={buttonDraft.text} onChange={e => setButtonDraft({...buttonDraft, text: e.target.value})} placeholder="Текст" className="w-1/3 bg-black border border-gray-600 rounded px-2 py-1 text-xs text-white"/>
                                <input value={buttonDraft.url} onChange={e => setButtonDraft({...buttonDraft, url: e.target.value})} placeholder="URL" className="flex-1 bg-black border border-gray-600 rounded px-2 py-1 text-xs text-white"/>
                                <button onClick={handleAddButton} className="bg-gray-800 px-2 rounded hover:bg-gray-700"><Icons.Plus size={14}/></button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {currentCmd.buttons?.map((b, i) => (
                                    <span key={i} className="bg-blue-900/30 border border-blue-500/30 text-blue-200 px-2 py-1 rounded text-xs flex items-center gap-2">
                                        {b.text} <button onClick={() => setCurrentCmd(prev => ({...prev, buttons: prev.buttons?.filter((_, idx) => idx !== i)}))} className="hover:text-white"><Icons.X size={10}/></button>
                                    </span>
                                ))}
                            </div>
                        </div>

                        {!isWelcomeOrTop && (
                            <div className="bg-gray-900/50 p-4 rounded-xl border border-gray-700">
                                <label className="text-xs text-gray-500 uppercase font-bold block mb-2">Кто может использовать</label>
                                <div className="flex gap-4">
                                    {['user', 'admin'].map((role) => (
                                        <label key={role} className="flex items-center gap-2 cursor-pointer select-none">
                                            <input 
                                                type="checkbox" 
                                                checked={(currentCmd.allowedRoles || ['user', 'admin']).includes(role as any)} 
                                                onChange={() => toggleRole(role as any)}
                                                className="accent-blue-500 w-4 h-4"
                                            />
                                            <span className={`text-sm capitalize ${role === 'admin' ? 'text-yellow-400' : 'text-gray-300'}`}>
                                                {role === 'user' ? 'Все (User)' : 'Админы'}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        {!isWelcomeOrTop && (
                            <div className="bg-gray-900/50 p-4 rounded-xl border border-gray-700">
                                <label className="text-xs text-gray-500 uppercase font-bold block mb-2">Цвет карточки (для админа)</label>
                                <div className="flex gap-3">
                                    {COLORS.map(c => (
                                        <button 
                                            key={c.name}
                                            onClick={() => setCurrentCmd({...currentCmd, color: c.name})}
                                            className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${c.bg.replace('/20', '')} ${currentCmd.color === c.name ? 'ring-2 ring-white scale-110' : 'border-transparent'}`}
                                            title={c.name}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="text-xs text-gray-500 uppercase font-bold block mb-1">Ответ бота</label>
                            <textarea rows={4} value={currentCmd.response} onChange={e => setCurrentCmd({...currentCmd, response: e.target.value})} className="w-full bg-gray-900 border border-gray-600 rounded-xl p-3 text-white font-mono text-sm" placeholder="Текст ответа... (поддерживает {user})" />
                        </div>
                        
                        <div className="flex justify-end gap-3 pt-4">
                            {currentCmd.id && !currentCmd.isSystem && <button onClick={() => handleDelete(currentCmd.id!)} className="text-red-400 px-4 py-2 hover:bg-red-900/20 rounded font-bold">Удалить</button>}
                            <button onClick={handleSave} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 px-8 py-2.5 rounded-xl text-white font-bold shadow-lg shadow-blue-900/20">Сохранить</button>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-full text-gray-500 bg-gray-900/10 rounded-xl border border-dashed border-gray-700 min-h-[300px]">
                        <div className="text-center">
                            <Icons.Terminal size={48} className="mx-auto mb-3 opacity-30"/>
                            <p>Выберите команду для настройки</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Commands;
