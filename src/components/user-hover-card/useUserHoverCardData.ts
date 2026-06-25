import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { entityQueryPolicies, queryKeys } from '@/lib/entityQueryCache';
import memoPersistenceRepository from '@/repositories/memoPersistenceRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { normalizeString as normalizeId } from '@/shared/utils/string';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { getEstimatedDwellSince } from './friendDwellTracker';
import {
    buildUserHoverCardModel,
    normalizeInstanceCounts
} from './userHoverCardModel';

export function useUserHoverCardData({ userId, seed }: any) {
    const endpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const trustColor = usePreferencesStore((state: any) => state.trustColor);

    const normalizedUserId = normalizeId(userId) || normalizeId(seed?.id);

    const isFriend = Boolean(seed);

    const [profile, setProfile] = useState<any>(null);
    const [memo, setMemo] = useState('');
    const [population, setPopulation] = useState<any>(null);
    const [populationLoading, setPopulationLoading] = useState(false);
    const [profileLoading, setProfileLoading] = useState(true);

    const nowMs = useMemo(() => Date.now(), [profile, seed]);
    const model = useMemo(
        () => buildUserHoverCardModel({ seed, profile, nowMs }),
        [seed, profile, nowMs]
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
                endpoint,
                dialog: false,
                isFriend
            })
            .then((next: any) => {
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
            .then((entry: any) => {
                if (active) {
                    setMemo(String(entry?.memo || '').trim());
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
        queryFn: () =>
            worldProfileRepository.fetchWorldProfile({ worldId, endpoint }),
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
            .getInstance({ worldId, instanceId, endpoint })
            .then((response: any) => {
                if (active) {
                    setPopulation(
                        normalizeInstanceCounts(response?.json ?? response)
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
