import { useMemo } from 'react';
import { AlertTriangleIcon, LockIcon, UnlockIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { cn } from '@/lib/utils.js';
import { groupProfileRepository } from '@/repositories/index.js';
import { openGroupDialog, openWorldDialog } from '@/services/dialogService.js';
import { entityQueryPolicies, queryKeys } from '@/services/entityQueryCacheService.js';
import { accessTypeLocaleKeyMap } from '@/shared/constants/accessType.js';
import { parseLocation, resolveRegion, translateAccessType } from '@/shared/utils/location.js';
import { useLaunchStore } from '@/state/launchStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from '@/ui/shadcn/tooltip.jsx';

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

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

function instanceLocation(instance) {
    return normalizeString(instance?.location || instance?.tag || instance?.$location?.tag);
}

function locationCacheKey(location) {
    const parsed = parseLocation(location);
    if (!parsed.worldId || !parsed.instanceId) {
        return '';
    }
    return `${parsed.worldId}:${parsed.instanceId}`;
}

function locationObjectCacheKey(locObj) {
    const worldId = normalizeString(locObj?.worldId);
    const instanceId = normalizeString(locObj?.instanceId);
    if (worldId && instanceId) {
        return `${worldId}:${instanceId}`;
    }
    return locationCacheKey(locObj?.tag);
}

function buildCachedInstanceMap(instances) {
    const map = new Map();
    if (!Array.isArray(instances)) {
        return map;
    }
    for (const instance of instances) {
        const location = instanceLocation(instance);
        if (location) {
            map.set(location, instance);
            const key = locationCacheKey(location);
            if (key) {
                map.set(key, instance);
            }
        }
    }
    return map;
}

function readInstanceDisplayName(instance) {
    return normalizeString(
        instance?.displayName ||
            instance?.name ||
            instance?.instanceDisplayName ||
            instance?.$location?.displayName
    );
}

function isInstanceClosed(instance) {
    return Boolean(instance?.closedAt || instance?.closed_at || instance?.isClosed);
}

function groupProfileName(group) {
    return normalizeString(group?.name || group?.displayName || group?.shortCode);
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

function instanceGroupName(instance) {
    return normalizeString(
        instance?.groupName ||
            instance?.group_name ||
            instance?.group?.name ||
            instance?.group?.displayName ||
            instance?.ref?.groupName ||
            instance?.ref?.group?.name ||
            instance?.ref?.group?.displayName ||
            instance?.$location?.groupName ||
            instance?.$location?.group?.name ||
            instance?.$location?.group?.displayName
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
    interactive = true,
    className = ''
}) {
    const { t } = useI18n();
    const storeEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentEndpoint = endpoint || storeEndpoint;
    const showLaunchDialog = useLaunchStore((state) => state.showLaunchDialog);
    const groupInstancesState = useRuntimeStore((state) => state.groupInstances);
    const groupInstances = groupInstancesState.endpoint === currentEndpoint ? groupInstancesState.instances : [];
    const groupInstancesRevision = groupInstancesState.endpoint === currentEndpoint
        ? groupInstancesState.lastLoadedAt || groupInstancesState.fetchedAt || groupInstancesState.status
        : '';
    const cachedInstances = useMemo(() => buildCachedInstanceMap(groupInstances), [groupInstances, groupInstancesRevision]);
    const locObj = useMemo(() => normalizeLocationObject(locationObject), [locationObject]);
    const cachedInstance = cachedInstances.get(locObj.tag) || cachedInstances.get(locationObjectCacheKey(locObj));
    const accessTypeName = translateAccessType(locObj.accessTypeName, t, accessTypeLocaleKeyMap);
    const instanceName = readInstanceDisplayName(cachedInstance) || normalizeString(locObj.instanceName);
    const region = resolveRegion(locObj);
    const isUnlocked = Boolean(
        (worldDialogShortName && locObj.shortName && worldDialogShortName === locObj.shortName) ||
            (worldDialogShortName && locObj.launchToken && worldDialogShortName === locObj.launchToken) ||
            (currentUserId && currentUserId === locObj.userId)
    );
    const isClosed = Boolean(cachedInstance && isInstanceClosed(cachedInstance));
    const groupId = normalizeString(locObj.groupId);
    const hintedGroupName = normalizeString(grouphint) || locationObjectGroupName(locObj) || instanceGroupName(cachedInstance);
    const groupProfileQuery = useQuery({
        queryKey: queryKeys.group(groupId, false, currentEndpoint),
        queryFn: () => groupProfileRepository.getGroupProfile({ groupId, endpoint: currentEndpoint, includeRoles: false }),
        enabled: Boolean(groupId),
        staleTime: entityQueryPolicies.group.staleTime,
        gcTime: entityQueryPolicies.group.gcTime,
        retry: entityQueryPolicies.group.retry,
        refetchOnWindowFocus: entityQueryPolicies.group.refetchOnWindowFocus
    });
    const groupName = useMemo(
        () => groupProfileName(groupProfileQuery.data) || hintedGroupName,
        [groupProfileQuery.data, hintedGroupName]
    );
    const ownerLabel = normalizeString(instanceOwnerName) || normalizeString(instanceOwner);
    const resolvedPlayerCount = Number(playerCount);
    const resolvedCapacity = Number(capacity);
    const hasPlayerCount = Number.isFinite(resolvedPlayerCount) && resolvedPlayerCount >= 0;
    const hasCapacity = Number.isFinite(resolvedCapacity) && resolvedCapacity > 0;
    const playerSummary = hasPlayerCount || hasCapacity
        ? `${hasPlayerCount ? resolvedPlayerCount : 0}${hasCapacity ? `/${resolvedCapacity}` : ''}`
        : '';

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
        if (locObj.isRealInstance && launchTag) {
            showLaunchDialog(launchTag, locObj.shortName || '', locObj.launchToken || locObj.shortName || '');
            return;
        }
        openWorldDialog({ worldId: dialogTarget });
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
            {region ? <span className={cn('flags mr-1.5 inline-block shrink-0', region)} /> : null}
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
                    {accessTypeName || locObj.accessTypeName || '—'}
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
