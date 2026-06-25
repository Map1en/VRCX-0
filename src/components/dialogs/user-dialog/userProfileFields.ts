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

export function normalizeUserId(value: any) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function buildFavoriteIdSet(
    remoteFavoriteIds: any,
    localFriendFavorites: any
) {
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

export function normalizeSelfStatusInput(value: any) {
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
    profile: any,
    currentUserSnapshot: any
) {
    const source = Array.isArray(profile?.statusHistory)
        ? profile.statusHistory
        : Array.isArray(currentUserSnapshot?.statusHistory)
          ? currentUserSnapshot.statusHistory
          : [];
    const seen = new Set();
    return source
        .map((item: any) =>
            normalizeUserId(
                typeof item === 'string'
                    ? item
                    : item?.status || item?.statusDescription
            )
        )
        .filter((status: any) => {
            if (!status || seen.has(status)) {
                return false;
            }
            seen.add(status);
            return true;
        })
        .slice(0, maxStatusPresets);
}
