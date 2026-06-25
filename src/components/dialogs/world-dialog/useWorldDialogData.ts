import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getFileAnalysisForUnityPackages } from '@/lib/fileAnalysis';
import { readWorldCacheInfo } from '@/lib/worldAssetBundle';
import gameLogRepository from '@/repositories/gameLogRepository';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import memoPersistenceRepository from '@/repositories/memoPersistenceRepository';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { persistFavoriteWorldDetails } from '@/services/favoriteWorldCacheService';

import {
    defaultWorldSideData,
    groupOptionId,
    worldLoadErrorDescription
} from './worldDialogHelpers';
import { normalizeEntityId } from './worldInstances';

export function useWorldDialogData({
    normalizedWorldId,
    profileWorldId,
    seedData,
    currentEndpoint,
    currentUserId,
    isCurrentWorldTarget,
    memoRevisionRef
}: any) {
    const { t } = useTranslation();
    const [world, setWorld] = useState(() =>
        seedData ? worldProfileRepository.normalize(seedData) : null
    );
    const [loadStatus, setLoadStatus] = useState(
        normalizedWorldId ? 'running' : 'idle'
    );
    const [detail, setDetail] = useState('');
    const [memo, setMemo] = useState('');
    const [previousInstances, setPreviousInstances] = useState<any[]>([]);
    const [hasPersistData, setHasPersistData] = useState(false);
    const [worldSideData, setWorldSideData] = useState(() =>
        defaultWorldSideData()
    );
    const [newInstanceGroups, setNewInstanceGroups] = useState<any[]>([]);

    useEffect(() => {
        setWorld(seedData ? worldProfileRepository.normalize(seedData) : null);
    }, [seedData]);

    useEffect(() => {
        setWorldSideData(defaultWorldSideData());
    }, [profileWorldId]);

    useEffect(() => {
        let active = true;

        if (!currentUserId) {
            setNewInstanceGroups([]);
            return () => {
                active = false;
            };
        }

        groupProfileRepository
            .getUserGroups({
                userId: currentUserId,
                endpoint: currentEndpoint
            })
            .then((groups: any) => {
                if (!active) {
                    return;
                }
                setNewInstanceGroups(
                    (Array.isArray(groups) ? groups : [])
                        .filter((group: any) => groupOptionId(group))
                        .sort((left: any, right: any) =>
                            normalizeEntityId(left?.name).localeCompare(
                                normalizeEntityId(right?.name)
                            )
                        )
                );
            })
            .catch(() => {
                if (active) {
                    setNewInstanceGroups([]);
                }
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, currentUserId]);

    useEffect(() => {
        let active = true;

        if (!world?.id) {
            setWorldSideData(defaultWorldSideData());
            return () => {
                active = false;
            };
        }

        const targetWorldId = world.id;
        const targetEndpoint = currentEndpoint;
        vrchatAuthRepository
            .getConfig({ endpoint: targetEndpoint })
            .catch((): null => null)
            .then((configResponse: any) =>
                Promise.allSettled([
                    readWorldCacheInfo(world, targetEndpoint),
                    getFileAnalysisForUnityPackages({
                        unityPackages: world.unityPackages,
                        sdkUnityVersion: String(
                            configResponse?.json?.sdkUnityVersion || ''
                        ),
                        endpoint: targetEndpoint
                    })
                ])
            )
            .then(([cacheResult, fileAnalysisResult]: any) => {
                if (
                    active &&
                    isCurrentWorldTarget(targetWorldId, targetEndpoint)
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
                    isCurrentWorldTarget(targetWorldId, targetEndpoint)
                ) {
                    setWorldSideData(defaultWorldSideData());
                }
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, world?.id, world?.updatedAt, world?.version]);

    useEffect(() => {
        let active = true;

        if (!normalizedWorldId) {
            setWorld(null);
            setLoadStatus('error');
            setDetail(
                t('dialog.world.empty.no_world_id_was_provided_for_this_dialog')
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
                endpoint: currentEndpoint,
                dialog: true
            })
            .then((nextWorld: any) => {
                if (!active) {
                    return;
                }

                persistFavoriteWorldDetails(nextWorld);
                setWorld(nextWorld);
                setLoadStatus('ready');
            })
            .catch((error: any) => {
                if (!active) {
                    return;
                }

                if (seedData) {
                    setWorld(worldProfileRepository.normalize(seedData));
                    setLoadStatus('ready');
                    setDetail(
                        worldLoadErrorDescription(
                            error,
                            t,
                            profileWorldId,
                            'dialog.world.error.failed_to_refresh_the_remote_world_snapshot'
                        )
                    );
                    return;
                }

                setWorld(null);
                setLoadStatus('error');
                setDetail(
                    worldLoadErrorDescription(
                        error,
                        t,
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
            .then((entry: any) => {
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
    }, [profileWorldId]);

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
                worldId: profileWorldId,
                endpoint: currentEndpoint
            })
            .then((exists: any) => {
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
            .then((rows: any) => {
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
        hasPersistData,
        setHasPersistData,
        worldSideData,
        setWorldSideData,
        newInstanceGroups
    };
}
