import { AlertTriangleIcon, LockIcon } from 'lucide-react';
import {
    useEffect,
    useMemo,
    useState,
    type KeyboardEvent,
    type ReactElement,
    type ReactNode,
    type SyntheticEvent
} from 'react';
import { useTranslation } from 'react-i18next';

import { RegionCodeBadge } from '@/components/location/RegionCodeBadge';
import { timeToText } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import { openGroupDialog, openWorldDialog } from '@/services/dialogService';
import { accessTypeLocaleKeyMap } from '@/shared/constants/accessType';
import {
    getLocationText,
    parseLocation,
    translateAccessType
} from '@/shared/utils/location';
import { normalizeString as normalizeId } from '@/shared/utils/string';
import { useShellStore } from '@/state/shellStore';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    clearStaleOfflineLocation,
    normalizeLocationStatus,
    readFriendInstanceEpoch,
    readFriendRef,
    readFriendRefLocation,
    readFriendRefTravelingLocation,
    readFriendStatusSource,
    resolvePresenceLocation,
    timestampMsFromValue,
    type SidebarFriendRecord
} from './friendsSidebarModel';
import type { SidebarVirtualRow } from './friendsSidebarVirtualRowBuilder';

type SidebarLocationMetadata = Record<string, unknown> & {
    groupName?: unknown;
    instanceName?: unknown;
    isClosed?: unknown;
    region?: unknown;
    worldName?: unknown;
    worldNameHint?: unknown;
};

function recordValue(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : null;
}

export function FriendInstanceTimer({
    epoch,
    traveling = false
}: {
    epoch?: unknown;
    traveling?: boolean;
}) {
    const timeUnitLabels = useShellStore((state) => state.timeUnitLabels);
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

function sidebarLocationTarget(location: unknown, traveling: unknown = '') {
    const normalizedLocation = normalizeId(location);
    if (
        typeof traveling !== 'undefined' &&
        normalizedLocation === 'traveling'
    ) {
        return normalizeId(traveling);
    }
    return normalizedLocation;
}

function friendLocationHint(
    displaySource: SidebarFriendRecord | null | undefined
) {
    return (
        displaySource?.worldName ||
        displaySource?.$worldName ||
        displaySource?.travelingToWorld ||
        displaySource?.$travelingToWorld ||
        ''
    );
}

function friendGroupHint(
    displaySource: SidebarFriendRecord | null | undefined
) {
    const location = recordValue(displaySource?.$location);
    const group = recordValue(location?.group);
    const sourceGroup = recordValue(displaySource?.group);
    return (
        displaySource?.groupName ||
        displaySource?.$groupName ||
        location?.groupName ||
        group?.name ||
        group?.displayName ||
        sourceGroup?.name ||
        sourceGroup?.displayName ||
        ''
    );
}

export function resolveFriendRowLocationState({
    friend,
    isCurrentUser = false,
    isGroupByInstance = false
}: {
    friend: SidebarFriendRecord;
    isCurrentUser?: boolean;
    isGroupByInstance?: boolean;
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
        metadataHint: friendLocationHint(displaySource),
        metadataGroupHint: friendGroupHint(displaySource)
    };
}

function StaticLocationTooltip({
    disabled = false,
    content = '',
    children
}: {
    disabled?: boolean;
    content?: ReactNode;
    children: ReactNode;
}) {
    if (disabled || !content) {
        return children;
    }
    return (
        <Tooltip>
            <TooltipTrigger render={children as ReactElement} />
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
    tooltips = true,
    metadata,
    showInstanceIdInLocation = false,
    ageGatedInstancesVisible = false,
    className = ''
}: {
    location?: unknown;
    traveling?: unknown;
    hint?: unknown;
    link?: boolean;
    showGroupLink?: boolean;
    tooltips?: boolean;
    metadata?: SidebarLocationMetadata | null;
    showInstanceIdInLocation?: boolean;
    ageGatedInstancesVisible?: boolean;
    className?: string;
}) {
    const { t } = useTranslation();
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
    const worldNameHint = String(metadata?.worldNameHint || '');
    const worldName = String(metadata?.worldName || '');
    const worldDialogTitle = worldName || worldNameHint || undefined;
    const text = getLocationText(parsedLocation, {
        hint: metadata ? worldNameHint : String(hint || ''),
        worldName,
        accessTypeLabel,
        t
    });
    const instanceName = String(metadata?.instanceName || '');
    const tooltipContent = instanceName
        ? `${t('dialog.new_instance.instance_id')}: #${instanceName}`
        : '';
    const isAgeRestricted = Boolean(
        parsedLocation.ageGate && !ageGatedInstancesVisible
    );
    const showInstanceName = Boolean(showInstanceIdInLocation && instanceName);
    const isLocationLink = Boolean(
        link &&
        !parsedLocation.isPrivate &&
        !parsedLocation.isOffline &&
        currentLocation &&
        parsedLocation.worldId
    );

    function openWorld(event: Pick<SyntheticEvent, 'stopPropagation'>) {
        if (!isLocationLink) {
            return;
        }
        event?.stopPropagation?.();
        const worldDialogTarget =
            parsedLocation.isRealInstance && parsedLocation.tag
                ? parsedLocation.tag
                : parsedLocation.worldId;
        openWorldDialog({
            worldId: worldDialogTarget,
            title: worldDialogTitle
        });
    }

    function openWorldFromKeyboard(event: KeyboardEvent<HTMLSpanElement>) {
        if (!isLocationLink || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
        }
        event.preventDefault();
        openWorld(event);
    }

    function openGroup(event: Pick<SyntheticEvent, 'stopPropagation'>) {
        event?.stopPropagation?.();
        const groupId = normalizeId(parsedLocation.groupId);
        if (!groupId) {
            return;
        }
        openGroupDialog({
            groupId,
            title: metadata?.groupName ? String(metadata.groupName) : undefined
        });
    }

    function openGroupFromKeyboard(event: KeyboardEvent<HTMLSpanElement>) {
        event.stopPropagation();
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }
        event.preventDefault();
        openGroup(event);
    }

    if (!text) {
        return <span className="text-transparent">-</span>;
    }

    if (isAgeRestricted) {
        return (
            <StaticLocationTooltip
                disabled={!tooltips}
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
            <RegionCodeBadge region={String(metadata?.region || '')} />
            <StaticLocationTooltip
                disabled={!tooltips || !tooltipContent || showInstanceName}
                content={tooltipContent}
            >
                <span
                    role={isLocationLink ? 'button' : undefined}
                    tabIndex={isLocationLink ? 0 : undefined}
                    className={cn(
                        'x-location inline-flex max-w-full min-w-0 flex-nowrap items-center truncate overflow-hidden text-left',
                        isLocationLink
                            ? 'hover:text-primary cursor-pointer text-inherit underline-offset-4'
                            : 'cursor-default'
                    )}
                    onClick={isLocationLink ? openWorld : undefined}
                    onKeyDown={
                        isLocationLink ? openWorldFromKeyboard : undefined
                    }
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
                        {showGroupLink && metadata?.groupName ? (
                            <span
                                role="button"
                                tabIndex={0}
                                className="hover:text-primary focus-visible:ring-ring/50 ml-0.5 cursor-pointer text-left font-normal text-inherit focus-visible:ring-[3px] focus-visible:outline-none"
                                onClick={openGroup}
                                onKeyDown={openGroupFromKeyboard}
                            >
                                ({String(metadata.groupName)})
                            </span>
                        ) : null}
                    </span>
                </span>
            </StaticLocationTooltip>
            {metadata?.isClosed ? (
                <StaticLocationTooltip
                    disabled={!tooltips}
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

export function buildSidebarLocationMetadataEntry(row: SidebarVirtualRow) {
    if (row?.type === 'instance-header') {
        const currentLocation = sidebarLocationTarget(row.location);
        return {
            key: row.key,
            locationInfo: parseLocation(currentLocation),
            currentLocation
        };
    }

    if (row?.type !== 'friend' || !row.friend) {
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
        hint: locationState.metadataHint,
        groupHint: locationState.metadataGroupHint
    };
}
