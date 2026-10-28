import { useEffect, useMemo, useState } from 'react';

import { resolveFriendRequestState } from '@/components/dialogs/user-dialog/userDialogContentHelpers';
import { deriveUserRelationshipBadges } from '@/components/dialogs/user-dialog/userRelationshipBadges';
import type { SidebarFriendRecord } from '@/components/sidebar/friends-sidebar/friendsSidebarModel';
import { localGameLocation } from '@/domain/friends/presence';
import { useFriendLocationTimeEpoch } from '@/lib/useFriendLocationTimeEpoch';
import { useNowMs } from '@/lib/useNowMs';
import memoPersistenceRepository from '@/repositories/memoPersistenceRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';
import vrchatModerationRepository from '@/repositories/vrchatModerationRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { getVrchatUserModeration } from '@/services/shellIntegrationService';
import { normalizeString as normalizeId } from '@/shared/utils/string';
import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    buildUserHoverCardModel,
    normalizeInstanceCounts
} from './userHoverCardModel';

type UserHoverCardProfile = Awaited<
    ReturnType<typeof userProfileRepository.getUserProfile>
>;
type UserHoverCardPopulation = ReturnType<typeof normalizeInstanceCounts>;

type UserHoverCardDataInput = {
    userId: string;
    seed?: SidebarFriendRecord | Record<string, unknown> | null;
};

const pendingProfileLoads = new Map<string, Promise<UserHoverCardProfile>>();

function loadUserHoverCardProfile(userId: string, isFriend: boolean) {
    const endpoint = useRuntimeStore.getState().auth.currentUserEndpoint;
    const key = `${endpoint}|${userId}`;
    const pending = pendingProfileLoads.get(key);
    if (pending) {
        return pending;
    }
    const request = userProfileRepository
        .getUserProfile({ userId, dialog: false, isFriend })
        .finally(() => {
            pendingProfileLoads.delete(key);
        });
    pendingProfileLoads.set(key, request);
    return request;
}

export function prefetchUserHoverCardProfile(userId: string) {
    const normalizedUserId = normalizeId(userId);
    if (!normalizedUserId) {
        return;
    }
    const isFriend = Boolean(
        useFriendRosterStore.getState().friendsById[normalizedUserId]
    );
    loadUserHoverCardProfile(normalizedUserId, isFriend).catch(() => {});
}

export function useUserHoverCardData({
    userId,
    seed = null
}: UserHoverCardDataInput) {
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
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

    const isFriend = useFriendRosterStore((state) =>
        Boolean(normalizedUserId && state.friendsById[normalizedUserId])
    );

    const [profile, setProfile] = useState<UserHoverCardProfile | null>(null);
    const [memo, setMemo] = useState('');
    const [population, setPopulation] = useState<UserHoverCardPopulation>(null);
    const [populationLoading, setPopulationLoading] = useState(false);
    const [profileLoading, setProfileLoading] = useState(true);
    const [profileFailed, setProfileFailed] = useState(false);
    const [moderation, setModeration] = useState({
        block: false,
        mute: false,
        hideAvatar: false
    });
    const nowMs = useNowMs();
    const [worldProfile, setWorldProfile] = useState<Awaited<
        ReturnType<typeof worldProfileRepository.getWorldProfile>
    > | null>(null);

    const localLocation = useFriendLocationTimeStore((state) =>
        normalizedUserId
            ? localGameLocation(state.byUserId[normalizedUserId])
            : ''
    );
    const model = useMemo(
        () =>
            buildUserHoverCardModel({
                seed: effectiveSeed,
                profile,
                localLocation,
                nowMs
            }),
        [effectiveSeed, localLocation, nowMs, profile]
    );
    const instanceEpoch = useFriendLocationTimeEpoch(
        normalizedUserId,
        model.location.effectiveLocation
    );

    useEffect(() => {
        let active = true;
        if (!normalizedUserId) {
            setProfileLoading(false);
            return undefined;
        }
        setProfileLoading(true);
        setProfileFailed(false);
        loadUserHoverCardProfile(normalizedUserId, isFriend)
            .then((next: UserHoverCardProfile) => {
                if (active) {
                    setProfile(next);
                }
            })
            .catch(() => {
                if (active) {
                    setProfileFailed(true);
                }
            })
            .finally(() => {
                if (active) {
                    setProfileLoading(false);
                }
            });
        memoPersistenceRepository
            .getUserMemo(normalizedUserId)
            .then((entry) => {
                if (active) {
                    setMemo(entry.memo.trim());
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [normalizedUserId, endpoint, isFriend]);

    useEffect(() => {
        let active = true;
        setModeration({ block: false, mute: false, hideAvatar: false });
        const ownerUserId = normalizeId(currentUserId);
        if (
            !normalizedUserId ||
            !ownerUserId ||
            ownerUserId === normalizedUserId
        ) {
            return undefined;
        }
        Promise.all([
            vrchatModerationRepository
                .getLocalModeration({ ownerUserId, userId: normalizedUserId })
                .catch(() => null),
            getVrchatUserModeration(ownerUserId, normalizedUserId).catch(
                () => 0
            )
        ]).then(([local, avatarModeration]) => {
            if (active) {
                setModeration({
                    block: Boolean(local?.block),
                    mute: Boolean(local?.mute),
                    hideAvatar: avatarModeration === 4
                });
            }
        });
        return () => {
            active = false;
        };
    }, [currentUserId, normalizedUserId]);

    const relationshipBadges = useMemo(
        () =>
            normalizedUserId && normalizedUserId === normalizeId(currentUserId)
                ? []
                : deriveUserRelationshipBadges({
                      isFriend,
                      friendRequestState: resolveFriendRequestState(profile),
                      moderationState: moderation,
                      avatarOverrideState: moderation
                  }),
        [currentUserId, isFriend, moderation, normalizedUserId, profile]
    );

    const worldId = model.location.worldId;
    const instanceId = model.location.instanceId;
    const isRealInstance = model.location.isRealInstance;

    useEffect(() => {
        let active = true;
        setWorldProfile(null);
        if (!worldId) {
            return () => {
                active = false;
            };
        }
        worldProfileRepository
            .getWorldProfile({ worldId })
            .then((world) => {
                if (active) {
                    setWorldProfile(world);
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [endpoint, worldId]);
    const worldThumb = useMemo(() => {
        const raw = worldProfile?.thumbnailImageUrl || worldProfile?.imageUrl;
        return raw ? convertFileUrlToImageUrl(raw, 512) : '';
    }, [worldProfile]);

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
            .then((response) => {
                if (active) {
                    setPopulation(normalizeInstanceCounts(response.json));
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

    return {
        model,
        worldThumb,
        population,
        populationLoading,
        memo,
        profile,
        relationshipBadges,
        trustColor,
        instanceEpoch: model.variant === 'in-instance' ? instanceEpoch : 0,
        hasSeed: Boolean(effectiveSeed),
        loading: profileLoading && !profile,
        loadFailed: profileFailed && !profile
    };
}
