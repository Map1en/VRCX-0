export const statusPresetsConfigKey = 'VRCX_statusPresets';
export const maxStatusPresets = 10;
export const selfStatusBaseOptions = [
    { value: 'join me', labelKey: 'dialog.user.status.join_me' },
    { value: 'active', labelKey: 'dialog.user.status.online' },
    { value: 'ask me', labelKey: 'dialog.user.status.ask_me' },
    { value: 'busy', labelKey: 'view.friends_locations.busy' }
];

const allowedSelfStatuses = new Set([
    'active',
    'join me',
    'ask me',
    'busy',
    'offline'
]);

export {
    fallbackLanguageOptions,
    languageDisplayName,
    languageOptionLabel,
    normalizeLanguageKey,
    normalizeLanguageOptionsFromConfig,
    normalizeProfileLanguageRows
} from '@/shared/utils/userLanguage';

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value))
        : {};
}

export function normalizeUserId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function buildFavoriteIdSet(
    remoteFavoriteIds: unknown,
    localFriendFavorites: unknown
) {
    const set = new Set<string>();

    for (const id of Array.isArray(remoteFavoriteIds)
        ? remoteFavoriteIds
        : []) {
        const normalized = normalizeUserId(id);
        if (normalized) {
            set.add(normalized);
        }
    }

    for (const values of Object.values(record(localFriendFavorites))) {
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

export function normalizeSelfStatusInput(value: unknown) {
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

export function normalizeStatusHistoryRows(
    profileSource: unknown,
    currentUserSnapshotSource: unknown
) {
    const profile = record(profileSource);
    const currentUserSnapshot = record(currentUserSnapshotSource);
    const source = Array.isArray(profile.statusHistory)
        ? profile.statusHistory
        : Array.isArray(currentUserSnapshot.statusHistory)
          ? currentUserSnapshot.statusHistory
          : [];
    const seen = new Set();
    return source
        .map((item) => {
            const statusEntry = record(item);
            return normalizeUserId(
                typeof item === 'string'
                    ? item
                    : statusEntry.status || statusEntry.statusDescription
            );
        })
        .filter((status) => {
            if (!status || seen.has(status)) {
                return false;
            }
            seen.add(status);
            return true;
        })
        .slice(0, maxStatusPresets);
}
