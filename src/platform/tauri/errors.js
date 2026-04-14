export class PlatformUnavailableError extends Error {
    constructor(message = 'Tauri platform APIs are unavailable in this runtime') {
        super(message);
        this.name = 'PlatformUnavailableError';
    }
}

export function normalizePlatformError(error, fallbackMessage) {
    if (error instanceof Error) {
        return error;
    }

    return new Error(fallbackMessage ?? String(error));
}
