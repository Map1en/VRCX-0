import { isRecord } from '@/shared/utils/record';
const PREFERENCE_CHANGED_EVENT = 'vrcx:preference-changed';

type PreferenceChangedValue =
    | string
    | number
    | boolean
    | object
    | null
    | undefined;

type PreferenceChangedDetail = {
    key?: string;
    normalizedKey?: string;
    value?: PreferenceChangedValue;
};

type PreferenceChangedCallback = (
    value: PreferenceChangedValue,
    detail: PreferenceChangedDetail
) => void;

export function normalizePreferenceKey(key: unknown): string {
    const normalized = String(key ?? '');
    return normalized.startsWith('VRCX_') ? normalized.slice(5) : normalized;
}

export function publishPreferenceChanged(
    key: string,
    value: PreferenceChangedValue
) {
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

function preferenceChangedValue(value: unknown): PreferenceChangedValue {
    return value === null ||
        typeof value === 'undefined' ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'object'
        ? value
        : undefined;
}

export function onPreferenceChanged(
    keys: string | readonly string[],
    callback: PreferenceChangedCallback
) {
    if (typeof window === 'undefined') {
        return () => {};
    }
    const keySet = new Set(
        (Array.isArray(keys) ? keys : [keys]).map(normalizePreferenceKey)
    );
    const handler = (event: Event) => {
        const detailValue = 'detail' in event ? event.detail : undefined;
        const detail: PreferenceChangedDetail = isRecord(detailValue)
            ? {
                  key:
                      typeof detailValue.key === 'string'
                          ? detailValue.key
                          : undefined,
                  normalizedKey:
                      typeof detailValue.normalizedKey === 'string'
                          ? detailValue.normalizedKey
                          : undefined,
                  value: preferenceChangedValue(detailValue.value)
              }
            : {};
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
