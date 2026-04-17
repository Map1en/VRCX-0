import { useMemo } from 'react';
import { AlertTriangleIcon, LockIcon, UnlockIcon } from 'lucide-react';

import { useI18n } from '@/app/hooks/use-i18n.js';
import {
    normalizeString,
    useLocationMetadata
} from '@/components/location/useLocationMetadata.js';
import { RegionCodeBadge } from '@/components/location/RegionCodeBadge.jsx';
import { cn } from '@/lib/utils.js';
import { openGroupDialog, openWorldDialog } from '@/services/dialogService.js';
import { accessTypeLocaleKeyMap } from '@/shared/constants/accessType.js';
import { parseLocation, translateAccessType } from '@/shared/utils/location.js';
import { useLaunchStore } from '@/state/launchStore.js';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from '@/ui/shadcn/tooltip';

function normalizeLocationObject(locationObject) {
    if (typeof locationObject === 'string') {
        return parseLocation(locationObject);
    }
    if (locationObject && typeof locationObject === 'object') {
        const rawTag = normalizeString(locationObject.tag || locationObject.location || locationObject.$location?.tag);
        const rawWorldId = normalizeString(locationObject.worldId || locationObject.world_id || locationObject.$location?.worldId);
        const rawInstanceId = normalizeString(locationObject.instanceId || locationObject.instance_id || locationObject.id || locationObject.$location?.instanceId);
        const synthesizedTag = rawInstanceId.includes(':')
            ? rawInstanceId
            : rawWorldId && rawInstanceId
                ? `${rawWorldId}:${rawInstanceId}`
                : '';
        const tag = rawTag || synthesizedTag;
        const parsed = parseLocation(tag);
        const instanceId = rawInstanceId && !rawInstanceId.includes(':') ? rawInstanceId : parsed.instanceId;
        return {
            ...parsed,
            ...locationObject,
            tag: tag || parsed.tag,
            isRealInstance: Boolean(locationObject.isRealInstance ?? parsed.isRealInstance),
            worldId: rawWorldId || parsed.worldId,
            instanceId,
            accessTypeName: locationObject.accessTypeName || parsed.accessTypeName,
            instanceName: locationObject.instanceName || parsed.instanceName,
            region: locationObject.region || locationObject.regionName || locationObject.region_name || parsed.region,
            shortName: locationObject.shortName || parsed.shortName,
            launchToken: locationObject.launchToken || locationObject.secureOrShortName || locationObject.secureName || locationObject.shortName || parsed.shortName,
            strict: Boolean(locationObject.strict ?? parsed.strict),
            groupId: locationObject.groupId || parsed.groupId,
            userId: locationObject.userId || parsed.userId
        };
    }
    return parseLocation('');
}

function locationObjectWorldName(locObj) {
    return normalizeString(
        locObj?.worldName ||
            locObj?.world_name ||
            locObj?.world?.name ||
            locObj?.ref?.worldName ||
            locObj?.ref?.world?.name ||
            locObj?.$worldName ||
            locObj?.$location?.worldName ||
            locObj?.$location?.world?.name ||
            locObj?.$location?.ref?.worldName ||
            locObj?.$location?.ref?.world?.name
    );
}

function locationObjectGroupName(locObj) {
    return normalizeString(
        locObj?.groupName ||
            locObj?.group?.name ||
            locObj?.group?.displayName ||
            locObj?.groupDisplayName ||
            locObj?.ref?.groupName ||
            locObj?.ref?.group?.name ||
            locObj?.ref?.group?.displayName ||
            locObj?.ref?.groupDisplayName ||
            locObj?.$location?.groupName ||
            locObj?.$location?.ref?.groupName ||
            locObj?.$location?.ref?.group?.name ||
            locObj?.$location?.ref?.group?.displayName
    );
}

function worldDialogTarget(locObj) {
    return normalizeString(locObj.worldId) || normalizeString(locObj.tag);
}

function launchTagForLocationObject(locObj) {
    const tag = normalizeString(locObj.tag);
    if (tag) {
        return tag;
    }
    const worldId = normalizeString(locObj.worldId);
    const instanceId = normalizeString(locObj.instanceId);
    return worldId && instanceId ? `${worldId}:${instanceId}` : '';
}

export function LocationWorld({
    locationObject,
    currentUserId = '',
    worldDialogShortName = '',
    grouphint = '',
    instanceOwner = '',
    instanceOwnerName = '',
    playerCount,
    capacity,
    endpoint = '',
    hint = '',
    interactive = true,
    instanceClickAction = 'launch',
    className = ''
}) {
    const { t } = useI18n();
    const showLaunchDialog = useLaunchStore((state) => state.showLaunchDialog);
    const locObj = useMemo(() => normalizeLocationObject(locationObject), [locationObject]);
    const currentLocation = launchTagForLocationObject(locObj);
    const accessTypeName = translateAccessType(locObj.accessTypeName, t, accessTypeLocaleKeyMap);
    const {
        region,
        instanceName,
        isClosed,
        groupName,
        worldName
    } = useLocationMetadata({
        locationInfo: locObj,
        currentLocation,
        endpoint,
        hint,
        worldNameHint: locationObjectWorldName(locObj),
        groupHint: normalizeString(grouphint) || locationObjectGroupName(locObj),
        instanceName: locObj.instanceName
    });
    const isUnlocked = Boolean(
        (worldDialogShortName && locObj.shortName && worldDialogShortName === locObj.shortName) ||
            (worldDialogShortName && locObj.launchToken && worldDialogShortName === locObj.launchToken) ||
            (currentUserId && currentUserId === locObj.userId)
    );
    const ownerLabel = normalizeString(instanceOwnerName) || normalizeString(instanceOwner);
    const resolvedPlayerCount = Number(playerCount);
    const resolvedCapacity = Number(capacity);
    const hasPlayerCount = Number.isFinite(resolvedPlayerCount) && resolvedPlayerCount >= 0;
    const hasCapacity = Number.isFinite(resolvedCapacity) && resolvedCapacity > 0;
    const playerSummary = hasPlayerCount || hasCapacity
        ? `${hasPlayerCount ? resolvedPlayerCount : 0}${hasCapacity ? `/${resolvedCapacity}` : ''}`
        : '';
    const locationLabel = [
        worldName,
        accessTypeName || locObj.accessTypeName || ''
    ].filter(Boolean).join(' · ') || '—';

    function openLocationGroupDialog(event) {
        if (!interactive) {
            return;
        }
        event?.stopPropagation?.();
        const groupId = normalizeString(locObj.groupId);
        if (!groupId) {
            return;
        }
        openGroupDialog({ groupId, title: groupName || undefined });
    }

    function openLocationWorldDialog(event) {
        if (!interactive) {
            return;
        }
        event?.stopPropagation?.();
        const dialogTarget = worldDialogTarget(locObj);
        if (!dialogTarget) {
            return;
        }
        const launchTag = launchTagForLocationObject(locObj);
        if (locObj.isRealInstance && launchTag && instanceClickAction === 'launch') {
            showLaunchDialog(launchTag, locObj.shortName || '', locObj.launchToken || locObj.shortName || '', {
                worldName
            });
            return;
        }
        openWorldDialog({
            worldId: locObj.isRealInstance && launchTag ? launchTag : dialogTarget,
            title: worldName || undefined
        });
    }

    if (locObj.isOffline || locObj.isPrivate || (locObj.isTraveling && !locObj.worldId)) {
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
        <span className={cn('x-location-world inline-flex min-w-0 items-center', className)}>
            <RegionCodeBadge region={region} />
            <span
                role={interactive ? 'button' : undefined}
                tabIndex={interactive ? 0 : undefined}
                className={cn(
                    'inline-flex min-w-0 items-center text-left',
                    interactive ? 'cursor-pointer hover:underline' : ''
                )}
                onClick={openLocationWorldDialog}
                onKeyDown={(event) => {
                    if (!interactive) {
                        return;
                    }
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openLocationWorldDialog(event);
                    }
                }}>
                {isUnlocked ? <UnlockIcon className="mr-1.5 size-4 shrink-0" /> : null}
                <span className="min-w-0 truncate">
                    {locationLabel}
                    {instanceName ? ` #${instanceName}` : ''}
                </span>
            </span>
            {groupName ? (
                <span
                    className={cn('ml-0.5 truncate', interactive ? 'cursor-pointer hover:underline' : '')}
                    role={interactive ? 'button' : undefined}
                    tabIndex={interactive ? 0 : undefined}
                    onClick={openLocationGroupDialog}
                    onKeyDown={(event) => {
                        if (!interactive) {
                            return;
                        }
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openLocationGroupDialog(event);
                        }
                    }}>
                    ({groupName})
                </span>
            ) : null}
            {isClosed ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <AlertTriangleIcon className="ml-1 size-4 shrink-0 text-destructive" />
                    </TooltipTrigger>
                    <TooltipContent>{t('dialog.user.info.instance_closed')}</TooltipContent>
                </Tooltip>
            ) : null}
            {locObj.strict ? <LockIcon className="ml-1.5 size-4 shrink-0 text-muted-foreground" /> : null}
            {ownerLabel ? (
                <span className="ml-2 max-w-48 truncate text-xs text-muted-foreground">
                    {t('dialog.world.instances.instance_creator')}: {ownerLabel}
                </span>
            ) : null}
            {playerSummary ? <span className="ml-2 shrink-0 text-xs text-muted-foreground">{playerSummary}</span> : null}
        </span>
    );
}
