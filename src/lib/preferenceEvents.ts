export const PREFERENCE_CHANGED_EVENT = 'vrcx:preference-changed';

type PreferenceChangedDetail = {
    key?: unknown;
    normalizedKey?: unknown;
    value?: unknown;
};

type PreferenceChangedCallback = (
    value: unknown,
    detail: PreferenceChangedDetail
) => void;

export function normalizePreferenceKey(key: unknown): string {
    const normalized = String(key ?? '');
    return normalized.startsWith('VRCX_') ? normalized.slice(5) : normalized;
}

export function publishPreferenceChanged(key: unknown, value: unknown) {
    if (typeof window === 'undefined') {
        return;
    }
    window.dispatchEvent(
        new CustomEvent(PREFERENCE_CHANGED_EVENT, {
            detail: {
                key,
                normalizedKey: normalizePreferenceKey(key),
                value
            }
        })
    );
}

export function onPreferenceChanged(
    keys: unknown | readonly unknown[],
    callback: PreferenceChangedCallback
) {
    if (typeof window === 'undefined') {
        return () => {};
    }
    const keySet = new Set(
        (Array.isArray(keys) ? keys : [keys]).map(normalizePreferenceKey)
    );
    const handler = (event: Event) => {
        const detail =
            (event as CustomEvent<PreferenceChangedDetail>).detail || {};
        const normalizedKey = normalizePreferenceKey(
            detail.normalizedKey || detail.key
        );
        if (!keySet.has(normalizedKey)) {
            return;
        }
        callback(detail.value, detail);
    };
    window.addEventListener(PREFERENCE_CHANGED_EVENT, handler);
    return () => window.removeEventListener(PREFERENCE_CHANGED_EVENT, handler);
}
