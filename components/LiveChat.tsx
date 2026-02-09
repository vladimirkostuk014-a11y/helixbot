
import React, { useState, useEffect, useRef } from 'react';
import { Icons } from './Icons';
import { Message, InlineButton, QuickReply } from '../types';
import { saveData } from '../services/firebase';

interface LiveChatProps {
    topicNames: Record<string, string>;
    topicHistory: Record<string, Message[]>;
    activeTopic: string;
    setActiveTopic: (id: string) => void;
    onRenameTopic: (id: string, newName: string) => void;
    onSendMessage: (data: { text: string; mediaUrl?: string; mediaFile?: File | null; buttons?: InlineButton[]; topicId: string }) => void;
    isAiThinking?: boolean;
    disabledAiTopics?: string[];
    onToggleAi?: (topicId: string) => void;
    onClearTopic?: (topicId: string) => void;
    unreadCounts?: Record<string, number>; 
    quickReplies?: QuickReply[];
    setQuickReplies?: (replies: QuickReply[]) => void;
    onAddTopic?: (id: string, name: string) => void;
    onDeleteTopic?: (id: string) => void;
    onMarkTopicRead?: (id: string) => void;
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
    setQuickReplies,
    onAddTopic,
    onDeleteTopic,
    onMarkTopicRead
}) => {
    const [text, setText] = useState('');
    const [mediaFile, setMediaFile] = useState<File | null>(null);
    const [buttons, setButtons] = useState<InlineButton[]>([]);
    const [btnDraft, setBtnDraft] = useState({ text: '', url: '' });
    const [showTools, setShowTools] = useState(false);
    const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [showAddTopic, setShowAddTopic] = useState(false);
    const [newTopicLink, setNewTopicLink] = useState('');
    
    // Check if on mobile to toggle views
    const isMobile = window.innerWidth < 768;
    
    // Audio Notification
    const prevUnreadCountRef = useRef(0);
    useEffect(() => {
        // Explicitly cast to number[] to avoid 'unknown' addition issues
        const totalUnread = (Object.values(unreadCounts) as number[]).reduce((a: number, b: number) => a + b, 0);
        if (totalUnread > prevUnreadCountRef.current) {
            // Play Sound
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'); // Simple Ding
            audio.volume = 0.5;
            audio.play().catch(e => console.log("Audio play blocked", e));
        }
        prevUnreadCountRef.current = totalUnread;
    }, [unreadCounts]);

    const send = () => {
        if (!text.trim() && !mediaFile) return;
        onSendMessage({
            text,
            mediaFile,
            buttons,
            topicId: activeTopic
        });
        setText('');
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
    
    const handleTopicClick = (tid: string) => {
        setActiveTopic(tid);
        if (onMarkTopicRead) {
            onMarkTopicRead(tid);
        }
    };
    
    // Back button for mobile
    const handleBackToTopics = () => {
        setActiveTopic(''); // Clear active topic to show list again on mobile
    };

    const handleDeleteTopicClick = (tid: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (window.confirm('Удалить тему из списка? История сообщений будет скрыта.')) {
            if (onDeleteTopic) onDeleteTopic(tid);
        }
    };

    const handleAddTopicSubmit = () => {
        if (!newTopicLink.trim()) return;
        let id = newTopicLink.trim();
        if (id.includes('t.me/c/')) {
            const parts = id.split('/');
            const lastPart = parts[parts.length - 1];
            if (!isNaN(Number(lastPart))) {
                id = lastPart;
            }
        } else if (id.includes('/')) {
             const parts = id.split('/');
             const lastPart = parts[parts.length - 1];
             if (!isNaN(Number(lastPart))) id = lastPart;
        }

        if (id && onAddTopic) {
            onAddTopic(id, `Topic ${id}`);
            setActiveTopic(id);
            setNewTopicLink('');
            setShowAddTopic(false);
        }
    };

    const sortedTopics = Object.keys(topicNames).sort((a, b) => {
        if (a === 'general') return -1;
        if (b === 'general') return 1;
        const histA = topicHistory[a] || [];
        const histB = topicHistory[b] || [];
        const timeA = histA.length > 0 ? (histA[histA.length-1].timestamp || 0) : 0;
        const timeB = histB.length > 0 ? (histB[histB.length-1].timestamp || 0) : 0;
        const unreadA = unreadCounts[a] || 0;
        const unreadB = unreadCounts[b] || 0;
        if (unreadA !== unreadB) return unreadB - unreadA;
        return timeB - timeA;
    });

    // Mobile logic: 
    // If activeTopic is set -> show chat (hide list on mobile)
    // If activeTopic is NOT set -> show list (hide chat on mobile)
    // On Desktop -> show both

    return (
        <div className="flex flex-col md:flex-row gap-4 h-[calc(100vh-140px)] md:h-[calc(100vh-100px)]">
            {/* Sidebar: Topics */}
            <div className={`w-full md:w-1/4 bg-gray-800/30 border border-gray-700 rounded-xl overflow-hidden flex flex-col ${activeTopic && activeTopic !== '' ? 'hidden md:flex' : 'flex'}`}>
                <div className="p-4 border-b border-gray-700 bg-gray-900/50 flex justify-between items-center">
                    <h3 className="font-bold text-gray-400 text-xs uppercase flex items-center gap-2">
                        <Icons.Hash size={14}/> Темы сообщества
                    </h3>
                    <button onClick={() => setShowAddTopic(!showAddTopic)} className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-800 transition-colors">
                        <Icons.Plus size={14}/>
                    </button>
                </div>
                
                {showAddTopic && (
                    <div className="p-2 bg-gray-800 border-b border-gray-700 animate-slideIn">
                        <div className="text-[10px] text-gray-400 mb-1">ID темы или ссылка</div>
                        <div className="flex gap-2">
                            <input 
                                value={newTopicLink} 
                                onChange={e => setNewTopicLink(e.target.value)} 
                                placeholder=".../123"
                                className="w-full bg-black border border-gray-600 rounded px-2 py-1 text-xs text-white"
                            />
                            <button onClick={handleAddTopicSubmit} className="bg-blue-600 px-2 rounded text-white text-xs">OK</button>
                        </div>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                    {sortedTopics.map(tid => (
                        <div 
                            key={tid} 
                            className={`group w-full flex items-center justify-between p-3 rounded-lg text-sm transition-colors cursor-pointer ${activeTopic === tid ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'hover:bg-gray-800 text-gray-300'}`} 
                            onClick={() => handleTopicClick(tid)}
                        >
                            <div className="flex-1 mr-2 flex items-center overflow-hidden">
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
                                {(unreadCounts[tid] || 0) > 0 && activeTopic !== tid && (
                                    <div className="bg-green-500 text-white text-[10px] font-bold px-1.5 rounded-full min-w-[16px] text-center animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]">
                                        {unreadCounts[tid]}
                                    </div>
                                )}
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
                                {onDeleteTopic && (
                                    <button onClick={(e) => handleDeleteTopicClick(tid, e)} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-500 p-1">
                                        <Icons.Trash2 size={12}/>
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Chat Window */}
            <div className={`w-full md:flex-1 bg-black/40 border border-gray-700 rounded-xl flex-col overflow-hidden relative ${!activeTopic || activeTopic === '' ? 'hidden md:flex' : 'flex'}`} style={{backgroundImage: "url('https://web.telegram.org/img/bg_dark.png')", backgroundRepeat: 'repeat'}}>
                <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-0"></div>
                
                {/* Chat Header */}
                <div className="p-4 border-b border-gray-700 bg-gray-900/80 backdrop-blur z-10 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <button onClick={handleBackToTopics} className="md:hidden p-1.5 bg-gray-800 rounded-lg text-gray-300">
                             <Icons.ChevronDown className="rotate-90" size={18}/>
                        </button>
                        <div>
                            <h3 className="font-bold flex items-center gap-2 text-white">
                                <Icons.Hash size={18} className="text-gray-500 hidden md:block"/> 
                                {topicNames[activeTopic]} 
                            </h3>
                            <div className="text-[10px] text-gray-500">ID: {activeTopic}</div>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        {disabledAiTopics.includes(activeTopic) && (
                            <div className="text-xs bg-red-900/50 text-red-200 px-2 py-1 rounded border border-red-800 flex items-center gap-1">
                                <Icons.Slash size={10}/> AI Отключен
                            </div>
                        )}
                        {onClearTopic && (
                            <button onClick={() => onClearTopic(activeTopic)} className="text-gray-400 hover:text-red-500 p-2 rounded-lg transition-colors bg-gray-800/50 hover:bg-gray-800 border border-gray-700">
                                <Icons.Trash2 size={16}/>
                            </button>
                        )}
                    </div>
                </div>
                
                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 z-10 custom-scrollbar flex flex-col-reverse relative">
                    {isAiThinking && (
                        <div className="flex w-full justify-start msg-enter">
                             <div className="bg-gray-800 text-purple-400 rounded-2xl rounded-bl-none px-4 py-2 text-xs flex items-center gap-2 shadow-md">
                                 <span>Хеликс печатает...</span>
                             </div>
                        </div>
                    )}
                    {(!topicHistory[activeTopic] || topicHistory[activeTopic].length === 0) ? (
                        <div className="text-center text-gray-500 mt-10">Нет сообщений в этой теме.</div>
                    ) : (
                        [...(topicHistory[activeTopic] || [])].reverse().map((msg, i) => (
                            <div key={msg.id || i} className={`flex w-full ${msg.isIncoming ? 'justify-start' : 'justify-end'} msg-enter`}>
                                <div className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-2 relative shadow-md ${msg.isIncoming ? 'bg-gray-800 text-gray-200 rounded-bl-none' : 'bg-blue-600 text-white rounded-br-none'}`}>
                                    {msg.isIncoming && <div className="text-[11px] font-bold text-blue-400 mb-0.5 cursor-pointer hover:underline" onClick={() => setText(`@${msg.user} `)}>{msg.user}</div>}
                                    {msg.text && <div className="text-sm whitespace-pre-wrap leading-relaxed break-words">{msg.text}</div>}
                                    <div className="text-[10px] opacity-60 text-right mt-1">{msg.time}</div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Input Area */}
                <div className="p-3 bg-gray-900/90 border-t border-gray-700 z-10 relative">
                    {showTools && (
                        <div className="mb-2 p-2 bg-gray-800 rounded-lg animate-slideIn">
                            <div className="flex items-center gap-2 mb-2">
                                <label className="flex items-center gap-2 bg-black border border-gray-600 px-3 py-1.5 rounded text-xs text-white cursor-pointer hover:border-blue-500">
                                    <Icons.Upload size={14}/>
                                    {mediaFile ? mediaFile.name : 'Прикрепить фото/видео'}
                                    <input type="file" onChange={e => setMediaFile(e.target.files ? e.target.files[0] : null)} className="hidden"/>
                                </label>
                                {mediaFile && <button onClick={() => setMediaFile(null)} className="text-red-400 hover:text-red-300"><Icons.X size={16}/></button>}
                            </div>
                            <div className="flex gap-2">
                                <input value={btnDraft.text} onChange={e => setBtnDraft({...btnDraft, text: e.target.value})} placeholder="Кнопка" className="w-1/3 bg-black border border-gray-600 rounded px-2 py-1 text-xs text-white"/>
                                <input value={btnDraft.url} onChange={e => setBtnDraft({...btnDraft, url: e.target.value})} placeholder="URL" className="flex-1 bg-black border border-gray-600 rounded px-2 py-1 text-xs text-white"/>
                                <button onClick={addBtn} className="bg-blue-600 px-2 rounded text-white"><Icons.Plus size={14}/></button>
                            </div>
                        </div>
                    )}
                    <div className="flex gap-2 items-end">
                        <button onClick={() => setShowTools(!showTools)} className={`p-2.5 rounded-lg transition-colors h-[42px] w-[42px] flex items-center justify-center ${showTools ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                            <Icons.Plus size={20}/>
                        </button>
                         <div className="flex-1 relative">
                            <textarea 
                                value={text} 
                                onChange={e => setText(e.target.value)} 
                                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
                                placeholder={`Написать...`} 
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
