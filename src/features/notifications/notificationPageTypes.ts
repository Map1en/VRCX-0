export type NotificationLoadStatus = 'idle' | 'running' | 'ready' | 'error';

export type NotificationRow = {
    id?: string;
    version?: number;
    type?: string;
    senderUserId?: string;
    senderUsername?: string;
    expired?: boolean;
    seen?: boolean;
    location?: string;
    worldName?: string;
    groupName?: string;
    title?: string;
    message?: string;
    link?: string;
    linkText?: string;
    imageUrl?: string;
    details?: Record<string, unknown>;
    data?: Record<string, unknown>;
    responses?: unknown[];
    [key: string]: unknown;
};

export type NotificationDialogRequest = {
    notification: NotificationRow;
    messageType?: string;
} | null;
