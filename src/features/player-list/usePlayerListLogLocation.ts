import { useEffect, useState } from 'react';

import { getCurrentLogLocation } from '@/services/gameLogWatcherService';
import { normalizeString } from '@/shared/utils/string';

import { isLiveLocation } from './playerListRows';

function normalizeLogLocationSnapshot(snapshot: any) {
    if (!snapshot || typeof snapshot !== 'object') {
        return null;
    }

    const location = normalizeString(snapshot.location);
    if (!isLiveLocation(location)) {
        return null;
    }

    return {
        createdAt:
            normalizeString(snapshot.createdAt) || new Date().toISOString(),
        fileName: normalizeString(snapshot.fileName),
        location,
        worldName: normalizeString(snapshot.worldName)
    };
}

export function usePlayerListLogLocation({
    addGameLogEventCount,
    currentUserId,
    currentUserLocation,
    gameLogDisabled,
    isGameRunning
}: any) {
    const [logLocationSnapshot, setLogLocationSnapshot] = useState<any>(null);

    useEffect(() => {
        let active = true;

        if (currentUserLocation || !isGameRunning || gameLogDisabled) {
            setLogLocationSnapshot(null);
            return () => {
                active = false;
            };
        }

        if (logLocationSnapshot) {
            return () => {
                active = false;
            };
        }

        getCurrentLogLocation()
            .then((snapshot: any) => {
                if (!active) {
                    return;
                }

                const normalized = normalizeLogLocationSnapshot(snapshot);
                const normalizedKey = JSON.stringify(normalized || null);
                setLogLocationSnapshot((previous: any) =>
                    JSON.stringify(previous || null) === normalizedKey
                        ? previous
                        : normalized
                );
            })
            .catch(() => {
                if (!active) {
                    return;
                }

                setLogLocationSnapshot(null);
            });

        return () => {
            active = false;
        };
    }, [
        addGameLogEventCount,
        currentUserId,
        currentUserLocation,
        gameLogDisabled,
        isGameRunning,
        logLocationSnapshot
    ]);

    return logLocationSnapshot;
}
