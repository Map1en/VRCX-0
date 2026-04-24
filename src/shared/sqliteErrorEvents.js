const sqliteErrorListeners = new Set();

export function subscribeSQLiteError(listener) {
    if (typeof listener !== 'function') {
        return () => {};
    }
    sqliteErrorListeners.add(listener);
    return () => {
        sqliteErrorListeners.delete(listener);
    };
}

export function notifySQLiteError(error) {
    for (const listener of sqliteErrorListeners) {
        try {
            listener(error);
        } catch (listenerError) {
            console.warn('SQLite error listener failed:', listenerError);
        }
    }
}
