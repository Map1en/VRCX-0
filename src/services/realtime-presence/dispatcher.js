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
        return handlers.notification(type, content);
    }

    const handler = handlers[type] ?? handlers.default;
    if (typeof handler !== 'function') {
        return false;
    }
    return handler(content, type);
}

export { dispatchRealtimePresenceMessage, getRealtimePresenceMessageParts };
