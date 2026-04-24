const notificationEventTypes = new Set([
    'notification',
    'notification-v2',
    'notification-v2-delete',
    'notification-v2-update',
    'see-notification',
    'hide-notification',
    'response-notification'
]);

function getRealtimePresenceMessageParts(message) {
    const type = typeof message?.type === 'string' ? message.type : '';
    const content =
        message?.content && typeof message.content === 'object'
            ? message.content
            : null;

    if (!type || !content) {
        return null;
    }

    return { type, content };
}

async function dispatchRealtimePresenceMessage(message, handlers) {
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
