import { LockIcon, UnlockIcon } from 'lucide-react';
import { useMemo } from 'react';
import type { SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
    locationObjectGroupName,
    locationObjectWorldName,
    launchTagForLocationObject,
    normalizeLocationObject,
    normalizeLocationText,
    firstFiniteLocationNumber,
    firstNonNegativeLocationNumber,
    worldDialogTarget,
    type LocationObjectRecord
} from '@/components/location/locationModel';
import { LocationPendingText } from '@/components/location/LocationPendingText';
import { RegionCodeBadge } from '@/components/location/RegionCodeBadge';
import { useLocationMetadata } from '@/components/location/useLocationMetadata';
import { cn } from '@/lib/utils';
import { openGroupDialog, openWorldDialog } from '@/services/dialogService';
import { accessTypeLocaleKeyMap } from '@/shared/constants/accessType';
import { translateAccessType } from '@/shared/utils/location';
import { useLaunchStore } from '@/state/launchStore';
import { Button } from '@/ui/shadcn/button';

export type InstanceLocationSummaryProps = {
    locationObject?: LocationObjectRecord | string | null;
    currentUserId?: string | null;
    worldDialogShortName?: string;
    groupHint?: string | null;
    grouphint?: string | null;
    instanceOwner?: string | null;
    instanceOwnerName?: string;
    playerCount?: number | string | null;
    capacity?: number | string | null;
    endpoint?: string;
    hint?: string | null;
    interactive?: boolean;
    instanceClickAction?: 'launch' | 'world';
    showGroupName?: boolean;
    showWorldName?: boolean;
    showPlayerSummary?: boolean;
    showRegion?: boolean;
    className?: string;
};

export function InstanceLocationSummary({
    locationObject,
    currentUserId = '',
    worldDialogShortName = '',
    groupHint = '',
    grouphint = '',
    instanceOwner = '',
    instanceOwnerName = '',
    playerCount,
    capacity,
    endpoint = '',
    hint = '',
    interactive = true,
    instanceClickAction = 'launch',
    showGroupName = true,
    showWorldName = true,
    showPlayerSummary = true,
    showRegion = true,
    className = ''
}: InstanceLocationSummaryProps) {
    const { t } = useTranslation();
    const showLaunchDialog = useLaunchStore((state) => state.showLaunchDialog);
    const locObj = useMemo(
        () => normalizeLocationObject(locationObject),
        [locationObject]
    );
    const currentLocation = launchTagForLocationObject(locObj);
    const accessTypeName = translateAccessType(
        locObj.accessTypeName,
        t,
        accessTypeLocaleKeyMap
    );
    const {
        region,
        instanceName,
        isClosed,
        groupName,
        groupNamePending,
        worldName,
        worldNamePending
    } = useLocationMetadata({
        locationInfo: locObj,
        currentLocation,
        endpoint,
        hint,
        worldNameHint: locationObjectWorldName(locObj),
        groupHint:
            normalizeLocationText(groupHint || grouphint) ||
            locationObjectGroupName(locObj),
        instanceName: locObj.instanceName
    });
    const isUnlocked = Boolean(
        (worldDialogShortName &&
            locObj.shortName &&
            worldDialogShortName === locObj.shortName) ||
        (worldDialogShortName &&
            locObj.launchToken &&
            worldDialogShortName === locObj.launchToken) ||
        (currentUserId && currentUserId === locObj.userId)
    );
    const ownerLabel =
        normalizeLocationText(instanceOwnerName) ||
        normalizeLocationText(instanceOwner);
    const resolvedPlayerCount = firstNonNegativeLocationNumber(
        playerCount,
        locObj.playerCount,
        locObj.userCount,
        locObj.occupants,
        locObj.n_users,
        Array.isArray(locObj.users) ? locObj.users.length : null
    );
    const resolvedCapacity = firstFiniteLocationNumber(
        capacity,
        locObj.capacity,
        locObj.world?.capacity,
        locObj.ref?.capacity,
        locObj.ref?.world?.capacity
    );
    const hasPlayerCount =
        resolvedPlayerCount !== null && resolvedPlayerCount >= 0;
    const hasCapacity = resolvedCapacity !== null && resolvedCapacity > 0;
    const playerSummary =
        hasPlayerCount || hasCapacity
            ? `${hasPlayerCount ? resolvedPlayerCount : '—'}${hasCapacity ? `/${resolvedCapacity}` : ''}`
            : '';
    const locationLabel =
        [
            showWorldName ? worldName : '',
            accessTypeName || locObj.accessTypeName || ''
        ]
            .filter(Boolean)
            .join(' · ') || '—';

    function openLocationGroupDialog(event: SyntheticEvent<HTMLElement>) {
        if (!interactive) {
            return;
        }
        event?.stopPropagation?.();
        const groupId = normalizeLocationText(locObj.groupId);
        if (!groupId) {
            return;
        }
        openGroupDialog({ groupId, title: groupName || undefined });
    }

    function openLocationWorldDialog(event: SyntheticEvent<HTMLElement>) {
        if (!interactive) {
            return;
        }
        event?.stopPropagation?.();
        const dialogTarget = worldDialogTarget(locObj);
        if (!dialogTarget) {
            return;
        }
        const launchTag = launchTagForLocationObject(locObj);
        if (
            locObj.isRealInstance &&
            launchTag &&
            instanceClickAction === 'launch'
        ) {
            showLaunchDialog(
                launchTag,
                locObj.shortName || '',
                locObj.launchToken || locObj.shortName || '',
                {
                    worldName
                }
            );
            return;
        }
        openWorldDialog({
            worldId:
                locObj.isRealInstance && launchTag ? launchTag : dialogTarget,
            title: worldName || undefined
        });
    }

    if (
        locObj.isOffline ||
        locObj.isPrivate ||
        (locObj.isTraveling && !locObj.worldId)
    ) {
        const statusLabel = locObj.isOffline
            ? t('location.offline')
            : locObj.isPrivate
              ? t('location.private')
              : t('location.traveling');
        return <span className={className}>{statusLabel}</span>;
    }

    if (!locObj.isRealInstance && !locObj.tag) {
        return <span className={className}>—</span>;
    }

    return (
        <span
            className={cn(
                'x-location-world inline-flex min-w-0 items-center',
                className
            )}
        >
            {showRegion ? <RegionCodeBadge region={region} /> : null}
            {interactive ? (
                <Button
                    type="button"
                    variant="ghost"
                    className="hover:text-foreground h-auto min-w-0 shrink justify-start gap-1.5 p-0 text-left font-normal text-inherit hover:bg-transparent"
                    onClick={openLocationWorldDialog}
                >
                    {isUnlocked ? (
                        <UnlockIcon data-icon="inline-start" />
                    ) : null}
                    <span className="min-w-0 truncate">
                        <LocationPendingText
                            pending={showWorldName && worldNamePending}
                        >
                            {locationLabel}
                            {instanceName ? ` #${instanceName}` : ''}
                        </LocationPendingText>
                    </span>
                </Button>
            ) : (
                <span className="inline-flex min-w-0 items-center text-left">
                    {isUnlocked ? (
                        <UnlockIcon className="mr-1.5 size-4 shrink-0" />
                    ) : null}
                    <span className="min-w-0 truncate">
                        <LocationPendingText
                            pending={showWorldName && worldNamePending}
                        >
                            {locationLabel}
                            {instanceName ? ` #${instanceName}` : ''}
                        </LocationPendingText>
                    </span>
                </span>
            )}
            {showGroupName && (groupName || groupNamePending) ? (
                <LocationPendingText
                    pending={groupNamePending}
                    className="flex min-w-0"
                    placeholderClassName="ml-1 w-16"
                >
                    {interactive ? (
                        <Button
                            type="button"
                            variant="ghost"
                            className="hover:text-foreground ml-0.5 h-auto min-w-0 shrink justify-start p-0 text-left font-normal text-inherit hover:bg-transparent"
                            onClick={openLocationGroupDialog}
                        >
                            <span className="truncate">({groupName})</span>
                        </Button>
                    ) : (
                        <span className="ml-0.5 truncate">({groupName})</span>
                    )}
                </LocationPendingText>
            ) : null}
            {isClosed ? (
                <span className="text-muted-foreground ml-2 shrink-0 text-xs">
                    {t('dialog.world.instances.closed')}
                </span>
            ) : null}
            {locObj.strict ? (
                <LockIcon className="text-muted-foreground ml-1.5 size-4 shrink-0" />
            ) : null}
            {ownerLabel ? (
                <span className="text-muted-foreground ml-2 max-w-48 truncate text-xs">
                    {t('dialog.world.instances.instance_creator')}: {ownerLabel}
                </span>
            ) : null}
            {showPlayerSummary && playerSummary ? (
                <span className="text-muted-foreground ml-2 shrink-0 text-xs">
                    {playerSummary}
                </span>
            ) : null}
        </span>
    );
}
