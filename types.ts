
export interface BotConfig {
    token: string;
    targetChatId: string;
    adminIds: string;
    botName: string;
    botUsername: string;
    enableAI: boolean;
    enableAutoTop: boolean;
    enablePM: boolean;
    enableCalendarAlerts?: boolean;
    openaiApiKey: string;
    aiBaseUrl: string;
    aiModel: string;
    aiPersonality: string; 
    aiBehavior: string;
    aiProfanity: boolean;
    aiProfanityLevel?: number; // Новый параметр: Уровень мата 0-100
    aiTemperature: number;
    aiMaxTokens: number;
    bannedWords: string;
    jokes?: string; // Банк шуток
}

export interface User {
    id: number;
    name: string;
    username?: string;
    status: 'active' | 'banned' | 'muted';
    role: 'admin' | 'moderator' | 'user';
    joinDate: string;
    warnings: number;
    msgCount: number;
    dailyMsgCount: number;
    lastActiveDate: string;
    lastSeen: string;
    history: Message[];
    selected?: boolean;
    notes?: string;
    unreadCount?: number;
}

export interface Group {
    id: number;
    title: string;
    type: string;
    lastActive: string;
    isDisabled?: boolean;
}

export interface Message {
    id?: string;
    msgId?: number;
    dir?: 'in' | 'out';
    user?: string;
    userId?: number;
    text: string;
    type: 'text' | 'sticker' | 'voice' | 'video_note' | 'document' | 'photo' | 'video' | 'audio';
    mediaUrl?: string;
    time: string;
    timestamp?: number;
    isIncoming?: boolean;
    isGroup?: boolean; 
    buttons?: InlineButton[];
}

export interface KnowledgeItem {
    id: string;
    category: string;
    title: string;
    triggers: string;
    response: string;
    mediaUrl: string;
    buttons: InlineButton[];
}

export interface CalendarEvent {
    id: string;
    title: string;
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
    category: string;
    color: string;
    description?: string;
    notifyDate?: string; // YYYY-MM-DD (Specific date for notification)
    notifyTime?: string; // HH:mm
    topicId?: string; // ID топика для уведомления
    mediaUrl?: string; // Base64 or URL
    buttons?: InlineButton[];
}

export interface Command {
    id: number | string;
    trigger: string;
    matchType: 'exact' | 'contains' | 'start';
    type: string;
    response: string;
    mediaUrl: string;
    buttons: InlineButton[];
    isSystem?: boolean;
    muteDuration?: number; // Duration in minutes for /mute command
    allowedTopicId?: string; // Где работает (для обычных команд)
    notificationTopicId?: string; // Куда присылать ответ (для системных)
    allowedRoles?: ('user' | 'moderator' | 'admin')[]; // Кто может использовать
    color?: string; // Visual color tag
}

export interface QuickReply {
    id: string;
    title: string;
    text: string;
}

export interface InlineButton {
    text: string;
    url: string;
}

export interface AiStat {
    query: string;
    response?: string;
    time: number;
    cleared?: boolean; // Marker to hide text but keep stats
}

export interface AiStats {
    total: number;
    history: AiStat[];
}

export interface BroadcastState {
    text: string;
    mediaUrl: string;
    buttons: InlineButton[];
    file: File | null;
    topicId: string;
}

export interface LogEntry {
    id: string;
    timestamp: number;
    admin: string;
    action: string;
    details: string;
    type: 'info' | 'warning' | 'danger' | 'success';
}
