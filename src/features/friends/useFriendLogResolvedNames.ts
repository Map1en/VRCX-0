import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { commands } from '@/platform/tauri/bindings';
import { getKnownUserFact } from '@/services/userFactAccessService';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    normalizeUserId,
    resolveDisplayNameCandidate,
    type FriendLogRow,
    UNKNOWN_FRIEND_LOG_DISPLAY_NAME
} from './friendLogRows';

const LOOKUP_LIMIT = 100;

type ResolveDisplayName = (row: FriendLogRow) => string;

export function useFriendLogResolvedNames(
    currentUserId: string | null,
    rows: FriendLogRow[]
): ResolveDisplayName {
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const missingNameUserIds = useMemo(() => {
        const userIds = new Set<string>();
        for (const row of rows) {
            const userId = normalizeUserId(row.userId);
            if (
                userId &&
                !resolveDisplayNameCandidate(row.displayName, userId)
            ) {
                userIds.add(userId);
            }
        }
        return [...userIds];
    }, [rows]);
    const rosterNamesById = useFriendRosterStore(
        useShallow((state) => {
            const names: Record<string, string> = {};
            for (const userId of missingNameUserIds) {
                names[userId] = resolveDisplayNameCandidate(
                    state.friendsById[userId]?.displayName,
                    userId
                );
            }
            return names;
        })
    );
    const [namesById, setNamesById] = useState<Record<string, string>>({});
    const attemptedRef = useRef<Set<string>>(new Set());

    const resolveSyncName = useCallback(
        (userId: string, rowDisplayName: string) => {
            const own = resolveDisplayNameCandidate(rowDisplayName, userId);
            if (own) {
                return own;
            }
            const rosterName = rosterNamesById[userId];
            if (rosterName) {
                return rosterName;
            }
            const fact = getKnownUserFact(endpoint, userId);
            return resolveDisplayNameCandidate(fact?.displayName, userId);
        },
        [rosterNamesById, endpoint]
    );

    useEffect(() => {
        attemptedRef.current = new Set();
        setNamesById({});
    }, [currentUserId, endpoint]);

    const missingKey = useMemo(() => {
        if (!normalizeUserId(currentUserId)) {
            return '';
        }
        const missing: string[] = [];
        const seen = new Set<string>();
        for (const row of rows) {
            const userId = normalizeUserId(row?.userId);
            if (
                !userId ||
                seen.has(userId) ||
                attemptedRef.current.has(userId)
            ) {
                continue;
            }
            if (resolveSyncName(userId, row.displayName) || namesById[userId]) {
                continue;
            }
            seen.add(userId);
            missing.push(userId);
            if (missing.length >= LOOKUP_LIMIT) {
                break;
            }
        }
        return missing.join('\n');
    }, [currentUserId, rows, namesById, resolveSyncName]);

    useEffect(() => {
        if (!missingKey) {
            return undefined;
        }
        const missing = missingKey.split('\n');
        for (const userId of missing) {
            attemptedRef.current.add(userId);
        }

        const requestId = crypto.randomUUID();
        let active = true;
        let settled = false;
        void commands
            .appFriendLogNamesResolve({
                requestId,
                userIds: missing
            })
            .then((rows) => {
                if (!active) {
                    return;
                }
                const resolved: Record<string, string> = {};
                for (const row of rows) {
                    resolved[row.userId] = row.displayName;
                }
                if (Object.keys(resolved).length > 0) {
                    setNamesById((current) => ({ ...current, ...resolved }));
                }
            })
            .catch(() => {
                for (const userId of missing) {
                    attemptedRef.current.delete(userId);
                }
            })
            .finally(() => {
                settled = true;
            });
        return () => {
            active = false;
            if (!settled) {
                for (const userId of missing) {
                    attemptedRef.current.delete(userId);
                }
                void commands.appFriendLogNamesCancel(requestId);
            }
        };
    }, [missingKey]);

    return useCallback(
        (row: FriendLogRow) => {
            const userId = normalizeUserId(row?.userId);
            const sync = resolveSyncName(userId, row.displayName);
            if (sync) {
                return sync;
            }
            if (userId && namesById[userId]) {
                return namesById[userId];
            }
            return UNKNOWN_FRIEND_LOG_DISPLAY_NAME;
        },
        [resolveSyncName, namesById]
    );
}
