import React, { useState } from 'react';
import { Icons } from './Icons';
import { Message, InlineButton, QuickReply } from '../types';

interface LiveChatProps {
    topicNames: Record<string, string>;
    topicHistory: Record<string, Message[]>;
    activeTopic: string;
    setActiveTopic: (id: string) => void;
    onRenameTopic: (id: string, newName: string) => void;
    onSendMessage: (data: { text: string; mediaUrl?: string; mediaFile?: File | null; buttons?: InlineButton[] }) => void;
    isAiThinking?: boolean;
    disabledAiTopics?: string[];
    onToggleAi?: (topicId: string) => void;
    onClearTopic?: (topicId: string) => void;
    unreadCounts?: Record<string, number>; 
    quickReplies?: QuickReply[];
    setQuickReplies?: (replies: QuickReply[]) => void;
}

const LiveChat: React.FC<LiveChatProps> = ({ 
    topicNames, 
    topicHistory, 
    activeTopic, 
    setActiveTopic, 
    onRenameTopic, 
    onSendMessage,
    isAiThinking,
    disabledAiTopics = [],
    onToggleAi,
    onClearTopic,
    unreadCounts = {},
    quickReplies = [],
    setQuickReplies
}) => {
    const [text, setText] = useState('');
    const [mediaUrl, setMediaUrl] = useState('');
    const [mediaFile, setMediaFile] = useState<File | null>(null);
    const [buttons, setButtons] = useState<InlineButton[]>([]);
    const [btnDraft, setBtnDraft] = useState({ text: '', url: '' });
    const [showTools, setShowTools] = useState(false);
    
    // Quick Replies state
    const [showQuickReplies, setShowQuickReplies] = useState(false);
    const [newQrTitle, setNewQrTitle] = useState('');
    const [newQrText, setNewQrText] = useState('');
    
    // Rename state
    const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');

    const send = () => {
        if (!text.trim() && !mediaUrl && !mediaFile) return;
        onSendMessage({
            text,
            mediaUrl,
            mediaFile,
            buttons
        });
        setText('');
        setMediaUrl('');
        setMediaFile(null);
        setButtons([]);
        setShowTools(false);
    };

    const addBtn = () => {
        if (!btnDraft.text) return;
        setButtons([...buttons, btnDraft]);
        setBtnDraft({ text: '', url: '' });
    };

    const startEditing = (id: string, currentName: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingTopicId(id);
        setEditName(currentName);
    };

    const saveEditing = (id: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        if (editName.trim()) {
            onRenameTopic(id, editName);
        }
        setEditingTopicId(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
        if (e.key === 'Enter') {
            saveEditing(id);
        }
    };
    
    const saveQuickReply = () => {
        if (!newQrTitle || !newQrText || !setQuickReplies) return;
        setQuickReplies([...quickReplies, { id: Date.now().toString(), title: newQrTitle, text: newQrText }]);
        setNewQrTitle('');
        setNewQrText('');
    };

    const deleteQuickReply = (id: string) => {
        if (setQuickReplies) setQuickReplies(quickReplies.filter(qr => qr.id !== id));
    };

    return (
        <div className="flex gap-4 h-[calc(100vh-100px)]">
            {/* Sidebar: Topics */}
            <div className="w-1/4 bg-gray-800/30 border border-gray-700 rounded-xl overflow-hidden flex flex-col">
                <div className="p-4 border-b border-gray-700 bg-gray-900/50">
                    <h3 className="font-bold text-gray-400 text-xs uppercase">Чаты / Топики</h3>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {Object.keys(topicNames).map(tid => (
                        <div 
                            key={tid} 
                            className={`group w-full flex items-center justify-between p-3 rounded-lg text-sm transition-colors cursor-pointer ${activeTopic === tid ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'hover:bg-gray-800 text-gray-300'}`} 
                            onClick={() => setActiveTopic(tid)}
                        >
                            <div className="flex-1 mr-2 flex items-center">
                                {editingTopicId === tid ? (
                                    <input 
                                        autoFocus
                                        value={editName}
                                        onChange={e => setEditName(e.target.value)}
                                        onBlur={() => saveEditing(tid)}
                                        onKeyDown={(e) => handleKeyDown(e, tid)}
                                        onClick={e => e.stopPropagation()}
                                        className="w-full bg-black border border-blue-500 rounded px-1 text-white text-sm"
                                    />
                                ) : (
                                    <span className={`truncate font-medium flex items-center gap-2 ${unreadCounts[tid] ? 'text-white' : ''}`}>
                                        {topicNames[tid] || `Topic ${tid}`}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                {/* Unread Badge */}
                                {unreadCounts[tid] > 0 && activeTopic !== tid && (
                                    <div className="bg-green-500 text-white text-[10px] font-bold px-1.5 rounded-full min-w-[16px] text-center animate-pulse">
                                        {unreadCounts[tid]}
                                    </div>
                                )}

                                {/* AI Toggle */}
                                {onToggleAi && (
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); onToggleAi(tid); }} 
                                        title={disabledAiTopics.includes(tid) ? "Включить AI" : "Отключить AI"}
                                        className={`p-1 rounded-full ${disabledAiTopics.includes(tid) ? 'text-red-500 bg-red-900/20' : 'text-green-500 bg-green-900/20'}`}
                                    >
                                        <div className="text-[9px] font-bold px-1">BOT</div>
                                    </button>
                                )}

                                {(topicHistory[tid] || []).length > 0 && <span className="text-[10px] bg-gray-700 px-1.5 py-0.5 rounded-full text-gray-300">{(topicHistory[tid] || []).length}</span>}
                                
                                <button onClick={(e) => startEditing(tid, topicNames[tid], e)} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-white p-1">
                                    <Icons.Edit2 size={12}/>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Chat Window */}
            <div className="flex-1 bg-black/40 border border-gray-700 rounded-xl flex flex-col overflow-hidden relative" style={{backgroundImage: "url('https://web.telegram.org/img/bg_dark.png')", backgroundRepeat: 'repeat'}}>
                <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-0"></div>
                <div className="p-4 border-b border-gray-700 bg-gray-900/80 backdrop-blur z-10 flex justify-between items-center">
                    <h3 className="font-bold flex items-center gap-2 text-white">
                        <Icons.Hash size={18} className="text-gray-500"/> 
                        {topicNames[activeTopic]} 
                        <span className="text-xs font-normal text-gray-500 ml-2">ID: {activeTopic}</span>
                    </h3>
                    
                    <div className="flex items-center gap-2">
                        {disabledAiTopics.includes(activeTopic) && (
                            <div className="text-xs bg-red-900/50 text-red-200 px-2 py-1 rounded border border-red-800 flex items-center gap-1">
                                <Icons.Slash size={10}/> AI Отключен
                            </div>
                        )}
                        {onClearTopic && (
                            <button 
                                onClick={() => onClearTopic(activeTopic)}
                                className="text-gray-400 hover:text-red-500 p-2 rounded-lg transition-colors bg-gray-800/50 hover:bg-gray-800 border border-gray-700"
                                title="Очистить чат (Удалить последние сообщения)"
                            >
                                <Icons.Trash2 size={16}/>
                            </button>
                        )}
                    </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-4 z-10 custom-scrollbar flex flex-col-reverse relative">
                    {isAiThinking && (
                        <div className="flex w-full justify-start msg-enter">
                             <div className="bg-gray-800 text-purple-400 rounded-2xl rounded-bl-none px-4 py-2 text-xs flex items-center gap-2 shadow-md">
                                 <div className="flex space-x-1">
                                    <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce"></div>
                                    <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                                    <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                                 </div>
                                 <span>Хеликс печатает...</span>
                             </div>
                        </div>
                    )}
                    {[...(topicHistory[activeTopic] || [])].reverse().map((msg, i) => (
                        <div key={msg.id || i} className={`flex w-full ${msg.isIncoming ? 'justify-start' : 'justify-end'} msg-enter`}>
                            <div className={`max-w-[70%] rounded-2xl px-4 py-2 relative shadow-md ${msg.isIncoming ? 'bg-gray-800 text-gray-200 rounded-bl-none' : 'bg-blue-600 text-white rounded-br-none'}`}>
                                {msg.isIncoming && <div className="text-[11px] font-bold text-blue-400 mb-0.5 cursor-pointer hover:underline" onClick={() => setText(`@${msg.user} `)}>{msg.user}</div>}
                                
                                {msg.mediaUrl ? (
                                    <div className="mb-2">
                                        {msg.type === 'video' ? (
                                            <video src={msg.mediaUrl} controls className="max-w-full rounded-lg max-h-48" />
                                        ) : (
                                            <img src={msg.mediaUrl} alt="media" className="max-w-full rounded-lg max-h-48 object-cover" />
                                        )}
                                    </div>
                                ) : (
                                    <>
                                        {msg.type === 'photo' && <div className="mb-2 text-xs bg-white/10 p-2 rounded flex items-center gap-2"><Icons.Sticker size={16}/> [Фото]</div>}
                                        {msg.type === 'sticker' && <div className="mb-2 text-xs bg-white/10 p-2 rounded flex items-center gap-2"><Icons.Sticker size={16}/> [Стикер]</div>}
                                        {msg.type === 'voice' && <div className="mb-2 text-xs bg-white/10 p-2 rounded flex items-center gap-2"><Icons.Mic size={16}/> [Голосовое сообщение]</div>}
                                        {msg.type === 'video' && <div className="mb-2 text-xs bg-white/10 p-2 rounded flex items-center gap-2"><Icons.Video size={16}/> [Видео]</div>}
                                        {msg.type === 'video_note' && <div className="mb-2 text-xs bg-white/10 p-2 rounded flex items-center gap-2"><Icons.Video size={16}/> [Видеосообщение]</div>}
                                    </>
                                )}
                                
                                {msg.text && <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.text}</div>}
                                
                                {msg.buttons && msg.buttons.length > 0 && (
                                    <div className="mt-2 pt-2 border-t border-white/10 flex flex-wrap gap-2">
                                        {msg.buttons.map((b, bi) => (
                                            <div key={bi} className="bg-black/20 px-2 py-1 rounded text-xs border border-white/10">{b.text}</div>
                                        ))}
                                    </div>
                                )}
                                <div className="text-[10px] opacity-60 text-right mt-1">{msg.time}</div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Input Area */}
                <div className="p-3 bg-gray-900/90 border-t border-gray-700 z-10 relative">
                    {/* Quick Replies Popover */}
                    {showQuickReplies && setQuickReplies && (
                        <div className="absolute bottom-full left-3 mb-2 w-72 bg-gray-800 border border-gray-600 rounded-xl shadow-2xl p-3 z-50 animate-slideIn">
                            <div className="flex justify-between items-center mb-3">
                                <h4 className="text-xs font-bold text-gray-300 uppercase">Быстрые ответы</h4>
                                <button onClick={() => setShowQuickReplies(false)}><Icons.X size={14} className="text-gray-500 hover:text-white"/></button>
                            </div>
                            <div className="space-y-2 mb-3 max-h-48 overflow-y-auto custom-scrollbar">
                                {quickReplies.length === 0 ? <p className="text-xs text-gray-500 text-center py-2">Нет шаблонов</p> : 
                                quickReplies.map(qr => (
                                    <div key={qr.id} className="group bg-gray-900 p-2 rounded border border-gray-700 hover:border-blue-500 cursor-pointer flex justify-between items-start" onClick={() => { setText(qr.text); setShowQuickReplies(false); }}>
                                        <div>
                                            <div className="text-xs font-bold text-blue-300 mb-0.5">{qr.title}</div>
                                            <div className="text-[10px] text-gray-400 truncate w-48">{qr.text}</div>
                                        </div>
                                        <button onClick={(e) => { e.stopPropagation(); deleteQuickReply(qr.id); }} className="text-gray-600 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100"><Icons.Trash2 size={12}/></button>
                                    </div>
                                ))}
                            </div>
                            <div className="pt-2 border-t border-gray-700">
                                <input value={newQrTitle} onChange={e => setNewQrTitle(e.target.value)} placeholder="Название (напр. Приветствие)" className="w-full bg-black border border-gray-600 rounded px-2 py-1 text-xs text-white mb-2"/>
                                <textarea value={newQrText} onChange={e => setNewQrText(e.target.value)} placeholder="Текст шаблона..." className="w-full bg-black border border-gray-600 rounded px-2 py-1 text-xs text-white mb-2 resize-none h-16"/>
                                <button onClick={saveQuickReply} className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-1.5 rounded">Сохранить шаблон</button>
                            </div>
                        </div>
                    )}

                    {/* Media/Button Tools Panel */}
                    {showTools && (
                        <div className="mb-3 p-3 bg-gray-800 rounded-lg border border-gray-700 animate-slideIn">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] uppercase text-gray-500 font-bold mb-1 block">Медиа</label>
                                    <div className="flex gap-2">
                                        <input value={mediaUrl} onChange={e => setMediaUrl(e.target.value)} placeholder="URL..." className="flex-1 bg-black border border-gray-600 rounded px-2 py-1 text-xs text-white"/>
                                        <label className="bg-gray-700 hover:bg-gray-600 px-2 rounded flex items-center justify-center cursor-pointer border border-gray-600">
                                            <Icons.Upload size={14}/>
                                            <input type="file" onChange={e => setMediaFile(e.target.files ? e.target.files[0] : null)} className="hidden"/>
                                        </label>
                                    </div>
                                    {mediaFile && <div className="text-[10px] text-green-400 mt-1 truncate">{mediaFile.name}</div>}
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase text-gray-500 font-bold mb-1 block">Кнопки</label>
                                    <div className="flex gap-2 mb-1">
                                        <input value={btnDraft.text} onChange={e => setBtnDraft({...btnDraft, text: e.target.value})} placeholder="Txt" className="w-1/3 bg-black border border-gray-600 rounded px-2 py-1 text-xs text-white"/>
                                        <input value={btnDraft.url} onChange={e => setBtnDraft({...btnDraft, url: e.target.value})} placeholder="Url" className="flex-1 bg-black border border-gray-600 rounded px-2 py-1 text-xs text-white"/>
                                        <button onClick={addBtn} className="bg-gray-700 px-2 rounded hover:bg-gray-600"><Icons.Plus size={14}/></button>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        {buttons.map((b, i) => (
                                            <span key={i} className="text-[9px] bg-blue-900/50 text-blue-200 px-1 rounded border border-blue-800">{b.text}</span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex gap-2 items-end">
                        <button onClick={() => setShowQuickReplies(!showQuickReplies)} className={`p-2.5 rounded-lg transition-colors ${showQuickReplies ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`} title="Быстрые ответы">
                             <Icons.Zap size={20}/>
                        </button>
                        <button onClick={() => setShowTools(!showTools)} className={`p-2.5 rounded-lg transition-colors ${showTools ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                            <Icons.Plus size={20}/>
                        </button>
                        <div className="flex-1 relative">
                            <textarea 
                                value={text} 
                                onChange={e => setText(e.target.value)} 
                                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
                                placeholder={`Написать в ${topicNames[activeTopic]}...`} 
                                className="w-full bg-black border border-gray-700 rounded-lg px-4 py-2.5 text-white outline-none focus:border-blue-500 transition-colors resize-none custom-scrollbar"
                                style={{ minHeight: '42px', maxHeight: '120px' }}
                            />
                        </div>
                        <button onClick={send} className="bg-blue-600 hover:bg-blue-500 p-2.5 rounded-lg text-white transition-colors h-[42px] w-[42px] flex items-center justify-center">
                            <Icons.Send size={20}/>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LiveChat;