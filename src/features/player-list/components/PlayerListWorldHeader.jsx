import { useEffect, useState } from 'react';

import { getFileAnalysisForUnityPackages } from '@/lib/fileAnalysis.js';
import {
    defaultWorldCacheInfo,
    readWorldCacheInfo
} from '@/lib/worldAssetBundle.js';
import {
    vrchatAuthRepository,
    worldProfileRepository
} from '@/repositories/index.js';
import { parseLocation } from '@/shared/utils/locationParser.js';

import { CurrentWorldHeader } from './PlayerListViewParts.jsx';

export function PlayerListWorldHeader({
    clockNow,
    context,
    currentUserEndpoint,
    currentUserLocation,
    currentUserSnapshot,
    friendCount,
    isGameRunning,
    onPreviewImage,
    playerCount,
    startedAt,
    t
}) {
    const parsedLocation = parseLocation(
        context.location || currentUserLocation || ''
    );
    const [currentWorldProfile, setCurrentWorldProfile] = useState(null);
    const [currentWorldFileAnalysis, setCurrentWorldFileAnalysis] = useState(
        {}
    );
    const [currentWorldCacheInfo, setCurrentWorldCacheInfo] = useState(() =>
        defaultWorldCacheInfo()
    );

    useEffect(() => {
        let active = true;
        const worldId = parsedLocation.worldId || context.worldId || '';

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
            .then((world) => {
                if (active) {
                    setCurrentWorldProfile(world);
                }
                return vrchatAuthRepository
                    .getConfig({ endpoint: currentUserEndpoint })
                    .catch(() => null)
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
                            readWorldCacheInfo(
                                world,
                                currentUserEndpoint,
                                sdkUnityVersion
                            )
                        ]);
                    });
            })
            .then(([fileAnalysis, cacheInfo]) => {
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
        context.worldId,
        currentUserEndpoint,
        isGameRunning,
        parsedLocation.worldId
    ]);

    return (
        <CurrentWorldHeader
            cacheInfo={currentWorldCacheInfo}
            clockNow={clockNow}
            context={context}
            currentUserSnapshot={currentUserSnapshot}
            fileAnalysis={currentWorldFileAnalysis}
            friendCount={friendCount}
            isGameRunning={isGameRunning}
            onPreviewImage={onPreviewImage}
            playerCount={playerCount}
            parsedLocation={parsedLocation}
            startedAt={startedAt}
            t={t}
            world={currentWorldProfile}
        />
    );
}
