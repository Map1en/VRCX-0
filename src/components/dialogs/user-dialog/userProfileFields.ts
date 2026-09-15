import type { UserStatus } from '@/platform/tauri/bindings';
import { normalizeUserStatus } from '@/shared/utils/friendStatus';

export const statusPresetsConfigKey = 'VRCX_statusPresets';
export const maxStatusPresets = 10;
export type SocialStatusPreset = {
    status: UserStatus | '';
    statusDescription?: string;
};
export const selfStatusBaseOptions = [
    { value: 'join me', labelKey: 'dialog.user.status.join_me' },
    { value: 'active', labelKey: 'dialog.user.status.online' },
    { value: 'ask me', labelKey: 'dialog.user.status.ask_me' },
    { value: 'busy', labelKey: 'dialog.user.status.busy' }
] satisfies ReadonlyArray<{ value: UserStatus; labelKey: string }>;

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

export function normalizeSelfStatusInput(value: unknown): UserStatus | '' {
    const normalized = normalizeUserStatus(value);
    if (
        normalized === 'active' ||
        normalized === 'join me' ||
        normalized === 'ask me' ||
        normalized === 'busy' ||
        normalized === 'offline'
    ) {
        return normalized;
    }
    return '';
}

export function normalizeSocialStatusPreset(
    value: unknown
): SocialStatusPreset {
    const preset = record(value);
    return {
        status: normalizeSelfStatusInput(preset.status),
        ...(Object.prototype.hasOwnProperty.call(preset, 'statusDescription')
            ? { statusDescription: String(preset.statusDescription || '') }
            : null)
    };
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
