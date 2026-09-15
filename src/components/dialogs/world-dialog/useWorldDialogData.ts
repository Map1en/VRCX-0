import {
    useCallback,
    useEffect,
    useEffectEvent,
    useRef,
    useState,
    type MutableRefObject
} from 'react';
import { useTranslation } from 'react-i18next';

import type { EntityRecord } from '@/domain/entities/shared';
import { getFileAnalysisForUnityPackages } from '@/lib/fileAnalysis';
import { readWorldCacheInfo } from '@/lib/worldAssetBundle';
import feedPersistenceRepository from '@/repositories/feedPersistenceRepository';
import gameLogRepository from '@/repositories/gameLogRepository';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import memoPersistenceRepository from '@/repositories/memoPersistenceRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { persistFavoriteWorldDetails } from '@/services/favoriteWorldCacheService';
import { normalizeString } from '@/shared/utils/string';
import { useVrchatConfigStore } from '@/state/vrchatConfigStore';

import {
    defaultWorldSideData,
    groupOptionId,
    worldLoadErrorDescription
} from './worldDialogHelpers';

type WorldDialogNewInstanceGroups = Awaited<
    ReturnType<typeof groupProfileRepository.getUserGroups>
>;

export type WorldPreviousInstances = Awaited<
    ReturnType<typeof gameLogRepository.getPreviousInstancesByWorldId>
>;

export type WorldFriendVisits = Awaited<
    ReturnType<typeof feedPersistenceRepository.getWorldFriendVisits>
>;

export type WorldWorldSideData = {
    cache: Awaited<ReturnType<typeof readWorldCacheInfo>>;
    fileAnalysis: Awaited<ReturnType<typeof getFileAnalysisForUnityPackages>>;
};

interface UseWorldDialogDataInput {
    normalizedWorldId: string;
    profileWorldId: string;
    seedData: EntityRecord | null;
    currentEndpoint: string;
    currentUserId: string | null;
    isCurrentWorldTarget: (worldId: string, endpoint: string) => boolean;
    memoRevisionRef: MutableRefObject<number>;
}

export function useWorldDialogData({
    normalizedWorldId,
    profileWorldId,
    seedData,
    currentEndpoint,
    currentUserId,
    isCurrentWorldTarget,
    memoRevisionRef
}: UseWorldDialogDataInput) {
    const { t } = useTranslation();
    const sdkUnityVersion = useVrchatConfigStore((state) =>
        String(state.snapshot?.sdkUnityVersion || '')
    );
    const [world, setWorld] = useState(() =>
        seedData ? worldProfileRepository.normalize(seedData) : null
    );
    const [loadStatus, setLoadStatus] = useState(
        normalizedWorldId ? 'running' : 'idle'
    );
    const [detail, setDetail] = useState('');
    const [memo, setMemo] = useState('');
    const [previousInstances, setPreviousInstances] =
        useState<WorldPreviousInstances>([]);
    const [friendVisits, setFriendVisits] = useState<WorldFriendVisits>(null);
    const [hasPersistData, setHasPersistData] = useState(false);
    const [worldSideData, setWorldSideData] = useState<WorldWorldSideData>(() =>
        defaultWorldSideData()
    );
    const [newInstanceGroups, setNewInstanceGroups] =
        useState<WorldDialogNewInstanceGroups>([]);
    const newInstanceGroupsLoadGenerationRef = useRef(0);
    const worldAssetUrl =
        typeof world?.assetUrl === 'string' ? world.assetUrl : undefined;
    const worldId = world?.id;
    const worldUnityPackages = world?.unityPackages;
    const currentWorldTargetMatches = useEffectEvent(isCurrentWorldTarget);
    const translateWorldDetail = useEffectEvent((key: string) => t(key));
    const describeWorldLoadError = useEffectEvent(
        (error: unknown, worldId: string, key: string) =>
            worldLoadErrorDescription(error, t, worldId, key)
    );

    useEffect(() => {
        setWorld(seedData ? worldProfileRepository.normalize(seedData) : null);
    }, [seedData]);

    useEffect(() => {
        setWorldSideData(defaultWorldSideData());
    }, [profileWorldId]);

    useEffect(() => {
        setNewInstanceGroups([]);
        return () => {
            newInstanceGroupsLoadGenerationRef.current += 1;
        };
    }, [currentUserId]);

    const loadNewInstanceGroups = useCallback(async () => {
        const generation = ++newInstanceGroupsLoadGenerationRef.current;
        if (!currentUserId) {
            setNewInstanceGroups([]);
            return [];
        }

        try {
            const groups = await groupProfileRepository.getUserGroups({
                userId: currentUserId
            });
            const nextGroups = (Array.isArray(groups) ? groups : [])
                .filter((group) => groupOptionId(group))
                .sort((left, right) =>
                    normalizeString(left?.name).localeCompare(
                        normalizeString(right?.name)
                    )
                );
            if (newInstanceGroupsLoadGenerationRef.current !== generation) {
                return [];
            }
            setNewInstanceGroups(nextGroups);
            return nextGroups;
        } catch {
            if (newInstanceGroupsLoadGenerationRef.current === generation) {
                setNewInstanceGroups([]);
            }
            return [];
        }
    }, [currentUserId]);

    useEffect(() => {
        let active = true;

        if (!worldId) {
            setWorldSideData(defaultWorldSideData());
            return () => {
                active = false;
            };
        }

        const targetWorldId = worldId;
        const targetEndpoint = currentEndpoint;
        Promise.allSettled([
            readWorldCacheInfo(
                {
                    id: worldId,
                    assetUrl: worldAssetUrl,
                    unityPackages: worldUnityPackages
                },
                sdkUnityVersion
            ),
            getFileAnalysisForUnityPackages({
                unityPackages: worldUnityPackages,
                sdkUnityVersion,
                endpoint: targetEndpoint
            })
        ])
            .then(([cacheResult, fileAnalysisResult]) => {
                if (
                    active &&
                    currentWorldTargetMatches(targetWorldId, targetEndpoint)
                ) {
                    setWorldSideData({
                        cache:
                            cacheResult.status === 'fulfilled'
                                ? cacheResult.value
                                : defaultWorldSideData().cache,
                        fileAnalysis:
                            fileAnalysisResult.status === 'fulfilled'
                                ? fileAnalysisResult.value
                                : {}
                    });
                }
            })
            .catch(() => {
                if (
                    active &&
                    currentWorldTargetMatches(targetWorldId, targetEndpoint)
                ) {
                    setWorldSideData(defaultWorldSideData());
                }
            });

        return () => {
            active = false;
        };
    }, [
        currentEndpoint,
        sdkUnityVersion,
        world?.updatedAt,
        world?.version,
        worldAssetUrl,
        worldId,
        worldUnityPackages
    ]);

    useEffect(() => {
        let active = true;

        if (!normalizedWorldId) {
            setWorld(null);
            setLoadStatus('error');
            setDetail(
                translateWorldDetail(
                    'dialog.world.empty.no_world_id_was_provided_for_this_dialog'
                )
            );
            return () => {
                active = false;
            };
        }

        setWorld(seedData ? worldProfileRepository.normalize(seedData) : null);
        setLoadStatus('running');
        setDetail('');

        worldProfileRepository
            .getWorldProfile({
                worldId: profileWorldId,
                dialog: true
            })
            .then((nextWorld) => {
                if (!active) {
                    return;
                }

                persistFavoriteWorldDetails(nextWorld);
                setWorld(nextWorld);
                setLoadStatus('ready');
            })
            .catch((error: unknown) => {
                if (!active) {
                    return;
                }

                if (seedData) {
                    setWorld(worldProfileRepository.normalize(seedData));
                    setLoadStatus('ready');
                    setDetail(
                        describeWorldLoadError(
                            error,
                            profileWorldId,
                            'dialog.world.error.failed_to_refresh_the_remote_world_snapshot'
                        )
                    );
                    return;
                }

                setWorld(null);
                setLoadStatus('error');
                setDetail(
                    describeWorldLoadError(
                        error,
                        profileWorldId,
                        'dialog.world.error.failed_to_load_the_world_profile'
                    )
                );
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, normalizedWorldId, profileWorldId, seedData]);

    useEffect(() => {
        let active = true;

        if (!profileWorldId) {
            setMemo('');
            return () => {
                active = false;
            };
        }

        setMemo('');
        const revision = memoRevisionRef.current;
        memoPersistenceRepository
            .getWorldMemo(profileWorldId)
            .then((entry) => {
                if (active && memoRevisionRef.current === revision) {
                    setMemo(entry?.memo || '');
                }
            })
            .catch(() => {
                if (active && memoRevisionRef.current === revision) {
                    setMemo('');
                }
            });

        return () => {
            active = false;
        };
    }, [memoRevisionRef, profileWorldId]);

    useEffect(() => {
        let active = true;

        if (!profileWorldId) {
            setHasPersistData(false);
            return () => {
                active = false;
            };
        }

        if (!currentUserId) {
            setHasPersistData(Boolean(world?.hasPersistData));
            return () => {
                active = false;
            };
        }

        worldProfileRepository
            .hasWorldPersistentData({
                userId: currentUserId,
                worldId: profileWorldId
            })
            .then((exists) => {
                if (active) {
                    setHasPersistData(exists);
                }
            })
            .catch(() => {
                if (active) {
                    setHasPersistData(Boolean(world?.hasPersistData));
                }
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, currentUserId, profileWorldId, world?.hasPersistData]);

    useEffect(() => {
        let active = true;

        if (!profileWorldId) {
            setPreviousInstances([]);
            return () => {
                active = false;
            };
        }

        gameLogRepository
            .getPreviousInstancesByWorldId({ worldId: profileWorldId })
            .then((rows) => {
                if (!active) {
                    return;
                }
                const values = Array.isArray(rows) ? rows : [];
                setPreviousInstances(values);
            })
            .catch(() => {
                if (active) {
                    setPreviousInstances([]);
                }
            });

        return () => {
            active = false;
        };
    }, [profileWorldId]);

    useEffect(() => {
        let active = true;

        if (!profileWorldId) {
            setFriendVisits(null);
            return () => {
                active = false;
            };
        }

        feedPersistenceRepository
            .getWorldFriendVisits(profileWorldId)
            .then((visits) => {
                if (active) {
                    setFriendVisits(visits);
                }
            })
            .catch(() => {
                if (active) {
                    setFriendVisits(null);
                }
            });

        return () => {
            active = false;
        };
    }, [profileWorldId]);

    return {
        world,
        setWorld,
        loadStatus,
        detail,
        setDetail,
        memo,
        setMemo,
        previousInstances,
        setPreviousInstances,
        friendVisits,
        hasPersistData,
        setHasPersistData,
        worldSideData,
        setWorldSideData,
        newInstanceGroups,
        loadNewInstanceGroups
    };
}
