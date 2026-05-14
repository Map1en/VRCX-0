type RealtimePresenceContent = Record<string, any>;
type RealtimePresenceMessageParts = {
    type: string;
    content: RealtimePresenceContent;
};
type RealtimePresenceMessage = {
    type?: unknown;
    content?: unknown;
};
type RealtimePresenceHandler = (
    content: RealtimePresenceContent,
    type: string
) => boolean | Promise<boolean>;
type RealtimePresenceNotificationHandler = (
    type: string,
    content: RealtimePresenceContent
) => boolean | Promise<boolean>;
type RealtimePresenceHandlers = {
    default?: RealtimePresenceHandler;
    notification?: RealtimePresenceNotificationHandler;
};

const notificationEventTypes = new Set<string>([
    'notification',
    'notification-v2',
    'notification-v2-delete',
    'notification-v2-update',
    'see-notification',
    'hide-notification',
    'response-notification'
]);

function getRealtimePresenceMessageParts(
    message: RealtimePresenceMessage | null | undefined
): RealtimePresenceMessageParts | null {
    const type = typeof message?.type === 'string' ? message.type : '';
    const content =
        message?.content && typeof message.content === 'object'
            ? (message.content as RealtimePresenceContent)
            : null;

    if (!type || !content) {
        return null;
    }

    return { type, content };
}

async function dispatchRealtimePresenceMessage(
    message: RealtimePresenceMessage | null | undefined,
    handlers: RealtimePresenceHandlers
): Promise<boolean> {
    const parts = getRealtimePresenceMessageParts(message);
    if (!parts) {
        return false;
    }

    const { type, content } = parts;
    if (notificationEventTypes.has(type)) {
        if (typeof handlers.notification !== 'function') {
            return false;
        }
        return handlers.notification(type, content);
    }

    if (typeof handlers.default !== 'function') {
        return false;
    }
    return handlers.default(content, type);
}

export { dispatchRealtimePresenceMessage, getRealtimePresenceMessageParts };
