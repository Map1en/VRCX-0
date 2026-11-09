import { useEffect, useState } from 'react';

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

function isInstanceProfile(value: unknown): value is CurrentInstanceProfile {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

type PlayerListWorldHeaderProps = {
    clockNow: number;
    currentUserLocation?: string;
    instanceSnapshot: PlayerListContext;
    isGameRunning: boolean;
    playerCount: number;
    startedAt?: string | null;
};

export function PlayerListWorldHeader({
    clockNow,
    currentUserLocation,
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

    useEffect(() => {
        let active = true;

        if (!isGameRunning || !worldId) {
            setCurrentWorldProfile(null);
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
            })
            .catch(() => {
                if (active) {
                    setCurrentWorldProfile(null);
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
            key={worldId}
            clockNow={clockNow}
            currentUserSnapshot={currentUserSnapshot}
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
