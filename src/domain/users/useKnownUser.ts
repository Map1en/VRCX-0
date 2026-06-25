import { useMemo } from 'react';

import { useRuntimeStore } from '@/state/runtimeStore';
import { useUserFactsStore } from '@/state/userFactsStore';

import { getKnownUserFact } from './userFactAccess';
import {
    normalizeEndpoint,
    normalizeUserId,
    userFactKey,
    type UserFact
} from './userFacts';

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

function useKnownUserFact(userId: unknown, options: UseKnownUserOptions = {}) {
    const storeEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const endpoint = normalizeEndpoint(options.endpoint || storeEndpoint);
    const normalizedUserId = normalizeUserId(userId);
    const key = useMemo(
        () => userFactKey(endpoint, normalizedUserId),
        [endpoint, normalizedUserId]
    );
    const fact = useUserFactsStore((state: any) =>
        key ? state.usersByKey[key] || null : null
    );
    const currentUserSnapshot = useRuntimeStore((state: any) =>
        normalizedUserId && normalizedUserId === currentUserId
            ? state.auth.currentUserSnapshot
            : null
    );
    return currentUserSnapshot || fact;
}

function useKnownUserFacts(
    userIds: unknown,
    options: UseKnownUserOptions = {}
) {
    const storeEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentUserSnapshot = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );
    const endpoint = normalizeEndpoint(options.endpoint || storeEndpoint);
    const version = useUserFactsStore((state: any) => state.version);
    const normalizedUserIds = useMemo(
        () => normalizeUserIdList(userIds),
        [userIds]
    );

    return useMemo(() => {
        const usersById: Record<string, UserFact> = {};
        for (const userId of normalizedUserIds) {
            if (userId === currentUserId && currentUserSnapshot) {
                usersById[userId] = currentUserSnapshot;
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
