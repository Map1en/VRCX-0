import { useEffect, useMemo, useState } from 'react';
import { ChevronDownIcon, ClockIcon, UserIcon } from 'lucide-react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { Location } from '@/components/Location.jsx';
import { useVirtualSidebarRows } from '@/components/sidebar/virtualSidebarRows.js';
import { timeToText } from '@/lib/dateTime.js';
import { cn } from '@/lib/utils.js';
import { getTrustColor, TRUST_COLOR_DEFAULTS } from '@/lib/trustColors.js';
import {
    userStatusIndicatorClassName
} from '@/lib/userStatus.js';
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
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { configRepository, notificationRepository, userProfileRepository, vrchatSearchRepository } from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { tryOpenLaunchLocation } from '@/services/directAccessService.js';
import { selfInviteToInstance } from '@/services/launchService.js';
import { isActionRecent, recordRecentAction, subscribeRecentActions } from '@/services/recentActionService.js';
import { getNameColour, userImage } from '@/lib/entityMedia.js';
import { getFriendsSortFunction } from '@/shared/utils/friend.js';
import { isRealInstance } from '@/shared/utils/instance.js';
import { checkCanInvite, checkCanInviteSelf } from '@/shared/utils/invite.js';
import { parseLocation, resolveFriendPresenceLocation } from '@/shared/utils/location.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';

const groupToggleKeys = {
    me: 'isFriendsGroupMe',
    favorites: 'isFriendsGroupFavorites',
    online: 'isFriendsGroupOnline',
    active: 'isFriendsGroupActive',
    offline: 'isFriendsGroupOffline',
    sameInstance: 'sidebarGroupByInstanceCollapsed'
};

const defaultGroupState = {
    me: true,
    favorites: true,
    online: true,
    active: false,
    offline: true,
    sameInstance: true
};
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
function normalizeId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeLocationStatus(value) {
    const normalized = normalizeId(value).toLowerCase();
    if (normalized === 'offline:offline') {
        return 'offline';
    }
    if (normalized === 'private:private') {
        return 'private';
    }
    if (normalized === 'traveling:traveling') {
        return 'traveling';
    }
    return normalized;
}

function resolvePresenceLocation(profile) {
    return resolveFriendPresenceLocation(profile);
}

function readFriendRef(friend) {
    return friend?.ref && typeof friend.ref === 'object' ? friend.ref : friend;
}

function readFriendStatusSource(friend) {
    const ref = readFriendRef(friend);
    if (!ref || ref === friend) {
        return friend;
    }
    return { ...friend, ...ref, ref, pendingOffline: Boolean(friend?.pendingOffline || ref?.pendingOffline) };
}

function readFriendRefLocation(friend) {
    const source = readFriendStatusSource(friend);
    return normalizeId(source?.location || source?.$location?.tag);
}

function readFriendRefTravelingLocation(friend) {
    const source = readFriendStatusSource(friend);
    return normalizeId(source?.travelingToLocation || source?.$travelingToLocation);
}

function timestampMsFromValue(value) {
    if (value === null || value === undefined || value === '') {
        return 0;
    }
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) {
        return numberValue;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function clearStaleOfflineLocation(location, state) {
    const normalizedState = normalizeLocationStatus(state);
    if (
        (normalizedState === 'online' || normalizedState === 'active') &&
        normalizeLocationStatus(location) === 'offline'
    ) {
        return '';
    }
    return location;
}

function resolveCurrentInviteLocation(gameState, currentUserSnapshot) {
    const currentLocation = normalizeId(gameState?.currentLocation);
    if (currentLocation === 'traveling') {
        return normalizeId(gameState?.currentDestination);
    }
    return (
        currentLocation ||
        normalizeId(gameState?.currentDestination) ||
        normalizeId(currentUserSnapshot?.$locationTag || currentUserSnapshot?.location)
    );
}

function buildFavoriteIdSet(remoteFavoriteIds, localFriendFavorites) {
    const ids = new Set((remoteFavoriteIds || []).map(normalizeId).filter(Boolean));
    for (const values of Object.values(localFriendFavorites || {})) {
        for (const id of values || []) {
            const normalized = normalizeId(id);
            if (normalized) {
                ids.add(normalized);
            }
        }
    }
    return ids;
}

function applyCurrentUserSnapshot(nextUser) {
    if (!nextUser?.id) {
        return;
    }
    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: nextUser.id,
        currentUserDisplayName: nextUser.displayName || nextUser.username || '',
        currentUserSnapshot: nextUser
    });
}

function resolveTrustNameColour(friend, trustColor) {
    return getTrustColor(friend, trustColor);
}

function legacyStatusDotClassName(status) {
    const normalizedStatus = normalizeLocationStatus(status);
    if (normalizedStatus === 'active') {
        return 'bg-[var(--status-online)]';
    }
    if (normalizedStatus === 'join me' || normalizedStatus === 'joinme') {
        return 'bg-[var(--status-joinme)]';
    }
    if (normalizedStatus === 'ask me' || normalizedStatus === 'askme') {
        return 'bg-[var(--status-askme)]';
    }
    if (normalizedStatus === 'busy') {
        return 'bg-[var(--status-busy)]';
    }
    return '';
}

function normalizeStateBucket(value) {
    const normalized = normalizeLocationStatus(value);
    return normalized === 'online' || normalized === 'active' || normalized === 'offline'
        ? normalized
        : '';
}

function resolveCurrentUserStateBucket(currentUser) {
    const explicitState = normalizeStateBucket(currentUser?.stateBucket) || normalizeStateBucket(currentUser?.state);
    if (explicitState) {
        return explicitState;
    }
    if (normalizeLocationStatus(currentUser?.location || currentUser?.$location?.tag) === 'offline') {
        return 'offline';
    }
    return 'online';
}

function resolveSidebarStatusDotClassName(friend, currentUser, isCurrentUser = false) {
    const source = readFriendStatusSource(friend);
    if (!source) {
        return '';
    }
    const userId = normalizeId(source?.id || source?.userId);
    const status = normalizeLocationStatus(source?.status);
    const location = normalizeLocationStatus(source?.location || source?.$location?.tag);
    const isOnlineByCurrentSnapshot = (currentUser?.onlineFriends || []).includes(userId);
    const isActiveByCurrentSnapshot = (currentUser?.activeFriends || []).includes(userId);
    const isOfflineByCurrentSnapshot = (currentUser?.offlineFriends || []).includes(userId);
    const snapshotState = isOnlineByCurrentSnapshot
        ? 'online'
        : isActiveByCurrentSnapshot
            ? 'active'
            : isOfflineByCurrentSnapshot
                ? 'offline'
                : '';
    const state = normalizeLocationStatus(source?.stateBucket || source?.state || snapshotState);
    const stateBucket = normalizeLocationStatus(source?.stateBucket || snapshotState);

    if (!isCurrentUser && (state === 'active' || state === 'offline' || stateBucket === 'active' || stateBucket === 'offline')) {
        return '';
    }

    if (isCurrentUser || userId === currentUser?.id) {
        if (source?.pendingOffline || state === 'offline' || (location === 'offline' && state !== 'online')) {
            return '';
        }
        if (state === 'active') {
            return 'bg-[var(--status-active)]';
        }
        return legacyStatusDotClassName(status) || (state === 'online' ? 'bg-[var(--status-online)]' : '');
    }

    if (source?.pendingOffline) {
        return 'bg-[var(--status-offline)]';
    }

    if (source?.isFriend === false && friend?.isFriend === false) {
        return '';
    }

    if (
        status !== 'active' &&
        location === 'private' &&
        state === '' &&
        userId &&
        !isOnlineByCurrentSnapshot
    ) {
        return isActiveByCurrentSnapshot
            ? 'bg-[var(--status-active)]'
            : 'bg-[var(--status-offline)]';
    }
    if (state === 'active') {
        return 'bg-[var(--status-active)]';
    }
    if (location === 'offline' && state !== 'online') {
        return 'bg-[var(--status-offline)]';
    }
    if (status === 'active') {
        return 'bg-[var(--status-online)]';
    }
    if (status === 'join me' || status === 'joinme') {
        return 'bg-[var(--status-joinme)]';
    }
    if (status === 'ask me' || status === 'askme') {
        return 'bg-[var(--status-askme)]';
    }
    if (status === 'busy') {
        return 'bg-[var(--status-busy)]';
    }
    return '';
}

function toLegacyFriendSortRow(friend) {
    const ref = readFriendRef(friend);
    return {
        ...friend,
        name: friend?.name || friend?.displayName || friend?.username || friend?.id || '',
        ref: ref && ref !== friend
            ? { ...friend, ...ref }
            : friend
    };
}

function sortRows(rows, prefs) {
    const methods = [prefs.sidebarSortMethod1, prefs.sidebarSortMethod2, prefs.sidebarSortMethod3].filter(Boolean);
    if (!methods.length) {
        return rows;
    }
    const sort = getFriendsSortFunction(methods);
    return [...rows].sort((left, right) => sort(toLegacyFriendSortRow(left), toLegacyFriendSortRow(right)));
}

function lastLocationHasFriend(lastLocation, friendId) {
    const normalizedFriendId = normalizeId(friendId);
    if (!normalizedFriendId) {
        return false;
    }
    const friendList = lastLocation?.friendList;
    if (friendList instanceof Set || friendList instanceof Map) {
        return friendList.has(normalizedFriendId);
    }
    if (Array.isArray(friendList)) {
        return friendList.includes(normalizedFriendId);
    }
    return Boolean(friendList?.[normalizedFriendId]);
}

function sameInstanceLocationTag(friend, lastLocation) {
    const source = readFriendStatusSource(friend);
    if (normalizeLocationStatus(source?.stateBucket || source?.state) !== 'online') {
        return '';
    }
    const parsedLocation = source?.$location && typeof source.$location === 'object'
        ? source.$location
        : parseLocation(source?.location);
    let locationTag = normalizeId(parsedLocation?.tag || source?.location);
    if (!parsedLocation?.isRealInstance && lastLocationHasFriend(lastLocation, friend?.id)) {
        locationTag = normalizeId(lastLocation?.location);
    }
    return isRealInstance(locationTag) ? locationTag : '';
}

function buildSameInstanceGroups(rows, prefs, lastLocation) {
    const groupsByLocation = new Map();
    for (const friend of sortRows(rows, prefs)) {
        const locationTag = sameInstanceLocationTag(friend, lastLocation);
        if (!locationTag) {
            continue;
        }
        if (!groupsByLocation.has(locationTag)) {
            groupsByLocation.set(locationTag, []);
        }
        groupsByLocation.get(locationTag).push(friend);
    }
    return Array.from(groupsByLocation.entries())
        .filter(([, groupRows]) => groupRows.length > 1)
        .sort((left, right) => right[1].length - left[1].length)
        .map(([location, groupRows]) => ({ location, rows: groupRows }));
}

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
                                    onSelect={() => void actions.changeStatus(option.value)}>
                                    <i className={userStatusIndicatorClassName(option.value, { className: 'mr-2' })} />
                                    {t(option.labelKey)}
                                </CheckboxItem>
                            ))}
                        </Group>
                    </SubContent>
                </Sub>
                <MenuItem onSelect={() => void actions.editStatusDescription()}>
                    {t('view.settings.general.automation.change_status_description')}
                </MenuItem>
            </Group>
            {Array.isArray(friend?.statusHistory) && friend.statusHistory.length ? (
                <>
                    <Separator />
                    <Group>
                        <Sub>
                            <SubTrigger>
                                {t('dialog.social_status.history')}
                            </SubTrigger>
                            <SubContent side="left" align="start" className="w-56">
                                <Group>
                                    <CheckboxItem
                                        checked={!friend?.statusDescription}
                                        onSelect={() => void actions.setStatusDescription('')}>
                                        {t('dialog.gallery_select.none')}
                                    </CheckboxItem>
                                </Group>
                                <Separator />
                                <Group>
                                    {friend.statusHistory.slice(0, 10).map((item, index) => (
                                        <CheckboxItem
                                            key={`${item}:${index}`}
                                            checked={friend?.statusDescription === item}
                                            onSelect={() => void actions.setStatusDescription(item)}>
                                            <span className="max-w-44 truncate">{item}</span>
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
                            <SubContent side="left" align="start" className="w-56">
                                <Group>
                                    {statusPresets.map((preset, index) => (
                                        <MenuItem
                                            key={`${preset?.status || 'status'}:${preset?.statusDescription || ''}:${index}`}
                                            onSelect={() => void actions.applyStatusPreset(preset)}>
                                            <span className="max-w-44 truncate">{statusPresetLabel(preset, t)}</span>
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
    const recentInvite = recentActionVersion >= 0 && isActionRecent(friend?.id, 'Invite');
    const recentRequestInvite = recentActionVersion >= 0 && isActionRecent(friend?.id, 'Request Invite');
    return (
        <>
            <Group>
                <MenuItem onSelect={() => actions.open()}>
                    {t('common.actions.open')}
                </MenuItem>
            </Group>
            <Separator />
            <Group>
                <MenuItem disabled={!canUseFriendLocation} onSelect={() => void actions.launch(friendLocation)}>
                    {t('dialog.user.info.launch_invite_tooltip')}
                </MenuItem>
                <MenuItem disabled={!canUseFriendLocation} onSelect={() => void actions.selfInvite(friendLocation)}>
                    {t('dialog.user.info.self_invite_tooltip')}
                </MenuItem>
            </Group>
            <Separator />
            <Group>
                <MenuItem disabled={!canSendInvite} onSelect={() => void actions.invite(friend)}>
                    <span className="min-w-0 flex-1">{t('dialog.user.actions.invite')}</span>
                    {recentInvite ? <ClockIcon className="ml-auto text-muted-foreground" /> : null}
                </MenuItem>
                <MenuItem disabled={!canRequestInvite} onSelect={() => void actions.requestInvite(friend)}>
                    <span className="min-w-0 flex-1">{t('dialog.user.actions.request_invite')}</span>
                    {recentRequestInvite ? <ClockIcon className="ml-auto text-muted-foreground" /> : null}
                </MenuItem>
                <MenuItem disabled={!canBoop} onSelect={() => void actions.boop(friend)}>
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

function FriendInstanceTimer({ epoch, traveling = false }) {
    const [now, setNow] = useState(() => Date.now());
    const normalizedEpoch = timestampMsFromValue(epoch);
    const text = normalizedEpoch ? timeToText(now - normalizedEpoch) : '-';

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

function FriendRow({
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
    trustColor = TRUST_COLOR_DEFAULTS,
    currentUserSnapshot = null,
    recentActionVersion = 0
}) {
    const displaySource = readFriendRef(friend);
    const imageUrl = userImage(displaySource, true, '64');
    const displayName = displaySource?.displayName || displaySource?.username || friend?.displayName || friend?.username || friend?.id || 'Unknown';
    const nameStyle = randomUserColours && friend?.id
        ? { color: getNameColour(friend.id, isDarkMode) }
        : { color: displaySource?.$userColour || resolveTrustNameColour(displaySource, trustColor) };
    const statusDotClassName = resolveSidebarStatusDotClassName(friend, currentUserSnapshot, isCurrentUser);
    const statusSource = readFriendStatusSource(friend);
    const friendState = normalizeLocationStatus(statusSource?.stateBucket || statusSource?.state);
    const friendStateBucket = normalizeLocationStatus(statusSource?.stateBucket);
    const rawFriendLocation = isCurrentUser ? resolvePresenceLocation(friend) : readFriendRefLocation(friend);
    const friendLocation = clearStaleOfflineLocation(rawFriendLocation, friendState);
    const parsedFriendLocation = parseLocation(friendLocation);
    const isTraveling = normalizeLocationStatus(friendLocation) === 'traveling';
    const displayLocation = isTraveling ? 'traveling' : friendLocation;
    const displayTraveling = isTraveling ? readFriendRefTravelingLocation(friend) || undefined : undefined;
    const isActiveOrOffline = friendState === 'active' || friendState === 'offline' || friendStateBucket === 'active' || friendStateBucket === 'offline';
    const groupByInstanceTimerVisible = Boolean(isGroupByInstance && !isActiveOrOffline && !statusSource?.pendingOffline);
    const groupByInstanceEpoch = isTraveling
        ? statusSource?.$travelingToTime || statusSource?.travelingToTime || statusSource?.traveling_to_time
        : statusSource?.$location_at || statusSource?.locationAt || statusSource?.location_at;
    const showLocationSubline = Boolean(
        displayLocation &&
            !statusSource?.pendingOffline &&
            !groupByInstanceTimerVisible &&
            (!isActiveOrOffline || parsedFriendLocation.isRealInstance || isTraveling)
    );
    const canUseFriendLocation = Boolean(
        canUseFriendInstance &&
        parsedFriendLocation.isRealInstance && parsedFriendLocation.worldId && parsedFriendLocation.instanceId
    );
    const subline =
        statusSource?.pendingOffline
            ? t('side_panel.pending_offline')
            : displaySource?.statusDescription || '';

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div className="flex w-full items-center rounded-lg hover:bg-muted/50">
                    <Button
                        type="button"
                        variant="ghost"
                        className="h-auto min-w-0 flex-1 justify-start gap-2 p-1.5 text-left font-normal"
                        onClick={actions.open}>
                        <span className="relative flex size-9 shrink-0 items-center justify-center overflow-visible">
                            <span className="relative z-0 flex size-full items-center justify-center overflow-hidden rounded-full border bg-muted">
                                {imageUrl ? (
                                    <img src={imageUrl} alt="" className="size-full object-cover" />
                                ) : (
                                    <UserIcon data-icon="inline-start" className="text-muted-foreground" />
                                )}
                            </span>
                            {statusDotClassName ? (
                                <span
                                    className={cn(
                                        'absolute -bottom-0.5 -right-0.5 z-10 size-3.75 rounded-full border-3 border-background',
                                        statusDotClassName
                                    )}
                                />
                            ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium leading-5" style={nameStyle}>{displayName}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                                {groupByInstanceTimerVisible ? (
                                    <FriendInstanceTimer epoch={groupByInstanceEpoch} traveling={isTraveling} />
                                ) : showLocationSubline ? (
                                    <Location
                                        location={displayLocation}
                                        traveling={displayTraveling}
                                        hint={displaySource?.worldName || displaySource?.$worldName || displaySource?.travelingToWorld || displaySource?.$travelingToWorld || ''}
                                        link={false}
                                        stopPropagation
                                        asButton={false}
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

function estimateFriendSidebarRowSize(row) {
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

function FriendSectionHeader({ id, title, count, open, onToggle }) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto w-full justify-start px-0 py-1.5 pt-4 text-left text-xs font-normal hover:bg-transparent"
            onClick={() => onToggle(id)}>
            <ChevronDownIcon data-icon="inline-start" className={cn('transition-transform', !open && '-rotate-90')} />
            <span className="ml-1.5">
                {title}
                {count !== null && count !== undefined ? ` \u2014 ${count}` : ''}
            </span>
        </Button>
    );
}

function InstanceHeaderRow({ location, count }) {
    return (
        <div className="mb-1 flex items-center px-1.5 text-xs">
            <Location className="inline text-xs" location={location} asButton={false} />
            <span className="ml-1.5">{`(${count})`}</span>
        </div>
    );
}

export function FriendsSidebar({ prefs }) {
    const { t } = useI18n();
    const themeMode = useShellStore((state) => state.themeMode);
    const currentUser = useRuntimeStore((state) => state.auth.currentUserSnapshot);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const gameState = useRuntimeStore((state) => state.gameState);
    const currentLocation = gameState.currentLocation === 'traveling'
        ? gameState.currentDestination
        : gameState.currentLocation;
    const currentLocationPlayerIds = gameState.currentLocationPlayerIds;
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const orderedFriendIds = useFriendRosterStore((state) => state.orderedFriendIds);
    const onlineIds = useFriendRosterStore((state) => state.onlineIds);
    const activeIds = useFriendRosterStore((state) => state.activeIds);
    const offlineIds = useFriendRosterStore((state) => state.offlineIds);
    const loadStatus = useFriendRosterStore((state) => state.loadStatus);
    const detail = useFriendRosterStore((state) => state.detail);
    const favoriteFriendIds = useFavoriteStore((state) => state.favoriteFriendIds);
    const favoriteFriendGroups = useFavoriteStore((state) => state.favoriteFriendGroups);
    const groupedFavoriteFriendIdsByGroupKey = useFavoriteStore((state) => state.groupedFavoriteFriendIdsByGroupKey);
    const localFriendFavorites = useFavoriteStore((state) => state.localFriendFavorites);
    const localFriendFavoriteGroups = useFavoriteStore((state) => state.localFriendFavoriteGroups);
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const randomUserColours = usePreferencesStore((state) => state.randomUserColours);
    const trustColor = usePreferencesStore((state) => state.trustColor);
    const [openGroups, setOpenGroups] = useState(defaultGroupState);
    const [statusPresets, setStatusPresets] = useState([]);
    const [recentActionVersion, setRecentActionVersion] = useState(0);
    const isDarkMode = themeMode === 'dark' ||
        (typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
    const currentInviteLocation = useMemo(
        () => resolveCurrentInviteLocation(gameState, currentUser),
        [currentUser, gameState]
    );
    const currentLocationSnapshot = useMemo(
        () => ({
            location: currentLocation,
            friendList: new Set(Array.isArray(currentLocationPlayerIds) ? currentLocationPlayerIds : [])
        }),
        [currentLocation, currentLocationPlayerIds]
    );
    const friendsMap = useMemo(
        () => new Map(Object.entries(friendsById || {})),
        [friendsById]
    );
    const canInviteFromCurrentLocation = useMemo(
        () =>
            checkCanInvite(currentInviteLocation, {
                currentUserId,
                lastLocationStr: currentInviteLocation,
                cachedInstances: new Map()
            }),
        [currentInviteLocation, currentUserId]
    );

    useEffect(() => {
        let active = true;
        Promise.all([
            configRepository.getBool(groupToggleKeys.me, true),
            configRepository.getBool(groupToggleKeys.favorites, true),
            configRepository.getBool(groupToggleKeys.online, true),
            configRepository.getBool(groupToggleKeys.active, false),
            configRepository.getBool(groupToggleKeys.offline, true),
            configRepository.getBool(groupToggleKeys.sameInstance, false)
        ])
            .then(([me, favorites, online, activeFriends, offline, sameInstanceCollapsed]) => {
                if (!active) {
                    return;
                }
                setOpenGroups({
                    me: Boolean(me),
                    favorites: Boolean(favorites),
                    online: Boolean(online),
                    active: Boolean(activeFriends),
                    offline: Boolean(offline),
                    sameInstance: !sameInstanceCollapsed
                });
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;
        configRepository
            .getArray('VRCX_statusPresets', [])
            .then((nextPresets) => {
                if (active) {
                    setStatusPresets(Array.isArray(nextPresets) ? nextPresets : []);
                }
            })
            .catch(() => {
                if (active) {
                    setStatusPresets([]);
                }
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => subscribeRecentActions(() => {
        setRecentActionVersion((version) => version + 1);
    }), []);

    const rows = useMemo(() => orderedFriendIds.map((id) => friendsById[id]).filter(Boolean), [friendsById, orderedFriendIds]);
    const favoriteIds = useMemo(
        () => buildFavoriteIdSet(favoriteFriendIds, localFriendFavorites),
        [favoriteFriendIds, localFriendFavorites]
    );
    const allFavoriteGroupKeys = useMemo(
        () => [
            ...(favoriteFriendGroups || []).map((group) => group.key).filter(Boolean),
            ...((localFriendFavoriteGroups?.length ? localFriendFavoriteGroups : Object.keys(localFriendFavorites || {}))).map(
                (groupName) => `local:${groupName}`
            )
        ],
        [favoriteFriendGroups, localFriendFavoriteGroups, localFriendFavorites]
    );
    const selectedFavoriteGroupKeys = useMemo(() => {
        const configured = Array.isArray(prefs.sidebarFavoriteGroups) ? prefs.sidebarFavoriteGroups.filter(Boolean) : [];
        if (!configured.length) {
            return new Set(allFavoriteGroupKeys);
        }
        return new Set(configured);
    }, [allFavoriteGroupKeys, prefs.sidebarFavoriteGroups]);
    const hasFavoriteGroupFilter = useMemo(
        () => Array.isArray(prefs.sidebarFavoriteGroups) && prefs.sidebarFavoriteGroups.length > 0,
        [prefs.sidebarFavoriteGroups]
    );
    const selectedFavoriteIds = useMemo(() => {
        if (!allFavoriteGroupKeys.length) {
            return favoriteIds;
        }
        const ids = new Set();
        for (const key of selectedFavoriteGroupKeys) {
            if (key.startsWith('local:')) {
                for (const id of localFriendFavorites?.[key.slice(6)] || []) {
                    const normalized = normalizeId(id);
                    if (normalized) {
                        ids.add(normalized);
                    }
                }
            } else {
                for (const id of groupedFavoriteFriendIdsByGroupKey?.[key] || []) {
                    const normalized = normalizeId(id);
                    if (normalized) {
                        ids.add(normalized);
                    }
                }
            }
        }
        return ids;
    }, [allFavoriteGroupKeys, favoriteIds, groupedFavoriteFriendIdsByGroupKey, localFriendFavorites, selectedFavoriteGroupKeys]);
    const excludedFavoriteIds = hasFavoriteGroupFilter ? selectedFavoriteIds : favoriteIds;
    const sameInstanceGroups = useMemo(() => {
        if (!prefs.sidebarGroupByInstance) {
            return [];
        }
        return buildSameInstanceGroups(rows, prefs, currentLocationSnapshot);
    }, [currentLocationSnapshot, prefs, rows]);
    const sameInstanceIds = useMemo(
        () => new Set(sameInstanceGroups.flatMap((group) => group.rows.map((friend) => friend.id))),
        [sameInstanceGroups]
    );
    const onlineIdSet = useMemo(() => new Set(onlineIds), [onlineIds]);
    const favoriteRows = useMemo(
        () =>
            sortRows(
                rows.filter(
                (friend) => {
                    const source = readFriendStatusSource(friend);
                    const state = normalizeLocationStatus(source?.stateBucket || source?.state);
                    return selectedFavoriteIds.has(normalizeId(friend?.id)) &&
                        state === 'online' &&
                        !(prefs.isHideFriendsInSameInstance && sameInstanceIds.has(friend.id));
                }
                ),
                prefs
            ),
        [prefs, rows, sameInstanceIds, selectedFavoriteIds]
    );
    const onlineRows = useMemo(
        () =>
            sortRows(
                onlineIds
                    .map((id) => friendsById[id])
                    .filter(
                    (friend) =>
                        friend &&
                        !excludedFavoriteIds.has(normalizeId(friend.id)) &&
                        !(prefs.isHideFriendsInSameInstance && sameInstanceIds.has(friend.id))
                    ),
                prefs
            ),
        [excludedFavoriteIds, friendsById, onlineIds, prefs, sameInstanceIds]
    );
    const activeRows = useMemo(() => sortRows(activeIds.map((id) => friendsById[id]).filter(Boolean), prefs), [activeIds, friendsById, prefs]);
    const offlineRows = useMemo(() => sortRows(offlineIds.map((id) => friendsById[id]).filter(Boolean), prefs), [offlineIds, friendsById, prefs]);
    const favoriteGroupSections = useMemo(() => {
        if (!prefs.isSidebarDivideByFriendGroup) {
            return [];
        }
        const favoriteRowById = new Map(favoriteRows.map((friend) => [normalizeId(friend.id), friend]));
        const seen = new Set();
        const sections = [];

        const orderedRemoteGroups = [...(favoriteFriendGroups || [])].sort((left, right) => {
            const order = Array.isArray(prefs.sidebarFavoriteGroupOrder) ? prefs.sidebarFavoriteGroupOrder : [];
            const leftIndex = order.indexOf(left.key);
            const rightIndex = order.indexOf(right.key);
            if (leftIndex >= 0 && rightIndex >= 0) {
                return leftIndex - rightIndex;
            }
            if (leftIndex >= 0) {
                return -1;
            }
            if (rightIndex >= 0) {
                return 1;
            }
            return String(left.displayName || left.name || left.key || '').localeCompare(String(right.displayName || right.name || right.key || ''));
        });
        const orderedLocalGroups = [...(localFriendFavoriteGroups?.length ? localFriendFavoriteGroups : Object.keys(localFriendFavorites || {}))].sort((left, right) => {
            const order = Array.isArray(prefs.sidebarFavoriteGroupOrder) ? prefs.sidebarFavoriteGroupOrder : [];
            const leftIndex = order.indexOf(`local:${left}`);
            const rightIndex = order.indexOf(`local:${right}`);
            if (leftIndex >= 0 && rightIndex >= 0) {
                return leftIndex - rightIndex;
            }
            if (leftIndex >= 0) {
                return -1;
            }
            if (rightIndex >= 0) {
                return 1;
            }
            return String(left).localeCompare(String(right));
        });

        for (const group of orderedRemoteGroups) {
            if (!selectedFavoriteGroupKeys.has(group.key)) {
                continue;
            }
            const rowsForGroup = (groupedFavoriteFriendIdsByGroupKey?.[group.key] || [])
                .map((id) => favoriteRowById.get(normalizeId(id)))
                .filter(Boolean);
            if (rowsForGroup.length) {
                rowsForGroup.forEach((friend) => seen.add(normalizeId(friend.id)));
                sections.push({
                    key: group.key,
                    label: group.displayName || group.name || group.key,
                    rows: sortRows(rowsForGroup, prefs)
                });
            }
        }

        for (const groupName of orderedLocalGroups) {
            if (!selectedFavoriteGroupKeys.has(`local:${groupName}`)) {
                continue;
            }
            const rowsForGroup = (localFriendFavorites?.[groupName] || [])
                .map((id) => favoriteRowById.get(normalizeId(id)))
                .filter(Boolean);
            if (rowsForGroup.length) {
                rowsForGroup.forEach((friend) => seen.add(normalizeId(friend.id)));
                sections.push({
                    key: `local:${groupName}`,
                    label: groupName,
                    rows: sortRows(rowsForGroup, prefs)
                });
            }
        }

        const ungrouped = favoriteRows.filter((friend) => !seen.has(normalizeId(friend.id)));
        if (ungrouped.length) {
            sections.push({
                key: 'ungrouped',
                label: t('side_panel.favorite'),
                rows: ungrouped
            });
        }

        return sections;
    }, [
        favoriteFriendGroups,
        favoriteRows,
        groupedFavoriteFriendIdsByGroupKey,
        localFriendFavoriteGroups,
        localFriendFavorites,
        prefs,
        selectedFavoriteGroupKeys,
        t
    ]);

    function toggleSection(id) {
        setOpenGroups((current) => {
            const next = {
                ...current,
                [id]: !current[id]
            };
            const configKey = groupToggleKeys[id];
            if (configKey) {
                void configRepository.setBool(configKey, id === 'sameInstance' ? !next[id] : next[id]);
            }
            return next;
        });
    }

    function openFriend(friend) {
        openUserDialog({ userId: friend.id, title: friend.displayName || friend.username || undefined, seedData: friend });
    }

    async function launchFriendLocation(location) {
        const parsedLocation = parseLocation(location);
        if (!parsedLocation.isRealInstance || !parsedLocation.worldId || !parsedLocation.instanceId) {
            return;
        }
        try {
            const opened = await tryOpenLaunchLocation(location, parsedLocation.shortName, currentEndpoint);
            if (opened) {
                toast.success('VRChat launch request sent.');
                return;
            }
            toast.error('Unable to open this instance in VRChat.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to launch instance.');
        }
    }

    async function selfInviteToFriendLocation(location) {
        const parsedLocation = parseLocation(location);
        if (!parsedLocation.isRealInstance || !parsedLocation.worldId || !parsedLocation.instanceId) {
            return;
        }
        try {
            await selfInviteToInstance(location, parsedLocation.shortName, currentEndpoint);
            toast.success('Self invite sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to send self invite.');
        }
    }

    async function sendFriendInvite(friend) {
        const friendId = normalizeId(friend?.id);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        if (!currentInviteLocation) {
            toast.error('Cannot invite: no current VRChat location is available.');
            return;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error('Cannot invite from the current instance type.');
            return;
        }
        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error('Cannot invite: current location is not a concrete instance.');
            return;
        }
        const result = await confirm({
            title: 'Send invite?',
            description: friend.displayName || friendId,
            confirmText: 'Invite',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }
        try {
            const worldResponse = await vrchatSearchRepository.getWorlds(
                {},
                parsedLocation.worldId,
                { endpoint: currentEndpoint }
            );
            const inviteLocation = parsedLocation.tag || currentInviteLocation;
            await notificationRepository.sendInvite({
                receiverUserId: friendId,
                endpoint: currentEndpoint,
                params: {
                    instanceId: inviteLocation,
                    worldId: parsedLocation.worldId,
                    worldName: worldResponse.json?.name || parsedLocation.worldId,
                    rsvp: true
                }
            });
            recordRecentAction(friendId, 'Invite');
            toast.success('Invite sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to send invite.');
        }
    }

    async function requestFriendInvite(friend) {
        const friendId = normalizeId(friend?.id);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        const result = await confirm({
            title: 'Request invite?',
            description: friend.displayName || friendId,
            confirmText: 'Request Invite',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }
        try {
            await notificationRepository.sendRequestInvite({
                receiverUserId: friendId,
                endpoint: currentEndpoint,
                params: {
                    platform: 'standalonewindows'
                }
            });
            recordRecentAction(friendId, 'Request Invite');
            toast.success('Invite request sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to request invite.');
        }
    }

    async function sendFriendBoop(friend) {
        const friendId = normalizeId(friend?.id);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        try {
            const result = await prompt({
                title: 'Send boop',
                description: 'Optional emoji id. Leave blank to send the default boop.',
                inputValue: '',
                confirmText: 'Send',
                cancelText: 'Cancel'
            });
            if (!result.ok) {
                return;
            }
            await notificationRepository.sendBoop({
                userId: friendId,
                emojiId: result.value,
                endpoint: currentEndpoint
            });
            toast.success('Boop sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to send boop.');
        }
    }

    async function saveCurrentUserPatch(patch, { successMessage, errorMessage }) {
        if (!currentUserId) {
            toast.error('Cannot update profile: no current user session is available.');
            return;
        }
        try {
            const nextUser = await userProfileRepository.updateCurrentUser({
                userId: currentUserId,
                endpoint: currentEndpoint,
                params: patch
            });
            applyCurrentUserSnapshot(nextUser);
            toast.success(successMessage);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : errorMessage);
        }
    }

    async function changeCurrentUserStatus(status) {
        await saveCurrentUserPatch(
            { status },
            {
                successMessage: 'Social status updated.',
                errorMessage: 'Failed to update social status.'
            }
        );
    }

    async function setCurrentUserStatusDescription(statusDescription) {
        await saveCurrentUserPatch(
            { statusDescription },
            {
                successMessage: 'Status description updated.',
                errorMessage: 'Failed to update status description.'
            }
        );
    }

    async function editCurrentUserStatusDescription() {
        const result = await prompt({
            title: 'Edit status description',
            inputValue: currentUser?.statusDescription || '',
            multiline: true,
            confirmText: 'Save',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }
        await setCurrentUserStatusDescription(result.value);
    }

    async function applyCurrentUserStatusPreset(preset) {
        if (!preset?.status) {
            return;
        }
        const patch = { status: preset.status };
        if (Object.prototype.hasOwnProperty.call(preset, 'statusDescription')) {
            patch.statusDescription = preset.statusDescription || '';
        }
        await saveCurrentUserPatch(
            patch,
            {
                successMessage: 'Status updated.',
                errorMessage: 'Failed to update status.'
            }
        );
    }

    const rowActions = {
        open: openFriend,
        launch: launchFriendLocation,
        selfInvite: selfInviteToFriendLocation,
        invite: sendFriendInvite,
        requestInvite: requestFriendInvite,
        boop: sendFriendBoop,
        changeStatus: changeCurrentUserStatus,
        setStatusDescription: setCurrentUserStatusDescription,
        editStatusDescription: editCurrentUserStatusDescription,
        applyStatusPreset: applyCurrentUserStatusPreset
    };

    function pushSection(nextRows, { id, title, count, open }) {
        nextRows.push({
            type: 'section',
            key: `section:${id}`,
            id,
            title,
            count,
            open
        });
    }

    function pushFriendRows(nextRows, sectionKey, sectionRows, options = {}) {
        for (const friend of sectionRows) {
            const friendId = normalizeId(friend?.id);
            nextRows.push({
                type: 'friend',
                key: `friend:${sectionKey}:${friendId}`,
                friend,
                isCurrentUser: Boolean(options.isCurrentUser || friendId === normalizeId(currentUserId)),
                isGroupByInstance: Boolean(options.isGroupByInstance)
            });
        }
    }

    function pushFavoriteRows(nextRows) {
        if (!prefs.isSidebarDivideByFriendGroup) {
            pushFriendRows(nextRows, 'favorites', favoriteRows);
            return;
        }
        for (const section of favoriteGroupSections) {
            nextRows.push({
                type: 'favorite-group-header',
                key: `favorite-group:${section.key}`,
                label: section.label,
                count: section.rows.length
            });
            pushFriendRows(nextRows, `favorites:${section.key}`, section.rows);
        }
    }

    const virtualRows = useMemo(() => {
        const nextRows = [];

        if (loadStatus === 'running' && !rows.length) {
            nextRows.push({
                type: 'message',
                key: 'message:loading',
                className: '',
                text: detail || 'Loading friends'
            });
        }

        pushSection(nextRows, {
            id: 'me',
            title: t('side_panel.me'),
            open: openGroups.me
        });
        if (openGroups.me) {
            if (currentUser) {
                pushFriendRows(
                    nextRows,
                    'me',
                    [{ ...currentUser, stateBucket: resolveCurrentUserStateBucket(currentUser) }],
                    { isCurrentUser: true }
                );
            } else {
                nextRows.push({
                    type: 'message',
                    key: 'message:me',
                    className: 'px-2 py-1',
                    text: 'No current user snapshot.'
                });
            }
        }

        const pushSameInstance = () => {
            if (!sameInstanceGroups.length) {
                return;
            }
            pushSection(nextRows, {
                id: 'sameInstance',
                title: t('side_panel.same_instance'),
                count: sameInstanceGroups.length,
                open: openGroups.sameInstance
            });
            if (openGroups.sameInstance) {
                sameInstanceGroups.forEach((group, index) => {
                    nextRows.push({
                        type: 'instance-header',
                        key: `instance:${group.location}:${index}`,
                        location: group.location,
                        count: group.rows.length
                    });
                    pushFriendRows(nextRows, `sameInstance:${group.location}:${index}`, group.rows, { isGroupByInstance: true });
                });
            }
        };
        const pushFavorites = () => {
            if (!favoriteRows.length) {
                return;
            }
            pushSection(nextRows, {
                id: 'favorites',
                title: t('side_panel.favorite'),
                count: favoriteRows.length,
                open: openGroups.favorites
            });
            if (openGroups.favorites) {
                pushFavoriteRows(nextRows);
            }
        };

        if (prefs.isSameInstanceAboveFavorites) {
            pushSameInstance();
            pushFavorites();
        } else {
            pushFavorites();
            pushSameInstance();
        }

        pushSection(nextRows, {
            id: 'online',
            title: t('side_panel.online'),
            count: onlineRows.length,
            open: openGroups.online
        });
        if (openGroups.online) {
            pushFriendRows(nextRows, 'online', onlineRows);
        }

        pushSection(nextRows, {
            id: 'active',
            title: t('side_panel.active'),
            count: activeRows.length,
            open: openGroups.active
        });
        if (openGroups.active) {
            pushFriendRows(nextRows, 'active', activeRows);
        }

        pushSection(nextRows, {
            id: 'offline',
            title: t('side_panel.offline'),
            count: offlineRows.length,
            open: openGroups.offline
        });
        if (openGroups.offline) {
            pushFriendRows(nextRows, 'offline', offlineRows);
        }

        if (!rows.length && loadStatus !== 'running') {
            nextRows.push({
                type: 'message',
                key: 'message:empty',
                className: 'mt-4',
                text: detail || 'No friend roster snapshot.'
            });
        }

        nextRows.push({ type: 'footer', key: 'footer' });
        return nextRows;
    }, [
        activeRows,
        currentUser,
        currentUserId,
        detail,
        favoriteGroupSections,
        favoriteRows,
        loadStatus,
        offlineRows,
        onlineRows,
        openGroups,
        prefs.isSameInstanceAboveFavorites,
        prefs.isSidebarDivideByFriendGroup,
        rows.length,
        sameInstanceGroups,
        t
    ]);

    const {
        viewportRef,
        virtualItems,
        totalSize
    } = useVirtualSidebarRows(virtualRows, estimateFriendSidebarRowSize);

    function renderFriendVirtualRow(friend, isCurrentUser = false, isGroupByInstance = false) {
        const source = readFriendStatusSource(friend);
        const state = normalizeLocationStatus(source?.stateBucket || source?.state);
        const isOnlineFriend = onlineIdSet.has(friend.id) || state === 'online';
        return (
            <FriendRow
                friend={friend}
                isCurrentUser={isCurrentUser}
                isGroupByInstance={isGroupByInstance}
                canSendInvite={Boolean(gameState.isGameRunning && currentInviteLocation && canInviteFromCurrentLocation)}
                canRequestInvite={isOnlineFriend}
                canBoop={Boolean(currentUser?.isBoopingEnabled)}
                canUseFriendInstance={Boolean(
                    isOnlineFriend &&
                    checkCanInviteSelf(isCurrentUser ? resolvePresenceLocation(friend) : readFriendRefLocation(friend), {
                        currentUserId,
                        cachedInstances: new Map(),
                        friends: friendsMap
                    })
                )}
                actions={{
                    ...rowActions,
                    open: () => openFriend(friend)
                }}
                t={t}
                statusPresets={isCurrentUser ? statusPresets : []}
                randomUserColours={randomUserColours}
                isDarkMode={isDarkMode}
                trustColor={trustColor}
                currentUserSnapshot={currentUser}
                recentActionVersion={recentActionVersion}
            />
        );
    }

    function renderVirtualRow(row) {
        switch (row?.type) {
            case 'section':
                return (
                    <FriendSectionHeader
                        id={row.id}
                        title={row.title}
                        count={row.count}
                        open={row.open}
                        onToggle={toggleSection}
                    />
                );
            case 'favorite-group-header':
                return (
                    <div className="flex w-full items-center px-1.5 py-1 text-left text-xs text-muted-foreground">
                        {row.label} - {row.count}
                    </div>
                );
            case 'instance-header':
                return <InstanceHeaderRow location={row.location} count={row.count} />;
            case 'message':
                return (
                    <div className={cn('rounded-md border border-dashed p-3 text-xs text-muted-foreground', row.className)}>
                        {row.text}
                    </div>
                );
            case 'footer':
                return <div className="h-4" />;
            case 'friend':
            default:
                return renderFriendVirtualRow(row.friend, row.isCurrentUser, row.isGroupByInstance);
        }
    }

    return (
        <div ref={viewportRef} className="relative h-full overflow-auto overflow-x-hidden">
            <div className="px-1.5 py-2.5">
                <div className="relative w-full" style={{ height: `${totalSize}px` }}>
                    {virtualItems.map((item) => (
                        <div
                            key={item.key}
                            className="absolute left-0 top-0 w-full"
                            style={{ transform: `translateY(${item.start}px)` }}>
                            {renderVirtualRow(item.row)}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
