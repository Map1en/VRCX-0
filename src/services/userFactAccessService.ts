import {
    normalizeEndpoint,
    normalizeUserId,
    userFactKey,
    type UserFact,
    type UserFactMergeOptions
} from '@/domain/users/userFacts';
import { commands } from '@/platform/tauri/bindings';
import { useUserFactsStore } from '@/state/userFactsStore';

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : null;
}

function userIdFromRecord(source: Record<string, unknown>): string {
    return normalizeUserId(
        source.id ||
            source.userId ||
            source.user_id ||
            source.targetUserId ||
            source.target_user_id
    );
}

function getKnownUserFact(endpoint: unknown, userId: unknown): UserFact | null {
    const key = userFactKey(endpoint, userId);
    return key ? useUserFactsStore.getState().usersByKey[key] || null : null;
}

function ingestUserFactEntries(
    entries: Array<{
        user: Record<string, unknown>;
        source?: string;
        isFriend?: boolean;
        isCurrentUser?: boolean;
        stateBucket?: string;
    }>
): void {
    const valid = entries.filter(
        (entry) =>
            entry &&
            entry.user &&
            typeof entry.user === 'object' &&
            userIdFromRecord(entry.user)
    );
    if (!valid.length) {
        return;
    }
    commands.appIngestUserFacts(valid).catch((error: unknown) => {
        console.warn('Failed to ingest user facts:', error);
    });
}

function recordUserProfile(
    profile: Record<string, unknown> | null | undefined,
    options: UserFactMergeOptions = {}
): UserFact | null {
    const source = asRecord(profile);
    if (!source) {
        return null;
    }

    const id = userIdFromRecord(source);
    if (!id) {
        return null;
    }

    const endpoint = normalizeEndpoint(options.endpoint);
    ingestUserFactEntries([
        {
            user: { ...source, id },
            source:
                typeof options.source === 'string' ? options.source : 'profile',
            isFriend: Boolean(options.isFriend),
            isCurrentUser: Boolean(options.isCurrentUser),
            stateBucket:
                typeof options.stateBucket === 'string'
                    ? options.stateBucket
                    : ''
        }
    ]);

    return getKnownUserFact(endpoint, id);
}

function recordUserProfiles(
    profiles: Array<Record<string, unknown> | null | undefined>,
    options: UserFactMergeOptions = {}
): void {
    for (const profile of Array.isArray(profiles) ? profiles : []) {
        recordUserProfile(profile, options);
    }
}

export {
    getKnownUserFact,
    ingestUserFactEntries,
    normalizeEndpoint,
    normalizeUserId,
    recordUserProfile,
    recordUserProfiles,
    userFactKey
};
