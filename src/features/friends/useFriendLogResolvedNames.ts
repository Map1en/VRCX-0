import { useCallback, useEffect, useRef, useState } from 'react';

import friendLogRepository from '@/repositories/friendLogRepository';
import gameLogRepository from '@/repositories/gameLogRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import { getKnownUserFact } from '@/services/userFactAccessService';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    normalizeUserId,
    resolveDisplayNameCandidate,
    type FriendLogRow,
    UNKNOWN_FRIEND_LOG_DISPLAY_NAME
} from './friendLogRows';

const GAME_LOG_LOOKUP_LIMIT = 100;
const API_LOOKUP_LIMIT = 30;

type ResolveDisplayName = (row: FriendLogRow) => string;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

export function useFriendLogResolvedNames(
    currentUserId: unknown,
    rows: FriendLogRow[]
): ResolveDisplayName {
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const friendRosterLastLoadedAt = useFriendRosterStore(
        (state) => state.lastLoadedAt
    );
    const [namesById, setNamesById] = useState<Record<string, string>>({});
    const attemptedRef = useRef<Set<string>>(new Set());

    const resolveSyncName = useCallback(
        (userId: string, rowDisplayName: unknown) => {
            const own = resolveDisplayNameCandidate(rowDisplayName, userId);
            if (own) {
                return own;
            }
            const rosterName = resolveDisplayNameCandidate(
                friendsById[userId]?.displayName,
                userId
            );
            if (rosterName) {
                return rosterName;
            }
            const fact = getKnownUserFact(endpoint, userId);
            return resolveDisplayNameCandidate(fact?.displayName, userId);
        },
        [friendsById, endpoint]
    );

    useEffect(() => {
        const normalizedCurrentUserId = normalizeUserId(currentUserId);
        if (!normalizedCurrentUserId) {
            attemptedRef.current = new Set();
            setNamesById({});
            return undefined;
        }
        let active = true;
        friendLogRepository
            .getFriendLogCurrent(normalizedCurrentUserId)
            .then((entries) => {
                if (!active) {
                    return;
                }
                setNamesById((current) => {
                    let changed = false;
                    const next = { ...current };
                    for (const entry of entries) {
                        const userId = normalizeUserId(entry?.userId);
                        const displayName = resolveDisplayNameCandidate(
                            entry?.displayName,
                            userId
                        );
                        if (
                            userId &&
                            displayName &&
                            next[userId] !== displayName
                        ) {
                            next[userId] = displayName;
                            changed = true;
                        }
                    }
                    return changed ? next : current;
                });
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [currentUserId, friendRosterLastLoadedAt]);

    useEffect(() => {
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
            if (
                resolveSyncName(userId, row?.displayName) ||
                namesById[userId]
            ) {
                continue;
            }
            seen.add(userId);
            missing.push(userId);
            if (missing.length >= GAME_LOG_LOOKUP_LIMIT) {
                break;
            }
        }
        if (missing.length === 0) {
            return undefined;
        }
        for (const userId of missing) {
            attemptedRef.current.add(userId);
        }

        let active = true;
        void (async () => {
            const resolved: Record<string, string> = {};
            try {
                const statsRows = await gameLogRepository.getAllUserStats({
                    userIds: missing
                });
                for (const row of Array.isArray(statsRows) ? statsRows : []) {
                    const record = isRecord(row) ? row : {};
                    const userId = normalizeUserId(record.userId);
                    const displayName = resolveDisplayNameCandidate(
                        record.displayName,
                        userId
                    );
                    if (userId && displayName) {
                        resolved[userId] = displayName;
                    }
                }
            } catch {}

            const apiTargets = missing
                .filter((userId) => !resolved[userId])
                .slice(0, API_LOOKUP_LIMIT);
            for (const userId of apiTargets) {
                if (!active) {
                    return;
                }
                try {
                    const profile = await userProfileRepository.getUserProfile({
                        userId,
                        endpoint
                    });
                    const displayName = resolveDisplayNameCandidate(
                        profile?.displayName,
                        userId
                    );
                    if (displayName) {
                        resolved[userId] = displayName;
                    }
                } catch {}
            }

            if (!active || Object.keys(resolved).length === 0) {
                return;
            }
            setNamesById((current) => ({ ...current, ...resolved }));
        })();
        return () => {
            active = false;
        };
    }, [rows, namesById, resolveSyncName, endpoint]);

    return useCallback(
        (row: FriendLogRow) => {
            const userId = normalizeUserId(row?.userId);
            const sync = resolveSyncName(userId, row?.displayName);
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
