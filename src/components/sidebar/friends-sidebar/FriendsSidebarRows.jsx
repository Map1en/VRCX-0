import {
    AlertTriangleIcon,
    ChevronDownIcon,
    ClockIcon,
    LockIcon,
    UserIcon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { RegionCodeBadge } from '@/components/location/RegionCodeBadge.jsx';
import { timeToText } from '@/lib/dateTime.js';
import { getNameColour, userImage } from '@/lib/entityMedia.js';
import { TRUST_COLOR_DEFAULTS } from '@/lib/trustColors.js';
import { userStatusIndicatorClassName } from '@/lib/userStatus.js';
import { cn } from '@/lib/utils.js';
import { openGroupDialog, openWorldDialog } from '@/services/dialogService.js';
import { isActionRecent } from '@/services/recentActionService.js';
import { accessTypeLocaleKeyMap } from '@/shared/constants/accessType.js';
import { getLocationText, parseLocation, translateAccessType } from '@/shared/utils/location.js';
import { Button } from '@/ui/shadcn/button';
import {
    ContextMenu,
    ContextMenuCheckboxItem,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
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
    resolveSidebarStatusDotClassName,
    resolveTrustNameColour,
    timestampMsFromValue
} from './friendsSidebarModel.js';

const FRIEND_ROW_SIZE = 49;
const SECTION_HEADER_ROW_SIZE = 38;
const INSTANCE_HEADER_ROW_SIZE = 26;
const FAVORITE_GROUP_HEADER_ROW_SIZE = 26;
const SIDEBAR_MESSAGE_ROW_SIZE = 64;
const SIDEBAR_FOOTER_ROW_SIZE = 16;
const statusOptions = [
    { value: 'join me', labelKey: 'dialog.user.status.join_me' },
    { value: 'active', labelKey: 'dialog.user.status.online' },
    { value: 'ask me', labelKey: 'dialog.user.status.ask_me' },
    { value: 'busy', labelKey: 'dialog.user.status.busy' }
];

function CurrentUserActionItems({
    friend,
    actions,
    t,
    MenuItem,
    CheckboxItem,
    Group,
    Separator,
    Sub,
    SubTrigger,
    SubContent,
    statusPresets = []
}) {
    return (
        <>
            <Group>
                <MenuItem onSelect={() => actions.open()}>
                    {t('common.actions.open')}
                </MenuItem>
            </Group>
            <Separator />
            <Group>
                <Sub>
                    <SubTrigger>
                        {t('dialog.user.actions.edit_status')}
                    </SubTrigger>
                    <SubContent side="left" align="start" className="w-48">
                        <Group>
                            {statusOptions.map((option) => (
                                <CheckboxItem
                                    key={option.value}
                                    checked={friend?.status === option.value}
                                    onSelect={() =>
                                        void actions.changeStatus(option.value)
                                    }
                                >
                                    <i
                                        className={userStatusIndicatorClassName(
                                            option.value,
                                            { className: 'mr-2' }
                                        )}
                                    />
                                    {t(option.labelKey)}
                                </CheckboxItem>
                            ))}
                        </Group>
                    </SubContent>
                </Sub>
                <MenuItem onSelect={() => void actions.editStatusDescription()}>
                    {t(
                        'view.settings.general.automation.change_status_description'
                    )}
                </MenuItem>
            </Group>
            {Array.isArray(friend?.statusHistory) &&
            friend.statusHistory.length ? (
                <>
                    <Separator />
                    <Group>
                        <Sub>
                            <SubTrigger>
                                {t('dialog.social_status.history')}
                            </SubTrigger>
                            <SubContent
                                side="left"
                                align="start"
                                className="w-56"
                            >
                                <Group>
                                    <CheckboxItem
                                        checked={!friend?.statusDescription}
                                        onSelect={() =>
                                            void actions.setStatusDescription(
                                                ''
                                            )
                                        }
                                    >
                                        {t('dialog.gallery_select.none')}
                                    </CheckboxItem>
                                </Group>
                                <Separator />
                                <Group>
                                    {friend.statusHistory
                                        .slice(0, 10)
                                        .map((item, index) => (
                                            <CheckboxItem
                                                key={`${item}:${index}`}
                                                checked={
                                                    friend?.statusDescription ===
                                                    item
                                                }
                                                onSelect={() =>
                                                    void actions.setStatusDescription(
                                                        item
                                                    )
                                                }
                                            >
                                                <span className="max-w-44 truncate">
                                                    {item}
                                                </span>
                                            </CheckboxItem>
                                        ))}
                                </Group>
                            </SubContent>
                        </Sub>
                    </Group>
                </>
            ) : null}
            {statusPresets.length ? (
                <>
                    <Separator />
                    <Group>
                        <Sub>
                            <SubTrigger>
                                {t('dialog.social_status.presets')}
                            </SubTrigger>
                            <SubContent
                                side="left"
                                align="start"
                                className="w-56"
                            >
                                <Group>
                                    {statusPresets.map((preset, index) => (
                                        <MenuItem
                                            key={`${preset?.status || 'status'}:${preset?.statusDescription || ''}:${index}`}
                                            onSelect={() =>
                                                void actions.applyStatusPreset(
                                                    preset
                                                )
                                            }
                                        >
                                            <span className="max-w-44 truncate">
                                                {statusPresetLabel(preset, t)}
                                            </span>
                                        </MenuItem>
                                    ))}
                                </Group>
                            </SubContent>
                        </Sub>
                    </Group>
                </>
            ) : null}
        </>
    );
}

function FriendActionItems({
    friend,
    friendLocation,
    canUseFriendLocation,
    canSendInvite,
    canRequestInvite,
    canBoop,
    actions,
    t,
    MenuItem,
    Group,
    Separator,
    recentActionVersion = 0
}) {
    const recentInvite =
        recentActionVersion >= 0 && isActionRecent(friend?.id, 'Invite');
    const recentRequestInvite =
        recentActionVersion >= 0 &&
        isActionRecent(friend?.id, 'Request Invite');
    return (
        <>
            <Group>
                <MenuItem onSelect={() => actions.open()}>
                    {t('common.actions.open')}
                </MenuItem>
            </Group>
            <Separator />
            <Group>
                <MenuItem
                    disabled={!canUseFriendLocation}
                    onSelect={() => void actions.launch(friendLocation)}
                >
                    {t('dialog.user.info.launch_invite_tooltip')}
                </MenuItem>
                <MenuItem
                    disabled={!canUseFriendLocation}
                    onSelect={() => void actions.selfInvite(friendLocation)}
                >
                    {t('dialog.user.info.self_invite_tooltip')}
                </MenuItem>
            </Group>
            <Separator />
            <Group>
                <MenuItem
                    disabled={!canSendInvite}
                    onSelect={() => void actions.invite(friend)}
                >
                    <span className="min-w-0 flex-1">
                        {t('dialog.user.actions.invite')}
                    </span>
                    {recentInvite ? (
                        <ClockIcon className="text-muted-foreground ml-auto" />
                    ) : null}
                </MenuItem>
                <MenuItem
                    disabled={!canRequestInvite}
                    onSelect={() => void actions.requestInvite(friend)}
                >
                    <span className="min-w-0 flex-1">
                        {t('dialog.user.actions.request_invite')}
                    </span>
                    {recentRequestInvite ? (
                        <ClockIcon className="text-muted-foreground ml-auto" />
                    ) : null}
                </MenuItem>
                <MenuItem
                    disabled={!canBoop}
                    onSelect={() => void actions.boop(friend)}
                >
                    {t('dialog.user.actions.send_boop')}
                </MenuItem>
            </Group>
        </>
    );
}

function statusPresetLabel(preset, t) {
    if (preset?.statusDescription) {
        return preset.statusDescription;
    }
    const option = statusOptions.find((row) => row.value === preset?.status);
    return option ? t(option.labelKey) : preset?.status || '';
}

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

function resolveFriendRowLocationState({
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

export function FriendRow({
    friend,
    isCurrentUser,
    isGroupByInstance = false,
    statusPresets = [],
    canSendInvite,
    canRequestInvite,
    canBoop,
    canUseFriendInstance,
    actions,
    t,
    randomUserColours = false,
    isDarkMode = false,
    timeUnitLabels,
    trustColor = TRUST_COLOR_DEFAULTS,
    currentUserSnapshot = null,
    recentActionVersion = 0,
    locationMetadata = null,
    showInstanceIdInLocation = false,
    ageGatedInstancesVisible = false
}) {
    const displaySource = readFriendRef(friend);
    const imageUrl = userImage(displaySource, true, '64');
    const displayName =
        displaySource?.displayName ||
        displaySource?.username ||
        friend?.displayName ||
        friend?.username ||
        friend?.id ||
        'Unknown';
    const nameStyle =
        randomUserColours && friend?.id
            ? { color: getNameColour(friend.id, isDarkMode) }
            : {
                  color:
                      displaySource?.$userColour ||
                      resolveTrustNameColour(displaySource, trustColor)
              };
    const statusDotClassName = resolveSidebarStatusDotClassName(
        friend,
        currentUserSnapshot,
        isCurrentUser
    );
    const {
        statusSource,
        friendLocation,
        parsedFriendLocation,
        isTraveling,
        displayLocation,
        displayTraveling,
        groupByInstanceTimerVisible,
        groupByInstanceEpoch,
        showLocationSubline,
        metadataHint
    } = resolveFriendRowLocationState({
        friend,
        isCurrentUser,
        isGroupByInstance
    });
    const canUseFriendLocation = Boolean(
        canUseFriendInstance &&
        parsedFriendLocation.isRealInstance &&
        parsedFriendLocation.worldId &&
        parsedFriendLocation.instanceId
    );
    const subline = statusSource?.pendingOffline
        ? t('side_panel.pending_offline')
        : displaySource?.statusDescription || '';

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div className="hover:bg-muted/50 flex w-full items-center rounded-lg">
                    <Button
                        type="button"
                        variant="ghost"
                        className="h-auto min-w-0 flex-1 justify-start gap-2 p-1.5 text-left font-normal"
                        onClick={actions.open}
                    >
                        <span className="relative flex size-9 shrink-0 items-center justify-center overflow-visible">
                            <span className="bg-muted relative z-0 flex size-full items-center justify-center overflow-hidden rounded-full border">
                                {imageUrl ? (
                                    <img
                                        src={imageUrl}
                                        alt=""
                                        className="size-full object-cover"
                                    />
                                ) : (
                                    <UserIcon
                                        data-icon="inline-start"
                                        className="text-muted-foreground"
                                    />
                                )}
                            </span>
                            {statusDotClassName ? (
                                <span
                                    className={cn(
                                        'border-background absolute -right-0.5 -bottom-0.5 z-10 size-3.75 rounded-full border-3',
                                        statusDotClassName
                                    )}
                                />
                            ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span
                                className="block truncate leading-5 font-medium"
                                style={nameStyle}
                            >
                                {displayName}
                            </span>
                            <span className="text-muted-foreground block truncate text-xs">
                                {groupByInstanceTimerVisible ? (
                                    <FriendInstanceTimer
                                        epoch={groupByInstanceEpoch}
                                        traveling={isTraveling}
                                        timeUnitLabels={timeUnitLabels}
                                    />
                                ) : showLocationSubline ? (
                                    <StaticSidebarLocation
                                        location={displayLocation}
                                        traveling={displayTraveling}
                                        hint={metadataHint}
                                        link
                                        metadata={locationMetadata}
                                        t={t}
                                        showInstanceIdInLocation={
                                            showInstanceIdInLocation
                                        }
                                        ageGatedInstancesVisible={
                                            ageGatedInstancesVisible
                                        }
                                    />
                                ) : (
                                    subline
                                )}
                            </span>
                        </span>
                    </Button>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
                {isCurrentUser ? (
                    <CurrentUserActionItems
                        friend={friend}
                        actions={actions}
                        t={t}
                        MenuItem={ContextMenuItem}
                        CheckboxItem={ContextMenuCheckboxItem}
                        Group={ContextMenuGroup}
                        Separator={ContextMenuSeparator}
                        Sub={ContextMenuSub}
                        SubTrigger={ContextMenuSubTrigger}
                        SubContent={ContextMenuSubContent}
                        statusPresets={statusPresets}
                    />
                ) : (
                    <FriendActionItems
                        friend={friend}
                        friendLocation={friendLocation}
                        canUseFriendLocation={canUseFriendLocation}
                        canSendInvite={canSendInvite}
                        canRequestInvite={canRequestInvite}
                        canBoop={canBoop}
                        actions={actions}
                        t={t}
                        MenuItem={ContextMenuItem}
                        Group={ContextMenuGroup}
                        Separator={ContextMenuSeparator}
                        recentActionVersion={recentActionVersion}
                    />
                )}
            </ContextMenuContent>
        </ContextMenu>
    );
}

export function estimateFriendSidebarRowSize(row) {
    switch (row?.type) {
        case 'section':
            return SECTION_HEADER_ROW_SIZE;
        case 'instance-header':
            return INSTANCE_HEADER_ROW_SIZE;
        case 'favorite-group-header':
            return FAVORITE_GROUP_HEADER_ROW_SIZE;
        case 'message':
            return SIDEBAR_MESSAGE_ROW_SIZE;
        case 'footer':
            return SIDEBAR_FOOTER_ROW_SIZE;
        default:
            return FRIEND_ROW_SIZE;
    }
}

export function FriendSectionHeader({ id, title, count, open, onToggle }) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto w-full justify-start px-0 py-1.5 pt-4 text-left text-xs font-normal"
            onClick={() => onToggle(id)}
        >
            <ChevronDownIcon
                data-icon="inline-start"
                className={cn('transition-transform', !open && '-rotate-90')}
            />
            <span className="ml-1.5">
                {title}
                {count !== null && count !== undefined
                    ? ` \u2014 ${count}`
                    : ''}
            </span>
        </Button>
    );
}

export function InstanceHeaderRow({
    location,
    count,
    metadata = null,
    t,
    showInstanceIdInLocation = false,
    ageGatedInstancesVisible = false
}) {
    return (
        <div className="mb-1 flex min-w-0 items-center px-1.5 text-xs">
            <StaticSidebarLocation
                className="min-w-0 flex-1 text-xs"
                location={location}
                link
                showGroupLink
                metadata={metadata}
                t={t}
                showInstanceIdInLocation={showInstanceIdInLocation}
                ageGatedInstancesVisible={ageGatedInstancesVisible}
            />
            <span className="ml-1.5 shrink-0">{`(${count})`}</span>
        </div>
    );
}
