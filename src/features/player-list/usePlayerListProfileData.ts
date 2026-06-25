import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { useKnownUserFacts } from '@/domain/users/useKnownUser';
import { queryKeys } from '@/lib/entityQueryCache';
import userProfileRepository from '@/repositories/userProfileRepository';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import vrchatFriendRepository from '@/repositories/vrchatFriendRepository';
import { normalizeString } from '@/shared/utils/string';
import { normalizeLanguageOptionsFromConfig } from '@/shared/utils/userLanguage';

import { resolvePlayerRowUserId } from './playerListRows';

function buildPlayerProfileIds(playerRows: any, currentUserId: any) {
    const currentUserKey = normalizeString(currentUserId);
    const ids = [];
    const seen = new Set();

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

function mapProfileQueryResults(userIds: any, results: any) {
    const profilesByUserId: any = {};

    for (const [index, result] of results.entries()) {
        if (!result.data) {
            continue;
        }

        const profile = userProfileRepository.normalize(result.data);
        const userId = normalizeString(profile?.id || userIds[index]);
        if (userId) {
            profilesByUserId[userId] = profile;
        }
    }

    return profilesByUserId;
}

export function usePlayerListProfileData({
    currentUserEndpoint,
    currentUserId,
    playerSourceRows
}: any) {
    const [languageOptions, setLanguageOptions] = useState<any[]>([]);

    useEffect(() => {
        let active = true;
        setLanguageOptions([]);

        vrchatAuthRepository
            .getConfig({ endpoint: currentUserEndpoint })
            .then((response: any) => {
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
        () =>
            new Map(languageOptions.map((option: any) => [option.key, option])),
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
        queries: playerProfileIds.map((userId: any) => {
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
        combine: (results: any) =>
            mapProfileQueryResults(playerProfileIds, results)
    });

    return {
        knownUsersById,
        languageOptionsMap,
        profilesByUserId
    };
}
