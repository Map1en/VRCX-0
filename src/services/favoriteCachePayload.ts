import type { JsonValue } from '@/platform/tauri/bindings';

export type FavoriteCachePayload = { [key: string]: JsonValue };

function isJsonValue(value: unknown): value is JsonValue {
    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return true;
    }
    if (Array.isArray(value)) {
        return value.every(isJsonValue);
    }
    return Boolean(
        value &&
        typeof value === 'object' &&
        Object.values(value).every(isJsonValue)
    );
}

export function favoriteCachePayload(
    value: unknown
): FavoriteCachePayload | null {
    return isJsonValue(value) && value !== null && !Array.isArray(value)
        ? value
        : null;
}

export function normalizeFavoriteCacheEntityId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}
