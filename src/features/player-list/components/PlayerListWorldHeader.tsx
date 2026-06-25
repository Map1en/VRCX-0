import { useEffect, useState } from 'react';

import { getFileAnalysisForUnityPackages } from '@/lib/fileAnalysis';
import {
    defaultWorldCacheInfo,
    readWorldCacheInfo
} from '@/lib/worldAssetBundle';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { parseLocation } from '@/shared/utils/location';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { CurrentWorldHeader } from './PlayerListViewParts';

export function PlayerListWorldHeader({
    clockNow,
    currentUserLocation,
    friendCount,
    instanceSnapshot,
    isGameRunning,
    playerCount,
    startedAt
}: any) {
    const currentUserEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );
    const openImagePreview = useModalStore(
        (state: any) => state.openImagePreview
    );
    const parsedLocation = parseLocation(
        instanceSnapshot.location || currentUserLocation || ''
    );
    const [currentWorldProfile, setCurrentWorldProfile] = useState(null);
    const [currentWorldFileAnalysis, setCurrentWorldFileAnalysis] =
        useState<any>({});
    const [currentWorldCacheInfo, setCurrentWorldCacheInfo] = useState(() =>
        defaultWorldCacheInfo()
    );

    useEffect(() => {
        let active = true;
        const worldId =
            parsedLocation.worldId || instanceSnapshot.worldId || '';

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
                endpoint: currentUserEndpoint
            })
            .then((world: any) => {
                if (active) {
                    setCurrentWorldProfile(world);
                }
                return vrchatAuthRepository
                    .getConfig({ endpoint: currentUserEndpoint })
                    .catch((): null => null)
                    .then((configResponse: any) => {
                        const sdkUnityVersion = String(
                            configResponse?.json?.sdkUnityVersion || ''
                        );
                        return Promise.all([
                            getFileAnalysisForUnityPackages({
                                unityPackages: world?.unityPackages,
                                sdkUnityVersion,
                                endpoint: currentUserEndpoint
                            }),
                            readWorldCacheInfo(
                                world,
                                currentUserEndpoint,
                                sdkUnityVersion
                            )
                        ]);
                    });
            })
            .then(([fileAnalysis, cacheInfo]: any) => {
                if (active) {
                    setCurrentWorldFileAnalysis(fileAnalysis || {});
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
    }, [
        currentUserEndpoint,
        instanceSnapshot.worldId,
        isGameRunning,
        parsedLocation.worldId
    ]);

    return (
        <CurrentWorldHeader
            cacheInfo={currentWorldCacheInfo}
            clockNow={clockNow}
            currentUserSnapshot={currentUserSnapshot}
            fileAnalysis={currentWorldFileAnalysis}
            friendCount={friendCount}
            instanceCreatedAt={instanceSnapshot.createdAt}
            instanceGroupName={instanceSnapshot.groupName}
            instanceLocation={instanceSnapshot.location}
            instanceWorldId={instanceSnapshot.worldId}
            instanceWorldName={instanceSnapshot.worldName}
            isGameRunning={isGameRunning}
            onPreviewImage={openImagePreview}
            playerCount={playerCount}
            parsedLocation={parsedLocation}
            startedAt={startedAt}
            world={currentWorldProfile}
        />
    );
}
