import React, { useState } from 'react';
import { Icons } from './Icons';
import { LogEntry } from '../types';

interface AuditLogsProps {
    logs: LogEntry[];
    setLogs: (logs: LogEntry[]) => void;
}

const AuditLogs: React.FC<AuditLogsProps> = ({ logs, setLogs }) => {
    const [filterType, setFilterType] = useState<'all' | 'danger' | 'warning' | 'info' | 'success'>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
    const [showClearConfirm, setShowClearConfirm] = useState(false);

    const filteredLogs = logs
        .filter(log => filterType === 'all' || log.type === filterType)
        .filter(log => 
            log.action.toLowerCase().includes(searchTerm.toLowerCase()) || 
            log.details.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.admin.toLowerCase().includes(searchTerm.toLowerCase())
        )
        .sort((a, b) => b.timestamp - a.timestamp);

    const handleClearLogs = () => {
        setLogs([]);
        setShowClearConfirm(false);
    };

    const downloadLogs = () => {
        const headers = ['Timestamp', 'Type', 'Admin', 'Action', 'Details'];
        const rows = filteredLogs.map(l => [
            new Date(l.timestamp).toLocaleString(),
            l.type,
            l.admin,
            `"${l.action.replace(/"/g, '""')}"`,
            `"${l.details.replace(/"/g, '""')}"`
        ]);
        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `audit_logs_${new Date().toLocaleDateString()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="flex gap-6 h-full flex-col relative">
            {/* Clear Confirmation Modal */}
            {showClearConfirm && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full shadow-2xl animate-slideIn">
                        <div className="text-center mb-6">
                            <div className="w-16 h-16 bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500">
                                <Icons.Trash2 size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">Очистить журнал?</h3>
                            <p className="text-gray-400 text-sm">Это действие удалит всю историю действий администраторов безвозвратно.</p>
                        </div>
                        <div className="flex gap-3">
                            <button onClick={() => setShowClearConfirm(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2 rounded-lg font-bold transition-colors">Отмена</button>
                            <button onClick={handleClearLogs} className="flex-1 bg-red-600 hover:bg-red-500 text-white py-2 rounded-lg font-bold transition-colors">Да, очистить</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Log Details Modal - WIDER */}
            {selectedLog && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setSelectedLog(null)}>
                    <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-3xl shadow-2xl animate-slideIn" onClick={e => e.stopPropagation()}>
                        <div className={`p-4 rounded-t-xl flex justify-between items-center ${
                            selectedLog.type === 'danger' ? 'bg-red-900/30' : 
                            selectedLog.type === 'warning' ? 'bg-yellow-900/30' : 
                            selectedLog.type === 'success' ? 'bg-green-900/30' : 'bg-blue-900/30'
                        }`}>
                            <h3 className="font-bold text-white flex items-center gap-2">
                                <Icons.Shield size={18}/> Детали события
                            </h3>
                            <button onClick={() => setSelectedLog(null)} className="text-white/50 hover:text-white"><Icons.X size={20}/></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="text-xs text-gray-500 uppercase font-bold block mb-1">Администратор</label>
                                <div className="text-white font-mono bg-black/30 p-2 rounded border border-gray-700">{selectedLog.admin}</div>
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 uppercase font-bold block mb-1">Действие</label>
                                <div className="text-white font-bold text-lg">{selectedLog.action}</div>
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 uppercase font-bold block mb-1">Детали / Топик</label>
                                <div className="text-gray-300 text-sm bg-black/30 p-4 rounded border border-gray-700 whitespace-pre-wrap leading-relaxed max-h-[400px] overflow-y-auto custom-scrollbar">{selectedLog.details}</div>
                            </div>
                            <div className="flex justify-between items-center pt-2 border-t border-gray-800">
                                <div className="text-xs text-gray-500">ID: {selectedLog.id}</div>
                                <div className="text-xs text-gray-400">{new Date(selectedLog.timestamp).toLocaleString('ru-RU')}</div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-4 flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Icons.Shield className="text-blue-500"/> Журнал действий
                    </h2>
                    <div className="flex bg-gray-900 rounded p-1 border border-gray-700">
                        <button onClick={() => setFilterType('all')} className={`px-3 py-1 rounded text-xs font-bold transition-colors ${filterType === 'all' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>Все</button>
                        <button onClick={() => setFilterType('danger')} className={`px-3 py-1 rounded text-xs font-bold transition-colors ${filterType === 'danger' ? 'bg-red-900/50 text-red-200' : 'text-gray-400 hover:text-red-400'}`}>Опасные</button>
                        <button onClick={() => setFilterType('warning')} className={`px-3 py-1 rounded text-xs font-bold transition-colors ${filterType === 'warning' ? 'bg-yellow-900/50 text-yellow-200' : 'text-gray-400 hover:text-yellow-400'}`}>Важные</button>
                    </div>
                </div>
                <div className="flex gap-2">
                    <input 
                        value={searchTerm} 
                        onChange={e => setSearchTerm(e.target.value)} 
                        placeholder="Поиск по логам..." 
                        className="bg-black/50 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none w-64"
                    />
                    <button onClick={downloadLogs} className="bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-600/50 px-3 py-1.5 rounded text-xs font-bold flex items-center gap-2">
                        <Icons.Upload size={14}/> CSV
                    </button>
                    <button onClick={() => setShowClearConfirm(true)} className="bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-600/50 px-3 py-1.5 rounded text-xs font-bold flex items-center gap-2">
                        <Icons.Trash2 size={14}/> Очистить
                    </button>
                </div>
            </div>

            <div className="flex-1 bg-gray-800/30 border border-gray-700 rounded-xl overflow-hidden flex flex-col">
                <div className="overflow-y-auto custom-scrollbar flex-1 p-4 space-y-2">
                    {filteredLogs.length === 0 ? (
                        <div className="text-center text-gray-500 py-10">Журнал пуст</div>
                    ) : (
                        filteredLogs.map(log => (
                            <div 
                                key={log.id} 
                                onClick={() => setSelectedLog(log)}
                                className={`p-3 rounded-lg border flex items-center justify-between transition-all cursor-pointer hover:shadow-lg hover:scale-[1.01] ${
                                log.type === 'danger' ? 'bg-red-900/10 border-red-900/30 hover:bg-red-900/20' : 
                                log.type === 'warning' ? 'bg-yellow-900/10 border-yellow-900/30 hover:bg-yellow-900/20' : 
                                log.type === 'success' ? 'bg-green-900/10 border-green-900/30 hover:bg-green-900/20' : 
                                'bg-gray-900/30 border-gray-800 hover:bg-gray-800'
                            }`}>
                                <div className="flex items-center gap-4">
                                    <div className={`w-2 h-2 rounded-full ${
                                        log.type === 'danger' ? 'bg-red-500' : 
                                        log.type === 'warning' ? 'bg-yellow-500' : 
                                        log.type === 'success' ? 'bg-green-500' : 
                                        'bg-blue-500'
                                    }`}></div>
                                    <div className="text-xs text-gray-500 w-32 font-mono">
                                        {new Date(log.timestamp).toLocaleString('ru-RU')}
                                    </div>
                                    <div>
                                        <div className={`font-bold text-sm ${
                                            log.type === 'danger' ? 'text-red-400' : 
                                            log.type === 'warning' ? 'text-yellow-400' : 
                                            'text-gray-200'
                                        }`}>{log.action}</div>
                                        <div className="text-xs text-gray-400 truncate max-w-md">{log.details}</div>
                                    </div>
                                </div>
                                <div className="text-xs font-bold text-gray-600 uppercase bg-gray-900 px-2 py-1 rounded">
                                    {log.admin}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default AuditLogs;