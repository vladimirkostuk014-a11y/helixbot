import React, { useState } from 'react';
import { Icons } from './Icons';
import { CalendarEvent, InlineButton, BotConfig } from '../types';
import { apiCall } from '../services/api';

interface CalendarEventsProps {
    events: CalendarEvent[];
    setEvents: React.Dispatch<React.SetStateAction<CalendarEvent[]>>;
    categories: string[];
    setCategories: (cats: string[]) => void;
    topicNames: Record<string, string>;
    addLog?: (action: string, details: string, type?: 'info' | 'warning' | 'danger' | 'success') => void;
    config?: BotConfig;
}

const COLORS = [
    { name: 'Gold', value: 'bg-yellow-500 text-black border-yellow-300' },
    { name: 'Cyan', value: 'bg-cyan-500 text-black border-cyan-300' },
    { name: 'Purple', value: 'bg-purple-600 text-white border-purple-400' },
    { name: 'Blue', value: 'bg-blue-600 text-white border-blue-400' },
    { name: 'Green', value: 'bg-green-600 text-white border-green-400' },
    { name: 'Red', value: 'bg-red-600 text-white border-red-400' },
    { name: 'Gray', value: 'bg-gray-600 text-white border-gray-400' },
];

const getLocalDateString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const parseLocalDate = (dateStr: string): Date => {
    if (!dateStr) return new Date();
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
};

const normalizeUrl = (url: string) => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `https://${url}`;
};

const base64ToBlob = (base64: string): Blob => {
    if (!base64.includes(',')) return new Blob();
    const arr = base64.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
};

const CalendarEvents: React.FC<CalendarEventsProps> = ({ events, setEvents, categories, setCategories, topicNames, addLog, config }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [isEventModalOpen, setIsEventModalOpen] = useState(false);
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
    
    // Event Editing State
    const [editingEvent, setEditingEvent] = useState<Partial<CalendarEvent>>({});
    const [btnDraft, setBtnDraft] = useState<InlineButton>({ text: '', url: '' });
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    
    // Category Management State
    const [newCatName, setNewCatName] = useState('');
    const [editCatIndex, setEditCatIndex] = useState<number | null>(null);
    const [tempCatName, setTempCatName] = useState('');

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth(); 
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthName = currentDate.toLocaleString('ru-RU', { month: 'long', year: 'numeric' });

    const handlePrevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
    const handleNextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

    // --- Drag and Drop Logic ---
    const handleDragStart = (e: React.DragEvent, eventId: string) => {
        e.dataTransfer.setData("eventId", eventId);
        e.dataTransfer.effectAllowed = "move";
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault(); 
        e.dataTransfer.dropEffect = "move";
    };

    const handleDrop = (e: React.DragEvent, targetDay: number, targetCategory: string) => {
        e.preventDefault();
        const eventId = e.dataTransfer.getData("eventId");
        const event = events.find(ev => ev.id === eventId);
        
        if (event) {
            const oldStart = parseLocalDate(event.startDate);
            const oldEnd = parseLocalDate(event.endDate);
            const durationMs = oldEnd.getTime() - oldStart.getTime();

            const newStart = new Date(year, month, targetDay);
            const newEnd = new Date(newStart.getTime() + durationMs);

            const newEvent = {
                ...event,
                category: targetCategory,
                startDate: getLocalDateString(newStart),
                endDate: getLocalDateString(newEnd)
            };

            setEvents(prev => prev.map(ev => ev.id === eventId ? newEvent : ev));
            if(addLog) addLog('Календарь', `Ивент "${event.title}" перемещен на ${newEvent.startDate}`, 'info');
        }
    };

    // --- Event Logic ---

    const handleSaveEvent = () => {
        if (!editingEvent.title) { alert('Введите название ивента'); return; }
        if (!editingEvent.startDate) { alert('Выберите дату начала'); return; }
        if (!editingEvent.endDate) { alert('Выберите дату окончания'); return; }
        if (!editingEvent.category) { alert('Выберите категорию'); return; }

        const newEvent: CalendarEvent = {
            id: editingEvent.id || Math.random().toString(36).substr(2, 9),
            title: editingEvent.title || '',
            startDate: editingEvent.startDate || '',
            endDate: editingEvent.endDate || '',
            category: editingEvent.category || '',
            color: editingEvent.color || COLORS[0].value,
            description: editingEvent.description || '',
            notifyDate: editingEvent.notifyDate || editingEvent.startDate || '', 
            notifyTime: editingEvent.notifyTime || '09:00',
            topicId: editingEvent.topicId || 'general',
            mediaUrl: editingEvent.mediaUrl || '',
            buttons: editingEvent.buttons || []
        };

        if (editingEvent.id) {
            setEvents(prev => prev.map(e => e.id === editingEvent.id ? newEvent : e));
            if(addLog) addLog('Календарь', `Ивент "${newEvent.title}" обновлен`, 'info');
        } else {
            setEvents(prev => [...prev, newEvent]);
            if(addLog) addLog('Календарь', `Создан ивент "${newEvent.title}"`, 'success');
        }
        setIsEventModalOpen(false);
        setConfirmDeleteId(null);
    };

    const handleDeleteEvent = () => {
        if (!editingEvent.id) return;
        
        if (confirmDeleteId === editingEvent.id) {
            setEvents(prev => prev.filter(e => e.id !== editingEvent.id));
            if(addLog) addLog('Календарь', `Удален ивент "${editingEvent.title}"`, 'warning');
            setIsEventModalOpen(false);
            setConfirmDeleteId(null);
        } else {
            setConfirmDeleteId(editingEvent.id);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setEditingEvent(prev => ({ ...prev, mediaUrl: reader.result as string }));
            };
            reader.readAsDataURL(file);
        }
    };

    const handleAddButton = () => {
        if (!btnDraft.text) return;
        setEditingEvent(prev => ({ ...prev, buttons: [...(prev.buttons || []), btnDraft] }));
        setBtnDraft({ text: '', url: '' });
    };

    const handleTestNotification = async () => {
        if (!config) { alert('Ошибка конфигурации бота'); return; }
        if (!editingEvent.title) { alert('Сначала заполните название'); return; }

        const msg = `⚡️ <b>${editingEvent.title}</b>\n\n` +
                    `📅 <b>Даты:</b> ${editingEvent.startDate} — ${editingEvent.endDate}\n` +
                    `📂 <i>Категория: ${editingEvent.category}</i>\n\n` +
                    `${editingEvent.description || ''}`;
        
        const inlineKeyboard = editingEvent.buttons && editingEvent.buttons.length > 0 
            ? { inline_keyboard: editingEvent.buttons.map(b => {
                const url = normalizeUrl(b.url);
                return [ url ? { text: b.text, url } : { text: b.text, callback_data: 'cb_cal' } ];
            }) }
            : undefined;

        const markupString = inlineKeyboard ? JSON.stringify(inlineKeyboard) : undefined;

        try {
            if (editingEvent.mediaUrl && editingEvent.mediaUrl.startsWith('data:')) {
                const blob = base64ToBlob(editingEvent.mediaUrl);
                const fd = new FormData();
                fd.append('chat_id', config.targetChatId);
                fd.append('photo', blob, 'image.jpg');
                fd.append('caption', msg);
                fd.append('parse_mode', 'HTML');
                if (markupString) fd.append('reply_markup', markupString);
                if (editingEvent.topicId && editingEvent.topicId !== 'general') fd.append('message_thread_id', editingEvent.topicId);
                
                await apiCall('sendPhoto', fd, config, true);
            } else {
                await apiCall('sendMessage', { 
                    chat_id: config.targetChatId, 
                    text: msg,
                    parse_mode: 'HTML',
                    reply_markup: inlineKeyboard, 
                    message_thread_id: editingEvent.topicId !== 'general' ? editingEvent.topicId : undefined
                }, config);
            }
            alert('Тестовое уведомление отправлено!');
        } catch (e) {
            alert('Ошибка отправки: ' + e);
        }
    };

    // --- Category Logic ---

    const handleAddCategory = () => {
        const name = newCatName.trim();
        if (name && !categories.includes(name)) {
            setCategories([...categories, name]);
            setNewCatName('');
        }
    };

    const handleSaveCategory = (index: number) => {
        if (tempCatName.trim()) {
            const oldName = categories[index];
            const updatedCats = [...categories];
            updatedCats[index] = tempCatName.trim();
            setCategories(updatedCats);
            // Also update events using functional update
            setEvents(prev => prev.map(e => e.category === oldName ? { ...e, category: tempCatName.trim() } : e));
        }
        setEditCatIndex(null);
    };

    const handleDeleteCategory = (index: number) => {
        const newCats = categories.filter((_, i) => i !== index);
        setCategories(newCats);
    };

    // --- Render Helpers ---

    const getDaysArray = () => {
        return Array.from({ length: daysInMonth }, (_, i) => {
            const d = new Date(year, month, i + 1);
            return {
                day: i + 1,
                dow: d.toLocaleString('ru-RU', { weekday: 'short' }),
                isWeekend: d.getDay() === 0 || d.getDay() === 6
            };
        });
    };

    const getEventsForCategory = (cat: string) => {
        const viewStart = new Date(year, month, 1);
        const viewEnd = new Date(year, month + 1, 0, 23, 59, 59);

        return events.filter(e => {
            if (e.category !== cat) return false;
            const start = parseLocalDate(e.startDate);
            const end = parseLocalDate(e.endDate);
            return start <= viewEnd && end >= viewStart;
        });
    };

    const calculateEventStyle = (event: CalendarEvent) => {
        const start = parseLocalDate(event.startDate);
        const end = parseLocalDate(event.endDate);
        const viewStart = new Date(year, month, 1);
        const viewEnd = new Date(year, month + 1, 0); 

        const effectiveStart = start < viewStart ? viewStart : start;
        const effectiveEnd = end > viewEnd ? viewEnd : end;

        const startDay = effectiveStart.getDate(); 
        const endDay = effectiveEnd.getDate();     
        
        const duration = endDay - startDay + 1;

        return {
            gridColumnStart: startDay, 
            gridColumnEnd: `span ${duration}`,
        };
    };

    return (
        <div className="flex flex-col h-full gap-4 relative">
            {/* Header */}
            <div className="flex justify-between items-center bg-gray-800/30 p-4 rounded-xl border border-gray-700">
                <div className="flex items-center gap-4">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Icons.Calendar size={24} className="text-blue-500"/> Календарь Событий
                    </h2>
                    <div className="flex items-center bg-black/40 rounded-lg border border-gray-700 p-1">
                        <button onClick={handlePrevMonth} className="p-1 hover:bg-gray-700 rounded"><Icons.ChevronDown className="rotate-90" size={16}/></button>
                        <span className="px-4 font-bold text-sm uppercase w-32 text-center">{monthName}</span>
                        <button onClick={handleNextMonth} className="p-1 hover:bg-gray-700 rounded"><Icons.ChevronRight size={16}/></button>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button 
                        onClick={() => setIsCategoryModalOpen(true)}
                        className="bg-gray-700 hover:bg-gray-600 text-gray-200 px-4 py-2 rounded-lg font-bold flex items-center gap-2 border border-gray-600"
                    >
                        <Icons.Folder size={18}/> Категории
                    </button>
                    <button 
                        onClick={() => { 
                            const todayStr = getLocalDateString(new Date());
                            setEditingEvent({ 
                                color: COLORS[0].value, 
                                startDate: todayStr, 
                                endDate: todayStr,
                                category: categories.length > 0 ? categories[0] : '', // Default to first category
                                notifyDate: todayStr, // Default notification to today/start date
                                notifyTime: '09:00',
                                topicId: 'general',
                                buttons: []
                            }); 
                            setIsEventModalOpen(true); 
                            setConfirmDeleteId(null);
                        }}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 shadow-lg shadow-blue-900/20"
                    >
                        <Icons.Plus size={18}/> Добавить Ивент
                    </button>
                </div>
            </div>

            {/* Calendar Grid */}
            <div className="flex-1 bg-[#121214] border border-gray-800 rounded-xl overflow-hidden flex flex-col relative shadow-2xl">
                <div className="overflow-x-auto custom-scrollbar flex-1">
                    <div className="min-w-[1200px] h-full flex flex-col">
                        {/* Days Header */}
                        <div className="grid border-b border-gray-800 bg-gray-900/80 sticky top-0 z-10 backdrop-blur-sm" style={{ gridTemplateColumns: `200px repeat(${daysInMonth}, 1fr)` }}>
                            <div className="p-2 font-bold text-gray-500 text-xs uppercase flex items-center pl-4 border-r border-gray-800">Категория</div>
                            {getDaysArray().map(d => (
                                <div key={d.day} className={`text-center py-2 border-r border-gray-800/30 flex flex-col items-center justify-center ${d.isWeekend ? 'bg-red-900/10 text-red-300' : 'text-gray-400'}`}>
                                    <span className="text-[10px] font-bold uppercase opacity-60">{d.dow}</span>
                                    <span className="text-sm font-bold">{d.day}</span>
                                </div>
                            ))}
                        </div>

                        {/* Calendar Rows */}
                        <div className="flex-1 overflow-y-auto">
                            {categories.map((cat) => (
                                <div key={cat} className="grid border-b border-gray-800/50 min-h-[80px] relative group hover:bg-white/05 transition-colors" style={{ gridTemplateColumns: `200px repeat(${daysInMonth}, 1fr)` }}>
                                    {/* Category Label */}
                                    <div className="sticky left-0 z-20 bg-[#121214] border-r border-gray-800 p-4 font-bold text-sm text-gray-300 flex items-center shadow-lg group-hover:bg-[#18181b] transition-colors break-words leading-tight">
                                        {cat}
                                    </div>
                                    
                                    {/* Grid Cells (Droppable Areas) */}
                                    {getDaysArray().map(d => (
                                        <div 
                                            key={d.day} 
                                            onDragOver={handleDragOver}
                                            onDrop={(e) => handleDrop(e, d.day, cat)}
                                            onClick={() => {
                                                const selectedDate = new Date(year, month, d.day);
                                                const dateStr = getLocalDateString(selectedDate);
                                                setEditingEvent({ 
                                                    startDate: dateStr, 
                                                    endDate: dateStr,
                                                    category: cat,
                                                    color: COLORS[0].value,
                                                    notifyDate: dateStr,
                                                    notifyTime: '09:00',
                                                    topicId: 'general',
                                                    buttons: []
                                                });
                                                setIsEventModalOpen(true);
                                                setConfirmDeleteId(null);
                                            }}
                                            className={`border-r border-gray-800/30 h-full ${d.isWeekend ? 'bg-red-900/05' : ''} hover:bg-white/10 transition-colors z-0 cursor-pointer`}
                                        ></div>
                                    ))}

                                    {/* Events Layer (Overlay) */}
                                    <div className="absolute inset-0 left-[200px] grid items-center py-2 px-1 pointer-events-none z-10" style={{ gridTemplateColumns: `repeat(${daysInMonth}, 1fr)` }}>
                                        {getEventsForCategory(cat).map(event => (
                                            <div 
                                                key={event.id}
                                                draggable
                                                onDragStart={(e) => handleDragStart(e, event.id)}
                                                onClick={(e) => { e.stopPropagation(); setEditingEvent(event); setIsEventModalOpen(true); setConfirmDeleteId(null); }}
                                                className={`pointer-events-auto h-8 rounded-md px-2 flex items-center shadow-md cursor-grab active:cursor-grabbing border hover:brightness-110 transition-all text-xs font-bold whitespace-nowrap overflow-hidden relative ${event.color}`}
                                                style={calculateEventStyle(event)}
                                                title={`${event.title} (${event.startDate} - ${event.endDate})`}
                                            >
                                                <span className="truncate w-full drop-shadow-md select-none">{event.title}</span>
                                                <div className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-white/50"></div>
                                                <div className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-white/50"></div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                            {categories.length === 0 && (
                                <div className="p-8 text-center text-gray-500">Нет категорий. Создайте категорию, чтобы добавить ивент.</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Manage Categories Modal - WIDER */}
            {isCategoryModalOpen && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setIsCategoryModalOpen(false)}>
                    <div className="bg-[#18181b] border border-gray-700 rounded-2xl w-full max-w-2xl shadow-2xl p-6 animate-slideIn" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Icons.Folder size={20} className="text-yellow-500"/> Управление категориями</h3>
                            <button onClick={() => setIsCategoryModalOpen(false)}><Icons.X size={24} className="text-gray-500 hover:text-white"/></button>
                        </div>
                        <div className="flex gap-2 mb-4">
                            <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="Название новой категории..." className="flex-1 bg-black border border-gray-600 rounded-lg px-3 py-2 text-white outline-none focus:border-blue-500"/>
                            <button onClick={handleAddCategory} className="bg-blue-600 hover:bg-blue-500 text-white px-3 rounded-lg"><Icons.Plus size={20}/></button>
                        </div>
                        <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
                            {categories.map((cat, i) => (
                                <div key={i} className="flex items-center justify-between bg-gray-900 p-2 rounded border border-gray-800">
                                    {editCatIndex === i ? (
                                        <div className="flex flex-1 gap-2 mr-2">
                                            <input value={tempCatName} onChange={e => setTempCatName(e.target.value)} className="flex-1 bg-black border border-blue-500 rounded px-2 py-1 text-white text-sm" autoFocus/>
                                            <button onClick={() => handleSaveCategory(i)} className="text-green-400"><Icons.Check size={16}/></button>
                                            <button onClick={() => setEditCatIndex(null)} className="text-red-400"><Icons.X size={16}/></button>
                                        </div>
                                    ) : <span className="text-white text-sm">{cat}</span>}
                                    {editCatIndex !== i && (
                                        <div className="flex gap-2">
                                            <button onClick={() => { setEditCatIndex(i); setTempCatName(cat); }} className="text-gray-400 hover:text-white"><Icons.Edit2 size={16}/></button>
                                            <button onClick={() => handleDeleteCategory(i)} className="text-gray-400 hover:text-red-400"><Icons.Trash2 size={16}/></button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Add/Edit Event Modal - WIDER */}
            {isEventModalOpen && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setIsEventModalOpen(false)}>
                    <div className="bg-[#18181b] border border-gray-700 rounded-2xl w-full max-w-4xl shadow-2xl p-6 animate-slideIn max-h-[90vh] overflow-y-auto custom-scrollbar" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-white">{editingEvent.id ? 'Редактировать событие' : 'Новое событие'}</h3>
                            <button onClick={() => setIsEventModalOpen(false)}><Icons.X size={24} className="text-gray-500 hover:text-white"/></button>
                        </div>
                        
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs text-gray-500 uppercase font-bold block mb-1">Название ивента</label>
                                <input value={editingEvent.title || ''} onChange={e => setEditingEvent({...editingEvent, title: e.target.value})} className="w-full bg-black border border-gray-600 rounded-lg p-2.5 text-white focus:border-blue-500 outline-none" placeholder="Напр. Лестница Потасовок"/>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-gray-500 uppercase font-bold block mb-1">Начало</label>
                                    <input type="date" value={editingEvent.startDate || ''} onChange={e => setEditingEvent({...editingEvent, startDate: e.target.value})} className="w-full bg-black border border-gray-600 rounded-lg p-2.5 text-white focus:border-blue-500 outline-none"/>
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 uppercase font-bold block mb-1">Конец</label>
                                    <input type="date" value={editingEvent.endDate || ''} onChange={e => setEditingEvent({...editingEvent, endDate: e.target.value})} className="w-full bg-black border border-gray-600 rounded-lg p-2.5 text-white focus:border-blue-500 outline-none"/>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-gray-500 uppercase font-bold block mb-1">Категория</label>
                                    <select value={editingEvent.category || ''} onChange={e => setEditingEvent({...editingEvent, category: e.target.value})} className="w-full bg-black border border-gray-600 rounded-lg p-2.5 text-white focus:border-blue-500 outline-none">
                                        <option value="" disabled>Выберите...</option>
                                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 uppercase font-bold block mb-1">Куда уведомить?</label>
                                    <select value={editingEvent.topicId || 'general'} onChange={e => setEditingEvent({...editingEvent, topicId: e.target.value})} className="w-full bg-black border border-gray-600 rounded-lg p-2.5 text-white focus:border-blue-500 outline-none">
                                        <option value="general">Общий чат (General)</option>
                                        {Object.entries(topicNames).map(([id, name]) => (
                                            id !== 'general' && <option key={id} value={id}>{name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-gray-500 uppercase font-bold block mb-1">Дата уведомления</label>
                                    <input 
                                        type="date" 
                                        value={editingEvent.notifyDate || editingEvent.startDate || ''} 
                                        onChange={e => setEditingEvent({...editingEvent, notifyDate: e.target.value})} 
                                        className="w-full bg-black border border-gray-600 rounded-lg p-2.5 text-white focus:border-blue-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 uppercase font-bold block mb-1">Время уведомления</label>
                                    <input 
                                        type="time" 
                                        value={editingEvent.notifyTime || '09:00'} 
                                        onChange={e => setEditingEvent({...editingEvent, notifyTime: e.target.value})} 
                                        className="w-full bg-black border border-gray-600 rounded-lg p-2 text-white focus:border-blue-500 outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-xs text-gray-500 uppercase font-bold block mb-2">Цвет маркера</label>
                                <div className="flex flex-wrap gap-2">
                                    {COLORS.map(c => (
                                        <button 
                                            key={c.name} 
                                            onClick={() => setEditingEvent({...editingEvent, color: c.value})}
                                            className={`w-8 h-8 rounded-full border-2 ${c.value} ${editingEvent.color === c.value ? 'ring-2 ring-white scale-110' : 'opacity-70 hover:opacity-100'} transition-all`}
                                            title={c.name}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div className="bg-black/30 p-4 rounded-xl border border-gray-700 space-y-4">
                                <div>
                                    <label className="text-xs text-gray-500 uppercase font-bold block mb-1">Текст уведомления</label>
                                    <textarea value={editingEvent.description || ''} onChange={e => setEditingEvent({...editingEvent, description: e.target.value})} className="w-full bg-black border border-gray-600 rounded-lg p-2.5 text-white h-24 resize-none focus:border-blue-500 outline-none" placeholder="Дополнительная информация для игроков..."/>
                                </div>

                                {/* Media Upload */}
                                <div>
                                    <label className="text-xs text-gray-500 uppercase font-bold block mb-2">Фото (Обложка)</label>
                                    <div className="flex gap-4 items-center">
                                        <label className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded cursor-pointer border border-gray-600 transition-colors">
                                            <Icons.Upload size={14}/>
                                            <span className="text-xs text-white">Загрузить файл</span>
                                            <input type="file" onChange={handleFileUpload} className="hidden"/>
                                        </label>
                                        {editingEvent.mediaUrl && (
                                            <div className="relative group w-16 h-16 bg-black rounded border border-gray-600 overflow-hidden">
                                                <img src={editingEvent.mediaUrl} alt="Preview" className="w-full h-full object-cover"/>
                                                <button onClick={() => setEditingEvent({...editingEvent, mediaUrl: ''})} className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 text-red-400"><Icons.Trash2 size={16}/></button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Inline Buttons */}
                                <div>
                                    <label className="text-xs text-gray-500 uppercase font-bold block mb-2">Кнопки (Ссылки)</label>
                                    <div className="flex gap-2 mb-2">
                                        <input value={btnDraft.text} onChange={e => setBtnDraft({...btnDraft, text: e.target.value})} placeholder="Текст" className="flex-1 bg-black border border-gray-600 rounded px-2 py-1 text-xs text-white"/>
                                        <input value={btnDraft.url} onChange={e => setBtnDraft({...btnDraft, url: e.target.value})} placeholder="URL" className="flex-1 bg-black border border-gray-600 rounded px-2 py-1 text-xs text-white"/>
                                        <button onClick={handleAddButton} className="bg-gray-700 px-2 rounded hover:bg-gray-600"><Icons.Plus size={14}/></button>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {editingEvent.buttons?.map((b, i) => (
                                            <div key={i} className="bg-blue-900/30 border border-blue-500/30 px-2 py-1 rounded text-xs flex items-center gap-2">
                                                <span>{b.text}</span>
                                                <button onClick={() => setEditingEvent(prev => ({...prev, buttons: prev.buttons?.filter((_, idx) => idx !== i)}))} className="text-red-300 hover:text-red-100"><Icons.X size={12}/></button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3 mt-8">
                            {editingEvent.id && (
                                <button 
                                    onClick={handleDeleteEvent} 
                                    className={`px-4 py-2.5 rounded-xl font-bold transition-all border ${confirmDeleteId === editingEvent.id ? 'bg-red-600 text-white border-red-500 shadow-lg shadow-red-900/40' : 'bg-red-900/20 text-red-400 border-red-900/50 hover:bg-red-900/40'}`}
                                >
                                    {confirmDeleteId === editingEvent.id ? 'Точно удалить?' : 'Удалить'}
                                </button>
                            )}
                            <button onClick={handleTestNotification} className="px-4 py-2.5 rounded-xl bg-purple-900/20 text-purple-400 font-bold hover:bg-purple-900/40 transition-colors border border-purple-900/50 flex items-center gap-2">
                                <Icons.Send size={16}/> Проверить
                            </button>
                            <button onClick={handleSaveEvent} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-xl font-bold shadow-lg shadow-blue-900/30 transition-all">
                                Сохранить
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CalendarEvents;