export class PlatformUnavailableError extends Error {
    constructor(message = 'Tauri platform APIs are unavailable in this runtime') {
        super(message);
        this.name = 'PlatformUnavailableError';
    }
}

export function normalizePlatformError(error, fallbackMessage) {
    const fallback = fallbackMessage || 'Platform command failed';
    if (error instanceof Error) {
        const details = error.message || String(error);
        if (!fallbackMessage || details === fallback || details.startsWith(`${fallback}:`)) {
            return error;
        }

        const normalizedError = new Error(details ? `${fallback}: ${details}` : fallback);
        normalizedError.name = error.name;
        normalizedError.cause = error;
        return normalizedError;
    }

    if (error === undefined || error === null) {
        return new Error(fallback);
    }

    const details =
        typeof error === 'string'
            ? error
            : (() => {
                try {
                    return JSON.stringify(error);
                } catch {
                    return String(error);
                }
            })();

    return new Error(details ? `${fallback}: ${details}` : fallback);
}
