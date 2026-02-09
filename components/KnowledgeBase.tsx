
import React, { useState } from 'react';
import { Icons } from './Icons';
import { KnowledgeItem } from '../types';

interface KnowledgeBaseProps {
    items: KnowledgeItem[];
    categories: string[];
    setItems: (items: KnowledgeItem[]) => void;
    setCategories: (cats: string[]) => void;
    addLog?: (action: string, details: string, type?: 'info' | 'warning' | 'danger' | 'success') => void;
}

const KnowledgeBase: React.FC<KnowledgeBaseProps> = ({ items, categories, setItems, setCategories, addLog }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [isManagingCats, setIsManagingCats] = useState(false);
    const [currentItem, setCurrentItem] = useState<Partial<KnowledgeItem>>({});
    const [collapsed, setCollapsed] = useState<string[]>([]);
    const [newCatName, setNewCatName] = useState('');
    const [editCatName, setEditCatName] = useState<string | null>(null);
    const [tempCatName, setTempCatName] = useState('');

    const grouped = items.reduce((acc, item) => {
        const cat = item.category || 'Разное';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(item);
        return acc;
    }, {} as Record<string, KnowledgeItem[]>);

    const toggleCollapse = (cat: string) => {
        setCollapsed(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
    };

    const handleSaveItem = () => {
        if (currentItem.id) {
            setItems(items.map(i => i.id === currentItem.id ? currentItem as KnowledgeItem : i));
            if (addLog) addLog('Редактирование БЗ', `Обновлена статья "${currentItem.title}" в разделе ${currentItem.category}`, 'info');
        } else {
            setItems([...items, { ...currentItem, id: Math.random().toString(36).substr(2, 9), buttons: [] } as KnowledgeItem]);
            if (addLog) addLog('Добавление в БЗ', `Создана статья "${currentItem.title}" в разделе ${currentItem.category}`, 'success');
        }
        setIsEditing(false);
    };

    const handleDeleteItem = () => {
        if (!currentItem.id) return;
        setItems(items.filter(i => i.id !== currentItem.id));
        if (addLog) addLog('Удаление из БЗ', `Удалена статья "${currentItem.title}"`, 'warning');
        setIsEditing(false);
    };

    const handleSaveCat = (oldName: string) => {
        if (tempCatName && tempCatName !== oldName) {
            setCategories(categories.map(c => c === oldName ? tempCatName : c));
            setItems(items.map(kb => kb.category === oldName ? { ...kb, category: tempCatName } : kb));
            if (addLog) addLog('Переименование раздела', `Раздел "${oldName}" переименован в "${tempCatName}"`, 'info');
        }
        setEditCatName(null);
    };

    return (
        <div className="flex flex-col lg:flex-row gap-6 h-full">
            <div className="w-full lg:w-1/3 bg-gray-800/30 border border-gray-700 rounded-xl overflow-hidden flex flex-col h-[400px] lg:h-full">
                <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900/50">
                    <span className="font-medium text-white flex items-center gap-2"><Icons.BookOpen size={18}/> Статьи</span>
                    <div className="flex gap-1">
                        <button onClick={() => { setIsManagingCats(!isManagingCats); setIsEditing(false); }} className={`p-1.5 rounded transition-colors ${isManagingCats ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}><Icons.Folder size={18}/></button>
                        <button onClick={() => { setIsEditing(true); setIsManagingCats(false); setCurrentItem({ id: '', category: '', title: '', response: '', mediaUrl: '', buttons: [] }); }} className="p-1.5 text-gray-400 hover:text-white"><Icons.Plus size={18}/></button>
                    </div>
                </div>
                <div className="overflow-y-auto p-2 space-y-4 custom-scrollbar">
                    {Object.keys(grouped).map(category => (
                        <div key={category} className="mb-4">
                            <div className="flex justify-between items-center px-2 mb-2 group cursor-pointer hover:bg-gray-800/30 rounded py-1" onClick={() => toggleCollapse(category)}>
                                <h4 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1 select-none">
                                    {collapsed.includes(category) ? <Icons.ChevronRight size={12}/> : <Icons.ChevronDown size={12}/>} 
                                    <Icons.Folder size={12}/> {category}
                                </h4>
                                <button onClick={(e) => { e.stopPropagation(); setIsEditing(true); setIsManagingCats(false); setCurrentItem({ category: category, title: '', triggers: '', response: '', mediaUrl: '', buttons: [] }); }} className="text-gray-600 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity"><Icons.Plus size={12}/></button>
                            </div>
                            {!collapsed.includes(category) && (
                                <div className="space-y-2 pl-2">
                                    {grouped[category].map(kb => (
                                        <div key={kb.id} onClick={() => { setCurrentItem(kb); setIsEditing(true); setIsManagingCats(false); }} className="p-3 bg-gray-900/50 rounded hover:bg-gray-800 cursor-pointer group border border-gray-800 hover:border-blue-500/30">
                                            <div className="flex justify-between items-start">
                                                <div className="font-bold text-sm text-blue-300 mb-1">{kb.title}</div>
                                            </div>
                                            <p className="text-gray-500 text-xs truncate">{kb.response}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {isManagingCats ? (
                <div className="w-full lg:w-2/3 bg-gray-800/30 border border-gray-700 rounded-xl p-6 overflow-y-auto custom-scrollbar">
                    <h3 className="text-lg font-medium mb-4 text-white flex items-center gap-2"><Icons.Folder size={20} className="text-blue-400"/> Управление разделами</h3>
                    <div className="mb-6 flex gap-2">
                        <input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} className="flex-1 bg-gray-900 border border-gray-600 rounded p-2 text-white" placeholder="Название нового раздела..."/>
                        <button onClick={() => { if(newCatName && !categories.includes(newCatName)) { setCategories([...categories, newCatName]); setNewCatName(''); if (addLog) addLog('Добавление раздела', `Добавлен раздел "${newCatName}"`, 'success'); } }} className="bg-blue-600 px-4 rounded text-white font-medium hover:bg-blue-500">Добавить</button>
                    </div>
                    <div className="space-y-2">
                        {categories.map(cat => (
                            <div key={cat} className="flex justify-between items-center bg-gray-900 p-3 rounded border border-gray-700">
                                {editCatName === cat ? (
                                    <div className="flex-1 flex gap-2 mr-2">
                                        <input value={tempCatName} onChange={(e) => setTempCatName(e.target.value)} className="flex-1 bg-black border border-blue-500 rounded px-2 py-1 text-white text-sm" autoFocus/>
                                        <button onClick={() => handleSaveCat(cat)} className="text-green-400 hover:text-green-300"><Icons.Check size={16}/></button>
                                        <button onClick={() => setEditCatName(null)} className="text-red-400 hover:text-red-300"><Icons.X size={16}/></button>
                                    </div>
                                ) : (
                                    <span className="text-white">{cat}</span>
                                )}
                                {editCatName !== cat && (
                                    <div className="flex gap-2">
                                        <button onClick={() => { setEditCatName(cat); setTempCatName(cat); }} className="text-gray-400 hover:text-white p-1"><Icons.Edit2 size={16}/></button>
                                        <button onClick={() => { setCategories(categories.filter(c => c !== cat)); setItems(items.map(kb => kb.category === cat ? { ...kb, category: 'Разное' } : kb)); if(addLog) addLog('Удаление раздела', `Удален раздел "${cat}"`, 'warning'); }} className="text-gray-400 hover:text-red-400 p-1"><Icons.Trash2 size={16}/></button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            ) : isEditing ? (
                <div className="w-full lg:w-2/3 bg-gray-800/30 border border-gray-700 rounded-xl p-6 overflow-y-auto custom-scrollbar">
                    <h3 className="text-lg font-medium mb-4 text-blue-400">{currentItem.id ? 'Редактировать статью' : 'Новая статья'}</h3>
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs text-gray-500">Раздел</label>
                                <select value={currentItem.category} onChange={e => setCurrentItem({...currentItem, category: e.target.value})} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white outline-none">
                                    <option value="">Выберите...</option>
                                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs text-gray-500">Название</label>
                                <input value={currentItem.title} onChange={e => setCurrentItem({...currentItem, title: e.target.value})} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"/>
                            </div>
                        </div>

                        <div>
                            <label className="text-xs text-gray-500">Текст для AI (База знаний)</label>
                            <textarea rows={12} value={currentItem.response} onChange={e => setCurrentItem({...currentItem, response: e.target.value})} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white font-mono text-sm" placeholder="Информация, которую бот должен знать..." />
                        </div>
                        
                        <div className="flex justify-end gap-3 pt-4">
                            {currentItem.id && <button onClick={handleDeleteItem} className="text-red-400"><Icons.Trash2 size={16}/></button>}
                            <button onClick={handleSaveItem} className="bg-blue-600 px-6 py-2 rounded text-white">Сохранить</button>
                        </div>
                    </div>
                </div>
            ) : ( 
                <div className="hidden lg:flex w-2/3 items-center justify-center text-gray-500 border border-dashed border-gray-700 rounded-xl bg-gray-900/10">
                    <p>Выберите статью или раздел</p>
                </div> 
            )}
        </div>
    );
};

export default KnowledgeBase;
