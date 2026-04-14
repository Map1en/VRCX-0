export function asString(value, fallback = '') {
    if (value === null || value === undefined) {
        return fallback;
    }
    return String(value);
}

export function safeJsonParse(value, fallback = null) {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }

    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

export function safeJsonStringify(value, fallback = 'null') {
    try {
        return JSON.stringify(value);
    } catch {
        return fallback;
    }
}

export function createKeyPrefixer(prefix) {
    return (key) => `${prefix}${key}`;
}
