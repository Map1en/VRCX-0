export const FRIENDS_LOCATIONS_SEGMENTS = [
    { value: 'online', labelKey: 'view.friends_locations.online' },
    { value: 'favorite', labelKey: 'view.friends_locations.favorite' },
    { value: 'same-instance', labelKey: 'view.friends_locations.same_instance' },
    { value: 'active', labelKey: 'view.friends_locations.active' },
    { value: 'offline', labelKey: 'view.friends_locations.offline' }
];

export function safeJsonParse(value, fallback) {
    if (!value) {
        return fallback;
    }

    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

export function parseConfigArray(value) {
    const parsed = Array.isArray(value) ? value : safeJsonParse(value, []);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
}
