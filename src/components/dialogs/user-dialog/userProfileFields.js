import { languageMappings } from '@/shared/constants/language.js';

export const statusPresetsConfigKey = 'VRCX_statusPresets';
export const maxStatusPresets = 10;
export const selfStatusBaseOptions = [
    { value: 'join me', label: 'Join Me' },
    { value: 'active', label: 'Online' },
    { value: 'ask me', label: 'Ask Me' },
    { value: 'busy', label: 'Busy' }
];

const allowedSelfStatuses = new Set([
    'active',
    'join me',
    'ask me',
    'busy',
    'offline'
]);

export function normalizeUserId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function buildFavoriteIdSet(remoteFavoriteIds, localFriendFavorites) {
    const set = new Set();

    for (const id of remoteFavoriteIds ?? []) {
        const normalized = normalizeUserId(id);
        if (normalized) {
            set.add(normalized);
        }
    }

    for (const values of Object.values(localFriendFavorites ?? {})) {
        if (!Array.isArray(values)) {
            continue;
        }

        for (const id of values) {
            const normalized = normalizeUserId(id);
            if (normalized) {
                set.add(normalized);
            }
        }
    }

    return set;
}

export function normalizeSelfStatusInput(value) {
    const normalized = normalizeUserId(value).toLowerCase();
    if (normalized === 'joinme') {
        return 'join me';
    }
    if (normalized === 'askme') {
        return 'ask me';
    }
    if (allowedSelfStatuses.has(normalized)) {
        return normalized;
    }
    return '';
}

export function normalizeLanguageKey(value) {
    return normalizeUserId(value)
        .toLowerCase()
        .replace(/^language_/, '');
}

export function languageFlagClassName(languageKey) {
    const key = normalizeLanguageKey(languageKey);
    return languageMappings[key] || key || 'unknown';
}

export function languageDisplayName(option) {
    const key = normalizeLanguageKey(option?.key || option?.value);
    return normalizeUserId(
        option?.value || option?.label || option?.name || key.toUpperCase()
    );
}

export function languageOptionLabel(option) {
    const key = normalizeLanguageKey(option?.key || option?.value);
    const value = languageDisplayName(option);
    return key ? `${value || key.toUpperCase()} (${key.toUpperCase()})` : value;
}

export function fallbackLanguageOptions() {
    return Object.keys(languageMappings)
        .sort()
        .map((key) => ({ key, value: key.toUpperCase() }));
}

export function normalizeLanguageOptionsFromConfig(json) {
    const options = json?.constants?.LANGUAGE?.SPOKEN_LANGUAGE_OPTIONS;
    if (!options || typeof options !== 'object') {
        return [];
    }

    return Object.entries(options)
        .map(([key, value]) => ({
            key: normalizeLanguageKey(key),
            value: normalizeUserId(value)
        }))
        .filter((option) => option.key && option.value)
        .sort((left, right) => left.value.localeCompare(right.value));
}

export function normalizeProfileLanguageRows(
    profile,
    languageOptionMap = new Map()
) {
    const rows = [];
    const seen = new Set();
    const addRow = (entry) => {
        const key = normalizeLanguageKey(
            typeof entry === 'string'
                ? entry
                : entry?.key ||
                      entry?.id ||
                      entry?.value ||
                      entry?.label ||
                      entry?.name
        );
        if (!key || seen.has(key)) {
            return;
        }
        const option = languageOptionMap.get(key);
        rows.push({
            key,
            value: normalizeUserId(
                option?.value ||
                    entry?.value ||
                    entry?.label ||
                    entry?.name ||
                    key.toUpperCase()
            )
        });
        seen.add(key);
    };

    if (Array.isArray(profile?.$languages)) {
        profile.$languages.forEach(addRow);
    }
    if (Array.isArray(profile?.languages)) {
        profile.languages.forEach(addRow);
    }
    if (Array.isArray(profile?.tags)) {
        profile.tags.forEach((tag) => {
            const normalizedTag = normalizeUserId(tag).toLowerCase();
            if (normalizedTag.startsWith('language_')) {
                addRow(normalizedTag);
            }
        });
    }

    return rows;
}

export function normalizeStatusHistoryRows(profile, currentUserSnapshot) {
    const source = Array.isArray(profile?.statusHistory)
        ? profile.statusHistory
        : Array.isArray(currentUserSnapshot?.statusHistory)
          ? currentUserSnapshot.statusHistory
          : [];
    const seen = new Set();
    return source
        .map((item) =>
            normalizeUserId(
                typeof item === 'string'
                    ? item
                    : item?.status || item?.statusDescription
            )
        )
        .filter((status) => {
            if (!status || seen.has(status)) {
                return false;
            }
            seen.add(status);
            return true;
        })
        .slice(0, maxStatusPresets);
}
