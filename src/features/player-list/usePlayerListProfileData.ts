import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { queryKeys } from '@/lib/entityQueryCache';
import { useKnownUserFacts } from '@/lib/useKnownUser';
import userProfileRepository from '@/repositories/userProfileRepository';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import vrchatFriendRepository from '@/repositories/vrchatFriendRepository';
import { normalizeString } from '@/shared/utils/string';
import { normalizeLanguageOptionsFromConfig } from '@/shared/utils/userLanguage';

import { resolvePlayerRowUserId } from './playerListRows';
import type {
    PlayerListProfileRecord,
    PlayerListSourceRow
} from './playerListTypes';

type LanguageOption = { key: string; value: string };
type ProfileQueryResult = { data?: unknown };

function buildPlayerProfileIds(
    playerRows: readonly PlayerListSourceRow[],
    currentUserId: unknown
) {
    const currentUserKey = normalizeString(currentUserId);
    const ids: string[] = [];
    const seen = new Set<string>();

    for (const row of Array.isArray(playerRows) ? playerRows : []) {
        const userId = resolvePlayerRowUserId(row);
        if (!userId || userId === currentUserKey || seen.has(userId)) {
            continue;
        }
        seen.add(userId);
        ids.push(userId);
    }

    return ids;
}

function mapProfileQueryResults(
    userIds: readonly string[],
    results: readonly ProfileQueryResult[]
) {
    const profilesByUserId: Record<string, PlayerListProfileRecord> = {};

    for (const [index, result] of results.entries()) {
        if (!result.data) {
            continue;
        }

        const profile = userProfileRepository.normalize(
            result.data
        ) as PlayerListProfileRecord | null;
        const userId = normalizeString(profile?.id || userIds[index]);
        if (userId && profile) {
            profilesByUserId[userId] = profile;
        }
    }

    return profilesByUserId;
}

export function usePlayerListProfileData({
    currentUserEndpoint,
    currentUserId,
    playerSourceRows
}: {
    currentUserEndpoint?: string;
    currentUserId?: unknown;
    playerSourceRows: PlayerListSourceRow[];
}) {
    const [languageOptions, setLanguageOptions] = useState<LanguageOption[]>(
        []
    );

    useEffect(() => {
        let active = true;
        setLanguageOptions([]);

        vrchatAuthRepository
            .getConfig({ endpoint: currentUserEndpoint })
            .then((response) => {
                if (!active) {
                    return;
                }

                setLanguageOptions(
                    normalizeLanguageOptionsFromConfig(response.json)
                );
            })
            .catch(() => {
                if (active) {
                    setLanguageOptions([]);
                }
            });

        return () => {
            active = false;
        };
    }, [currentUserEndpoint]);

    const languageOptionsMap = useMemo(
        () => new Map(languageOptions.map((option) => [option.key, option])),
        [languageOptions]
    );
    const playerProfileIds = useMemo(
        () => buildPlayerProfileIds(playerSourceRows, currentUserId),
        [currentUserId, playerSourceRows]
    );
    const knownUsersById = useKnownUserFacts(playerProfileIds, {
        endpoint: currentUserEndpoint
    });
    const profilesByUserId = useQueries({
        queries: playerProfileIds.map((userId) => {
            return {
                enabled: Boolean(userId),
                gcTime: 300_000,
                queryFn: async () => {
                    const response = await vrchatFriendRepository.getUser({
                        endpoint: currentUserEndpoint,
                        userId,
                        isFriend: Boolean(knownUsersById[userId]?.isFriend)
                    });
                    const profile = userProfileRepository.normalize(
                        response.json
                    );
                    return profile;
                },
                queryKey: queryKeys.user(userId, currentUserEndpoint),
                refetchOnWindowFocus: false,
                retry: 1,
                staleTime: 0
            };
        }),
        combine: (results: ProfileQueryResult[]) =>
            mapProfileQueryResults(playerProfileIds, results)
    });

    return {
        knownUsersById,
        languageOptionsMap,
        profilesByUserId
    };
}
