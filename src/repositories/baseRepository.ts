export function asString(value: unknown, fallback: string = ''): string {
    if (value === null || value === undefined) {
        return fallback;
    }
    return String(value);
}

export function safeJsonStringify(
    value: unknown,
    fallback: string = 'null'
): string {
    try {
        return JSON.stringify(value);
    } catch {
        return fallback;
    }
}
