import { useEffect, useState } from 'react';

import { getFileAnalysisForUnityPackages } from '@/lib/fileAnalysis';
import {
    defaultWorldCacheInfo,
    readWorldCacheInfo
} from '@/lib/worldAssetBundle';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import type { PlayerListContext } from '../playerListTypes';
import { CurrentWorldHeader } from './PlayerListViewParts';

type CurrentWorldProfile = Awaited<
    ReturnType<typeof worldProfileRepository.getWorldProfile>
>;
type CurrentInstanceProfile = Record<string, unknown>;
type CurrentWorldFileAnalysis = {
    android?: WorldFileAnalysisPlatform;
    standalonewindows?: WorldFileAnalysisPlatform;
    ios?: WorldFileAnalysisPlatform;
    [key: string]: WorldFileAnalysisPlatform | undefined;
};
type WorldFileAnalysisPlatform = {
    created_at?: string;
    encryptionKey?: string;
    fileSize?: number;
    success?: boolean;
    uncompressedSize?: number;
    worldSignature?: string;
    _fileSize?: string;
    _uncompressedSize?: string;
    [key: string]: unknown;
};

function isInstanceProfile(value: unknown): value is CurrentInstanceProfile {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

type PlayerListWorldHeaderProps = {
    clockNow: number;
    currentUserLocation?: unknown;
    friendCount: number;
    instanceSnapshot: PlayerListContext;
    isGameRunning: boolean;
    playerCount: number;
    startedAt?: unknown;
};

export function PlayerListWorldHeader({
    clockNow,
    currentUserLocation,
    friendCount,
    instanceSnapshot,
    isGameRunning,
    playerCount,
    startedAt
}: PlayerListWorldHeaderProps) {
    const currentUserEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const parsedLocation = parseLocation(
        normalizeString(instanceSnapshot.location || currentUserLocation || '')
    );
    const worldId =
        parsedLocation.worldId || normalizeString(instanceSnapshot.worldId);
    const instanceId = parsedLocation.instanceId;
    const [currentWorldProfile, setCurrentWorldProfile] =
        useState<CurrentWorldProfile | null>(null);
    const [currentInstanceCapacity, setCurrentInstanceCapacity] = useState<
        number | null
    >(null);
    const [currentWorldFileAnalysis, setCurrentWorldFileAnalysis] =
        useState<CurrentWorldFileAnalysis>({});
    const [currentWorldCacheInfo, setCurrentWorldCacheInfo] = useState(() =>
        defaultWorldCacheInfo()
    );

    useEffect(() => {
        let active = true;

        if (!isGameRunning || !worldId) {
            setCurrentWorldProfile(null);
            setCurrentWorldFileAnalysis({});
            setCurrentWorldCacheInfo(defaultWorldCacheInfo());
            return () => {
                active = false;
            };
        }

        worldProfileRepository
            .getWorldProfile({
                worldId,
                full: true
            })
            .then((world) => {
                if (active) {
                    setCurrentWorldProfile(world);
                }
                return vrchatAuthRepository
                    .getConfig()
                    .catch((): null => null)
                    .then((configResponse) => {
                        const sdkUnityVersion = String(
                            configResponse?.json?.sdkUnityVersion || ''
                        );
                        return Promise.all([
                            getFileAnalysisForUnityPackages({
                                unityPackages: world?.unityPackages,
                                sdkUnityVersion,
                                endpoint: currentUserEndpoint
                            }),
                            readWorldCacheInfo(world, sdkUnityVersion)
                        ]);
                    });
            })
            .then(([fileAnalysis, cacheInfo]) => {
                if (active) {
                    setCurrentWorldFileAnalysis(
                        (fileAnalysis || {}) as CurrentWorldFileAnalysis
                    );
                    setCurrentWorldCacheInfo(
                        cacheInfo || defaultWorldCacheInfo()
                    );
                }
            })
            .catch(() => {
                if (active) {
                    setCurrentWorldProfile(null);
                    setCurrentWorldFileAnalysis({});
                    setCurrentWorldCacheInfo(defaultWorldCacheInfo());
                }
            });

        return () => {
            active = false;
        };
    }, [currentUserEndpoint, isGameRunning, worldId]);

    useEffect(() => {
        let active = true;

        setCurrentInstanceCapacity(null);
        if (
            !isGameRunning ||
            !parsedLocation.isRealInstance ||
            !worldId ||
            !instanceId
        ) {
            return () => {
                active = false;
            };
        }

        vrchatInstanceRepository
            .getInstance({
                worldId,
                instanceId
            })
            .then((response) => {
                if (active && isInstanceProfile(response.json)) {
                    setCurrentInstanceCapacity(
                        Number(response.json.capacity) || null
                    );
                }
            })
            .catch(() => {
                if (active) {
                    setCurrentInstanceCapacity(null);
                }
            });

        return () => {
            active = false;
        };
    }, [
        currentUserEndpoint,
        instanceId,
        isGameRunning,
        parsedLocation.isRealInstance,
        worldId
    ]);

    return (
        <CurrentWorldHeader
            cacheInfo={currentWorldCacheInfo}
            clockNow={clockNow}
            currentUserSnapshot={currentUserSnapshot}
            fileAnalysis={currentWorldFileAnalysis}
            friendCount={friendCount}
            instanceCapacity={currentInstanceCapacity}
            instanceCreatedAt={instanceSnapshot.createdAt}
            instanceGroupName={normalizeString(instanceSnapshot.groupName)}
            instanceLocation={normalizeString(instanceSnapshot.location)}
            instanceWorldId={normalizeString(instanceSnapshot.worldId)}
            instanceWorldName={normalizeString(instanceSnapshot.worldName)}
            isGameRunning={isGameRunning}
            onPreviewImage={openImagePreview}
            playerCount={playerCount}
            parsedLocation={parsedLocation}
            startedAt={startedAt}
            world={currentWorldProfile}
        />
    );
}
