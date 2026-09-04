import { useQueries } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { UserProfileRecord } from '@/domain/entities/user';
import { entityQueryPolicies, queryKeys } from '@/lib/entityQueryCache';
import { useKnownUserFacts } from '@/lib/useKnownUser';
import userProfileRepository from '@/repositories/userProfileRepository';
import vrchatFriendRepository from '@/repositories/vrchatFriendRepository';
import { normalizeString } from '@/shared/utils/string';
import { normalizeLanguageOptionsFromConfig } from '@/shared/utils/userLanguage';
import { useVrchatConfigStore } from '@/state/vrchatConfigStore';

import { resolvePlayerRowUserId } from './playerListRows';
import type {
    PlayerListProfileRecord,
    PlayerListSourceRow
} from './playerListTypes';

type ProfileQueryResult = { data?: UserProfileRecord };

function buildPlayerProfileIds(
    playerRows: readonly PlayerListSourceRow[],
    currentUserId: string | null | undefined
) {
    const currentUserKey = currentUserId ?? '';
    const ids: string[] = [];
    const seen = new Set<string>();

    for (const row of playerRows) {
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

        const profile = result.data;
        const userId = normalizeString(profile.id || userIds[index]);
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
}: {
    currentUserEndpoint?: string;
    currentUserId?: string | null;
    playerSourceRows: PlayerListSourceRow[];
}) {
    const vrchatConfig = useVrchatConfigStore((state) => state.snapshot);
    const languageOptionsMap = useMemo(
        () =>
            new Map(
                normalizeLanguageOptionsFromConfig(vrchatConfig).map(
                    (option) => [option.key, option] as const
                )
            ),
        [vrchatConfig]
    );
    const playerProfileIds = useMemo(
        () => buildPlayerProfileIds(playerSourceRows, currentUserId),
        [currentUserId, playerSourceRows]
    );
    const knownUsersById = useKnownUserFacts(playerProfileIds, {
        endpoint: currentUserEndpoint
    });
    const combineProfiles = useCallback(
        (results: ProfileQueryResult[]) =>
            mapProfileQueryResults(playerProfileIds, results),
        [playerProfileIds]
    );
    const profilesByUserId = useQueries({
        queries: playerProfileIds.map((userId) => {
            return {
                enabled: Boolean(userId),
                gcTime: entityQueryPolicies.userAvatarLookup.gcTime,
                queryFn: async () => {
                    const response = await vrchatFriendRepository.getUser({
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
        combine: combineProfiles
    });

    return {
        knownUsersById,
        languageOptionsMap,
        profilesByUserId
    };
}
