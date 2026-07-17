import { useMemo } from 'react';

import {
    normalizeEndpoint,
    normalizeUserId,
    userFactKey,
    type UserFact
} from '@/domain/users/userFacts';
import { getKnownUserFact } from '@/services/userFactAccessService';
import {
    useRuntimeStore,
    type CurrentUserSnapshotState
} from '@/state/runtimeStore';
import { useUserFactsStore } from '@/state/userFactsStore';

interface UseKnownUserOptions {
    endpoint?: unknown;
}

function normalizeUserIdList(userIds: unknown): string[] {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const value of Array.isArray(userIds) ? userIds : []) {
        const userId = normalizeUserId(value);
        if (!userId || seen.has(userId)) {
            continue;
        }
        seen.add(userId);
        ids.push(userId);
    }
    return ids;
}

function currentSnapshotToUserFact(
    snapshot: CurrentUserSnapshotState | null | undefined,
    userId: unknown,
    endpoint: unknown
): UserFact | null {
    if (!snapshot) {
        return null;
    }
    const normalizedUserId = normalizeUserId(snapshot.id || userId);
    if (!normalizedUserId) {
        return null;
    }
    return {
        ...snapshot,
        id: normalizedUserId,
        endpoint: normalizeEndpoint(snapshot.endpoint || endpoint),
        updatedAt:
            typeof snapshot.updatedAt === 'string' ? snapshot.updatedAt : ''
    };
}

function useKnownUserFact(userId: unknown, options: UseKnownUserOptions = {}) {
    const storeEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const endpoint = normalizeEndpoint(options.endpoint || storeEndpoint);
    const normalizedUserId = normalizeUserId(userId);
    const key = useMemo(
        () => userFactKey(endpoint, normalizedUserId),
        [endpoint, normalizedUserId]
    );
    const fact = useUserFactsStore((state) =>
        key ? state.usersByKey[key] || null : null
    );
    const currentUserSnapshot = useRuntimeStore((state) =>
        normalizedUserId && normalizedUserId === currentUserId
            ? state.auth.currentUserSnapshot
            : null
    );
    return (
        currentSnapshotToUserFact(
            currentUserSnapshot,
            normalizedUserId,
            endpoint
        ) || fact
    );
}

function useKnownUserFacts(
    userIds: unknown,
    options: UseKnownUserOptions = {}
) {
    const storeEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const endpoint = normalizeEndpoint(options.endpoint || storeEndpoint);
    const version = useUserFactsStore((state) => state.version);
    const normalizedUserIds = useMemo(
        () => normalizeUserIdList(userIds),
        [userIds]
    );

    return useMemo(() => {
        const usersById: Record<string, UserFact> = {};
        for (const userId of normalizedUserIds) {
            if (userId === currentUserId && currentUserSnapshot) {
                const currentUserFact = currentSnapshotToUserFact(
                    currentUserSnapshot,
                    userId,
                    endpoint
                );
                if (currentUserFact) {
                    usersById[userId] = currentUserFact;
                }
                continue;
            }
            const fact = getKnownUserFact(endpoint, userId);
            if (fact) {
                usersById[userId] = fact;
            }
        }
        return usersById;
    }, [
        endpoint,
        normalizedUserIds,
        version,
        currentUserId,
        currentUserSnapshot
    ]);
}

export { useKnownUserFact, useKnownUserFacts };
