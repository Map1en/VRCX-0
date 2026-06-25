import { AlertTriangleIcon, LockIcon, UnlockIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
    locationObjectGroupName,
    locationObjectWorldName,
    launchTagForLocationObject,
    normalizeLocationObject,
    normalizeLocationText,
    firstFiniteLocationNumber,
    worldDialogTarget
} from '@/components/location/locationModel';
import { RegionCodeBadge } from '@/components/location/RegionCodeBadge';
import { useLocationMetadata } from '@/components/location/useLocationMetadata';
import { cn } from '@/lib/utils';
import { openGroupDialog, openWorldDialog } from '@/services/dialogService';
import { accessTypeLocaleKeyMap } from '@/shared/constants/accessType';
import { translateAccessType } from '@/shared/utils/location';
import { useLaunchStore } from '@/state/launchStore';
import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

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
    disableTooltip = false,
    instanceClickAction = 'launch',
    showGroupName = true,
    showPlayerSummary = true,
    className = ''
}: any) {
    const { t } = useTranslation();
    const showLaunchDialog = useLaunchStore(
        (state: any) => state.showLaunchDialog
    );
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
    const { region, instanceName, isClosed, groupName, worldName } =
        useLocationMetadata({
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
    const resolvedPlayerCount = firstFiniteLocationNumber(
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
        [worldName, accessTypeName || locObj.accessTypeName || '']
            .filter(Boolean)
            .join(' · ') || '—';

    function openLocationGroupDialog(event: any) {
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

    function openLocationWorldDialog(event: any) {
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
            <RegionCodeBadge region={region} />
            {interactive ? (
                <Button
                    type="button"
                    variant="ghost"
                    className="hover:text-primary h-auto min-w-0 shrink justify-start gap-1.5 p-0 text-left font-normal text-inherit"
                    onClick={openLocationWorldDialog}
                >
                    {isUnlocked ? (
                        <UnlockIcon data-icon="inline-start" />
                    ) : null}
                    <span className="min-w-0 truncate">
                        {locationLabel}
                        {instanceName ? ` #${instanceName}` : ''}
                    </span>
                </Button>
            ) : (
                <span className="inline-flex min-w-0 items-center text-left">
                    {isUnlocked ? (
                        <UnlockIcon className="mr-1.5 size-4 shrink-0" />
                    ) : null}
                    <span className="min-w-0 truncate">
                        {locationLabel}
                        {instanceName ? ` #${instanceName}` : ''}
                    </span>
                </span>
            )}
            {showGroupName && groupName ? (
                interactive ? (
                    <Button
                        type="button"
                        variant="ghost"
                        className="hover:text-primary ml-0.5 h-auto min-w-0 shrink justify-start p-0 text-left font-normal text-inherit"
                        onClick={openLocationGroupDialog}
                    >
                        <span className="truncate">({groupName})</span>
                    </Button>
                ) : (
                    <span className="ml-0.5 truncate">({groupName})</span>
                )
            ) : null}
            {isClosed ? (
                disableTooltip ? (
                    <AlertTriangleIcon
                        className="text-destructive ml-1 size-4 shrink-0"
                        title={t('dialog.user.info.instance_closed')}
                    />
                ) : (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <AlertTriangleIcon className="text-destructive ml-1 size-4 shrink-0" />
                        </TooltipTrigger>
                        <TooltipContent>
                            {t('dialog.user.info.instance_closed')}
                        </TooltipContent>
                    </Tooltip>
                )
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
