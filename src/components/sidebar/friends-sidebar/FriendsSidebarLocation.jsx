import { AlertTriangleIcon, LockIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { RegionCodeBadge } from '@/components/location/RegionCodeBadge.jsx';
import { timeToText } from '@/lib/dateTime.js';
import { cn } from '@/lib/utils.js';
import { openGroupDialog, openWorldDialog } from '@/services/dialogService.js';
import { accessTypeLocaleKeyMap } from '@/shared/constants/accessType.js';
import {
    getLocationText,
    parseLocation,
    translateAccessType
} from '@/shared/utils/location.js';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    clearStaleOfflineLocation,
    normalizeId,
    normalizeLocationStatus,
    readFriendInstanceEpoch,
    readFriendRef,
    readFriendRefLocation,
    readFriendRefTravelingLocation,
    readFriendStatusSource,
    resolvePresenceLocation,
    timestampMsFromValue
} from './friendsSidebarModel.js';

export function FriendInstanceTimer({
    epoch,
    traveling = false,
    timeUnitLabels
}) {
    const [now, setNow] = useState(() => Date.now());
    const normalizedEpoch = timestampMsFromValue(epoch);
    const text = normalizedEpoch
        ? timeToText(now - normalizedEpoch, false, timeUnitLabels)
        : '-';

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            setNow(Date.now());
        }, 15000);
        return () => window.clearInterval(intervalId);
    }, []);

    return (
        <span className="inline-flex min-w-0 items-center">
            {traveling ? <Spinner className="mr-1 size-3 shrink-0" /> : null}
            <span className="truncate">{text}</span>
        </span>
    );
}

function sidebarLocationTarget(location, traveling) {
    const normalizedLocation = normalizeId(location);
    if (
        typeof traveling !== 'undefined' &&
        normalizedLocation === 'traveling'
    ) {
        return normalizeId(traveling);
    }
    return normalizedLocation;
}

function friendLocationHint(displaySource) {
    return (
        displaySource?.worldName ||
        displaySource?.$worldName ||
        displaySource?.travelingToWorld ||
        displaySource?.$travelingToWorld ||
        ''
    );
}

export function resolveFriendRowLocationState({
    friend,
    isCurrentUser = false,
    isGroupByInstance = false
}) {
    const displaySource = readFriendRef(friend);
    const statusSource = readFriendStatusSource(friend);
    const friendState = normalizeLocationStatus(
        statusSource?.stateBucket || statusSource?.state
    );
    const friendStateBucket = normalizeLocationStatus(
        statusSource?.stateBucket
    );
    const rawFriendLocation = isCurrentUser
        ? resolvePresenceLocation(friend)
        : readFriendRefLocation(friend);
    const friendLocation = clearStaleOfflineLocation(
        rawFriendLocation,
        friendState
    );
    const parsedFriendLocation = parseLocation(friendLocation);
    const isTraveling = normalizeLocationStatus(friendLocation) === 'traveling';
    const displayLocation = isTraveling ? 'traveling' : friendLocation;
    const displayTraveling = isTraveling
        ? readFriendRefTravelingLocation(friend) || undefined
        : undefined;
    const isActiveOrOffline =
        friendState === 'active' ||
        friendState === 'offline' ||
        friendStateBucket === 'active' ||
        friendStateBucket === 'offline';
    const groupByInstanceTimerVisible = Boolean(
        isGroupByInstance && !isActiveOrOffline && !statusSource?.pendingOffline
    );
    const groupByInstanceEpoch = readFriendInstanceEpoch(
        statusSource,
        isTraveling
    );
    const showLocationSubline = Boolean(
        displayLocation &&
            !statusSource?.pendingOffline &&
            !groupByInstanceTimerVisible &&
            (!isActiveOrOffline ||
                parsedFriendLocation.isRealInstance ||
                isTraveling)
    );

    return {
        displaySource,
        statusSource,
        friendState,
        friendLocation,
        parsedFriendLocation,
        isTraveling,
        displayLocation,
        displayTraveling,
        groupByInstanceTimerVisible,
        groupByInstanceEpoch,
        showLocationSubline,
        metadataCurrentLocation: sidebarLocationTarget(
            displayLocation,
            displayTraveling
        ),
        metadataHint: friendLocationHint(displaySource)
    };
}

function StaticLocationTooltip({ disabled = false, content = '', children }) {
    if (disabled || !content) {
        return children;
    }
    return (
        <Tooltip>
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            <TooltipContent>{content}</TooltipContent>
        </Tooltip>
    );
}

export function StaticSidebarLocation({
    location,
    traveling,
    hint = '',
    link = false,
    showGroupLink = false,
    metadata,
    t,
    showInstanceIdInLocation = false,
    ageGatedInstancesVisible = false,
    className = ''
}) {
    const currentLocation = sidebarLocationTarget(location, traveling);
    const parsedLocation = useMemo(
        () => parseLocation(currentLocation),
        [currentLocation]
    );
    const accessTypeLabel = translateAccessType(
        parsedLocation.accessTypeName,
        t,
        accessTypeLocaleKeyMap
    );
    const worldNameHint = metadata?.worldNameHint || '';
    const worldName = metadata?.worldName || '';
    const worldDialogTitle = worldName || worldNameHint || undefined;
    const text = getLocationText(parsedLocation, {
        hint: metadata ? worldNameHint : hint,
        worldName,
        accessTypeLabel,
        t
    });
    const instanceName = metadata?.instanceName || '';
    const tooltipContent = instanceName
        ? `${t('dialog.new_instance.instance_id')}: #${instanceName}`
        : '';
    const isAgeRestricted = Boolean(
        parsedLocation.ageGate && !ageGatedInstancesVisible
    );
    const showInstanceName = Boolean(
        showInstanceIdInLocation && instanceName
    );
    const isLocationLink = Boolean(
        link &&
            !parsedLocation.isPrivate &&
            !parsedLocation.isOffline &&
            currentLocation &&
            parsedLocation.worldId
    );

    function openWorld(event) {
        event?.stopPropagation?.();
        if (!isLocationLink) {
            return;
        }
        const worldDialogTarget =
            parsedLocation.isRealInstance && parsedLocation.tag
                ? parsedLocation.tag
                : parsedLocation.worldId;
        openWorldDialog({
            worldId: worldDialogTarget,
            title: worldDialogTitle
        });
    }

    function openWorldFromKeyboard(event) {
        if (!isLocationLink || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
        }
        event.preventDefault();
        openWorld(event);
    }

    function openGroup(event) {
        event?.stopPropagation?.();
        const groupId = normalizeId(parsedLocation.groupId);
        if (!groupId) {
            return;
        }
        openGroupDialog({
            groupId,
            title: metadata?.groupName || undefined
        });
    }

    if (!text) {
        return <span className="text-transparent">-</span>;
    }

    if (isAgeRestricted) {
        return (
            <StaticLocationTooltip
                content={t('dialog.user.info.instance_age_restricted_tooltip')}
            >
                <span
                    className={cn(
                        'text-muted-foreground inline-flex min-w-0 items-center gap-1',
                        className
                    )}
                >
                    <LockIcon className="size-3.5 shrink-0" />
                    <span className="min-w-0 truncate">
                        {t('dialog.user.info.instance_age_restricted')}
                    </span>
                </span>
            </StaticLocationTooltip>
        );
    }

    return (
        <span
            className={cn(
                'inline-flex max-w-full min-w-0 items-center',
                className
            )}
        >
            <RegionCodeBadge region={metadata?.region || ''} />
            <StaticLocationTooltip
                disabled={!tooltipContent || showInstanceName}
                content={tooltipContent}
            >
                <span
                    role={isLocationLink ? 'button' : undefined}
                    tabIndex={isLocationLink ? 0 : undefined}
                    className={cn(
                        'x-location inline-flex max-w-full min-w-0 flex-nowrap items-center truncate overflow-hidden text-left',
                        isLocationLink
                            ? 'cursor-pointer text-inherit underline-offset-4 hover:text-primary'
                            : 'cursor-default'
                    )}
                    onClick={openWorld}
                    onKeyDown={openWorldFromKeyboard}
                >
                    {normalizeLocationStatus(location) === 'traveling' ? (
                        <Spinner
                            aria-hidden="true"
                            aria-label={undefined}
                            role="presentation"
                            className="mr-1 size-3.5 shrink-0"
                        />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">
                        <span>{text}</span>
                        {showInstanceName ? (
                            <span className="ml-1">{`\u00b7 #${instanceName}`}</span>
                        ) : null}
                    </span>
                </span>
            </StaticLocationTooltip>
            {showGroupLink && metadata?.groupName ? (
                <Button
                    type="button"
                    variant="ghost"
                    className="ml-0.5 h-auto min-w-0 truncate p-0 text-left font-normal text-inherit hover:text-primary"
                    onClick={openGroup}
                    onKeyDown={(event) => event.stopPropagation()}
                >
                    ({metadata.groupName})
                </Button>
            ) : null}
            {metadata?.isClosed ? (
                <StaticLocationTooltip
                    content={t('dialog.user.info.instance_closed')}
                >
                    <AlertTriangleIcon className="text-muted-foreground ml-2 inline-block size-3.5 shrink-0" />
                </StaticLocationTooltip>
            ) : null}
            {parsedLocation.strict ? (
                <LockIcon className="text-muted-foreground ml-2 inline-block size-3.5 shrink-0" />
            ) : null}
        </span>
    );
}

export function buildSidebarLocationMetadataEntry(row) {
    if (row?.type === 'instance-header') {
        const currentLocation = sidebarLocationTarget(row.location);
        return {
            key: row.key,
            locationInfo: parseLocation(currentLocation),
            currentLocation
        };
    }

    if (row?.type !== 'friend') {
        return null;
    }

    const locationState = resolveFriendRowLocationState({
        friend: row.friend,
        isCurrentUser: row.isCurrentUser,
        isGroupByInstance: row.isGroupByInstance
    });
    if (!locationState.showLocationSubline) {
        return null;
    }

    return {
        key: row.key,
        locationInfo: parseLocation(locationState.metadataCurrentLocation),
        currentLocation: locationState.metadataCurrentLocation,
        hint: locationState.metadataHint
    };
}
