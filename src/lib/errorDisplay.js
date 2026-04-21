const internalErrorPatterns = [
    /\bSQLite (?:query|non-query) failed\b/i,
    /\bBackend command failed\b/i,
    /\bDatabase error\b/i,
    /\bsqlite__execute(?:_non_query)?\b/i,
    /\bno such table\b/i
];

function normalizeErrorText(error) {
    if (typeof error === 'string') {
        return error.trim();
    }
    if (error instanceof Error) {
        return String(error.message || '').trim();
    }
    return String(error ?? '').trim();
}

export function isInternalErrorText(value) {
    const text = normalizeErrorText(value);
    return internalErrorPatterns.some((pattern) => pattern.test(text));
}

export function userFacingErrorMessage(error, fallbackMessage) {
    const fallback = String(fallbackMessage || 'This action failed.').trim();
    const text = normalizeErrorText(error);
    if (!text || isInternalErrorText(text)) {
        return fallback;
    }
    return text;
}
