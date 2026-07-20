import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import type { SidebarFriendRecord } from '@/components/sidebar/friends-sidebar/friendsSidebarModel';
import { entityQueryPolicies, queryKeys } from '@/lib/entityQueryCache';
import memoPersistenceRepository from '@/repositories/memoPersistenceRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { normalizeString as normalizeId } from '@/shared/utils/string';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { getEstimatedDwellSince } from './friendDwellTracker';
import {
    buildUserHoverCardModel,
    normalizeInstanceCounts
} from './userHoverCardModel';

type UserHoverCardProfile = Awaited<
    ReturnType<typeof userProfileRepository.getUserProfile>
>;
type UserHoverCardPopulation = ReturnType<typeof normalizeInstanceCounts>;

type UserHoverCardDataInput = {
    userId: unknown;
    seed?: SidebarFriendRecord | Record<string, unknown> | null;
};

export function useUserHoverCardData({
    userId,
    seed = null
}: UserHoverCardDataInput) {
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const trustColor = usePreferencesStore((state) => state.trustColor);

    const normalizedInputUserId = normalizeId(userId);
    const shouldUseRosterSeed = !seed && Boolean(normalizedInputUserId);
    const rosterSeed = useFriendRosterStore((state) =>
        shouldUseRosterSeed
            ? (state.friendsById[normalizedInputUserId] ?? null)
            : null
    );
    const effectiveSeed = seed || rosterSeed;
    const normalizedUserId =
        normalizedInputUserId || normalizeId(effectiveSeed?.id);

    const isFriend = Boolean(effectiveSeed);

    const [profile, setProfile] = useState<UserHoverCardProfile | null>(null);
    const [memo, setMemo] = useState('');
    const [population, setPopulation] = useState<UserHoverCardPopulation>(null);
    const [populationLoading, setPopulationLoading] = useState(false);
    const [profileLoading, setProfileLoading] = useState(true);

    const nowMs = useMemo(() => Date.now(), [profile, effectiveSeed]);
    const model = useMemo(
        () => buildUserHoverCardModel({ seed: effectiveSeed, profile, nowMs }),
        [effectiveSeed, profile, nowMs]
    );

    useEffect(() => {
        let active = true;
        if (!normalizedUserId) {
            setProfileLoading(false);
            return undefined;
        }
        setProfileLoading(true);
        userProfileRepository
            .getUserProfile({
                userId: normalizedUserId,
                dialog: false,
                isFriend
            })
            .then((next: UserHoverCardProfile) => {
                if (active) {
                    setProfile(next);
                }
            })
            .catch(() => {})
            .finally(() => {
                if (active) {
                    setProfileLoading(false);
                }
            });
        memoPersistenceRepository
            .getUserMemo(normalizedUserId)
            .then((entry: unknown) => {
                if (active) {
                    const memoEntry =
                        entry && typeof entry === 'object'
                            ? (entry as { memo?: unknown })
                            : null;
                    setMemo(String(memoEntry?.memo || '').trim());
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [normalizedUserId, endpoint, isFriend]);

    const worldId = model.location.worldId;
    const instanceId = model.location.instanceId;
    const isRealInstance = model.location.isRealInstance;

    const worldQuery = useQuery({
        queryKey: queryKeys.world(worldId, endpoint),
        queryFn: () => worldProfileRepository.fetchWorldProfile({ worldId }),
        enabled: Boolean(worldId),
        staleTime: entityQueryPolicies.worldBasic.staleTime,
        gcTime: entityQueryPolicies.worldBasic.gcTime,
        retry: entityQueryPolicies.worldBasic.retry,
        refetchOnWindowFocus:
            entityQueryPolicies.worldBasic.refetchOnWindowFocus
    });
    const worldThumb = useMemo(() => {
        const raw =
            worldQuery.data?.thumbnailImageUrl || worldQuery.data?.imageUrl;
        return raw ? convertFileUrlToImageUrl(raw, 512) : '';
    }, [worldQuery.data]);

    useEffect(() => {
        let active = true;
        setPopulation(null);
        if (!isRealInstance || !worldId || !instanceId) {
            setPopulationLoading(false);
            return undefined;
        }
        setPopulationLoading(true);
        vrchatInstanceRepository
            .getInstance({ worldId, instanceId })
            .then((response: unknown) => {
                if (active) {
                    const responseRecord =
                        response && typeof response === 'object'
                            ? (response as { json?: unknown })
                            : null;
                    setPopulation(
                        normalizeInstanceCounts(
                            responseRecord?.json ?? response
                        )
                    );
                }
            })
            .catch(() => {})
            .finally(() => {
                if (active) {
                    setPopulationLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [worldId, instanceId, isRealInstance, endpoint]);

    const instanceEpoch =
        model.instanceEpoch ||
        (model.variant === 'in-instance'
            ? getEstimatedDwellSince(
                  normalizedUserId,
                  model.location.effectiveLocation
              )
            : 0);

    return {
        model,
        worldThumb,
        population,
        populationLoading,
        memo,
        trustColor,
        instanceEpoch,
        loading: profileLoading && !profile
    };
}
