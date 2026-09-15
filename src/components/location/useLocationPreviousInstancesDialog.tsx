import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import gameLogRepository from '@/repositories/gameLogRepository';
import { toast } from '@/services/toastService';
import type { ParsedLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';
import {
    type PreviousInstancesDialogRow,
    usePreviousInstancesDialogStore
} from '@/state/previousInstancesDialogStore';

type UseLocationPreviousInstancesDialogInput = {
    currentLocation: string;
    groupName: string;
    onShowPreviousInstances?: (row: PreviousInstancesDialogRow) => void;
    parsedLocation: ParsedLocation;
    worldName: string;
    worldNameHint: string;
};

export function useLocationPreviousInstancesDialog({
    currentLocation,
    groupName,
    onShowPreviousInstances,
    parsedLocation,
    worldName,
    worldNameHint
}: UseLocationPreviousInstancesDialogInput) {
    const { t } = useTranslation();
    const showPreviousInstancesDialog = usePreviousInstancesDialogStore(
        (state) => state.showPreviousInstancesDialog
    );
    const [previousInstancesLoading, setPreviousInstancesLoading] =
        useState(false);

    function showExactPreviousInstanceInfo() {
        const payload: PreviousInstancesDialogRow = {
            location: currentLocation,
            worldId: parsedLocation.worldId,
            worldName: worldName || worldNameHint,
            groupName
        };
        if (typeof onShowPreviousInstances === 'function') {
            onShowPreviousInstances(payload);
            return;
        }
        if (!currentLocation) {
            return;
        }
        showPreviousInstancesDialog({
            title: 'Instance Details',
            rows: [
                {
                    location: currentLocation,
                    worldId: parsedLocation.worldId,
                    worldName:
                        worldName || worldNameHint || parsedLocation.worldId,
                    groupName
                }
            ],
            detailsOnly: true
        });
    }

    async function showPreviousInstances() {
        if (!currentLocation && !parsedLocation.worldId) {
            return;
        }
        if (typeof onShowPreviousInstances === 'function') {
            onShowPreviousInstances({
                location: currentLocation,
                worldId: parsedLocation.worldId,
                worldName: worldName || worldNameHint,
                groupName
            });
            return;
        }

        if (!parsedLocation.worldId || previousInstancesLoading) {
            return;
        }

        setPreviousInstancesLoading(true);
        try {
            const instances =
                await gameLogRepository.getPreviousInstancesByWorldId({
                    worldId: parsedLocation.worldId
                });
            const normalizedCurrentLocation = normalizeString(currentLocation);
            const currentInstanceRow: PreviousInstancesDialogRow = {
                location: normalizedCurrentLocation,
                worldId: parsedLocation.worldId,
                worldName: worldName || worldNameHint || parsedLocation.worldId
            };
            const nextRows = [
                ...(normalizedCurrentLocation ? [currentInstanceRow] : []),
                ...instances
            ].sort((left, right) => {
                if (normalizedCurrentLocation) {
                    if (
                        normalizeString(left?.location) ===
                        normalizedCurrentLocation
                    ) {
                        return -1;
                    }
                    if (
                        normalizeString(right?.location) ===
                        normalizedCurrentLocation
                    ) {
                        return 1;
                    }
                }
                return (
                    Date.parse(right?.created_at || '') -
                    Date.parse(left?.created_at || '')
                );
            });

            showPreviousInstancesDialog({
                title: `Instance History - ${worldName || worldNameHint || parsedLocation.worldId}`,
                rows: nextRows,
                detailsOnly: false
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.location.toast.failed_to_load_instance_history'
                          )
            });
        } finally {
            setPreviousInstancesLoading(false);
        }
    }

    return {
        previousInstancesLoading,
        showExactPreviousInstanceInfo,
        showPreviousInstances
    };
}
