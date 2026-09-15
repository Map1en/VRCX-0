import {
    normalizeEndpoint,
    normalizeUserId,
    userFactKey,
    type UserFact,
    type UserFactMergeOptions
} from '@/domain/users/userFacts';
import { commands } from '@/platform/tauri/bindings';
import { isRecord } from '@/shared/utils/record';
import { useUserFactsStore } from '@/state/userFactsStore';

type UserFactIngestEntry = {
    user: Record<string, unknown>;
    source?: string;
    isFriend?: boolean;
    isCurrentUser?: boolean;
};

const pendingUserFactEntries = new Map<string, UserFactIngestEntry>();
let userFactFlushScheduled = false;

function asRecord(value: unknown): Record<string, unknown> | null {
    return isRecord(value) ? value : null;
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

function getKnownUserFact(endpoint: string, userId: string): UserFact | null {
    const key = userFactKey(endpoint, userId);
    return key ? useUserFactsStore.getState().usersByKey[key] || null : null;
}

function ingestUserFactEntries(entries: UserFactIngestEntry[]): void {
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
    for (const entry of valid) {
        const userId = userIdFromRecord(entry.user);
        const key = [
            userId,
            entry.source || '',
            entry.isFriend === true ? 'friend' : '',
            entry.isCurrentUser === true ? 'current' : ''
        ].join('\u0000');
        const existing = pendingUserFactEntries.get(key);
        pendingUserFactEntries.set(key, {
            ...existing,
            ...entry,
            user: mergeUserFactInput(existing?.user, entry.user, userId)
        });
    }
    if (!userFactFlushScheduled) {
        userFactFlushScheduled = true;
        queueMicrotask(() => {
            void flushPendingUserFactEntries();
        });
    }
}

function mergeUserFactInput(
    existing: Record<string, unknown> | undefined,
    incoming: Record<string, unknown>,
    userId: string
): Record<string, unknown> {
    const merged = { ...existing };
    for (const [field, value] of Object.entries(incoming)) {
        if (
            value === null ||
            value === undefined ||
            (typeof value === 'string' && !value.trim()) ||
            (Array.isArray(value) &&
                value.length === 0 &&
                Object.hasOwn(merged, field))
        ) {
            continue;
        }
        merged[field] = value;
    }
    merged.id = userId;
    return merged;
}

async function flushPendingUserFactEntries(): Promise<void> {
    userFactFlushScheduled = false;
    const entries = Array.from(pendingUserFactEntries.values());
    pendingUserFactEntries.clear();
    if (!entries.length) {
        return;
    }
    await commands.appIngestUserFacts(entries).catch((error) => {
        console.warn('Failed to ingest user facts:', error);
    });
}

function resetPendingUserFactEntries(): void {
    pendingUserFactEntries.clear();
    userFactFlushScheduled = false;
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
            isCurrentUser: Boolean(options.isCurrentUser)
        }
    ]);

    return getKnownUserFact(endpoint, id);
}

export {
    getKnownUserFact,
    flushPendingUserFactEntries,
    ingestUserFactEntries,
    normalizeEndpoint,
    normalizeUserId,
    recordUserProfile,
    resetPendingUserFactEntries
};
