import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    ArrowDownIcon,
    ArrowUpIcon,
    BanIcon,
    CheckIcon,
    ClockIcon,
    CopyIcon,
    DownloadIcon,
    EyeIcon,
    ExternalLinkIcon,
    HeartIcon,
    LanguagesIcon,
    LogOutIcon,
    MailIcon,
    MapPinIcon,
    MessageSquareIcon,
    MousePointerIcon,
    PencilIcon,
    RefreshCwIcon,
    SettingsIcon,
    Share2Icon,
    ShieldCheckIcon,
    TagIcon,
    UserIcon,
    UserMinusIcon,
    UsersIcon,
    VolumeXIcon,
    XIcon
} from 'lucide-react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { FavoriteActionMenu } from '@/components/favorites/FavoriteActionMenu.jsx';
import { InstanceActionBar } from '@/components/instances/InstanceActionBar.jsx';
import { Location } from '@/components/Location.jsx';
import { LocationWorld } from '@/components/LocationWorld.jsx';
import { timeToText } from '@/lib/dateTime.js';
import { convertFileUrlToImageUrl, copyTextToClipboard, openExternalLink, userImage } from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import { onPreferenceChanged } from '@/lib/preferenceEvents.js';
import { userStatusDotClassName } from '@/lib/userStatus.js';
import { backend } from '@/platform/tauri/backend.js';
import {
    AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS,
    avatarProfileRepository,
    avatarSearchProviderRepository,
    groupProfileRepository,
    userProfileRepository,
    vrchatAuthRepository,
    vrchatFavoriteRepository,
    worldProfileRepository
} from '@/repositories/index.js';
import { openAvatarDialog, openGroupDialog, openUserDialog, openWorldDialog } from '@/services/dialogService.js';
import { isActionRecent } from '@/services/recentActionService.js';
import { getTranslationConfig, translateText } from '@/services/translationService.js';
import { userDialogGroupSortingOptions, userDialogMutualFriendSortingOptions } from '@/shared/constants/user.js';
import { getFaviconUrl } from '@/shared/utils/urlUtils.js';
import { parseLocation } from '@/shared/utils/location.js';
import { useModalStore } from '@/state/modalStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import {
    EntityActionDropdown,
    EntityActionItem,
    EntityActionSeparator,
    EntityBlank,
    EntityDialogHeader,
    EntityDialogScaffold,
    EntityDialogTabContent,
    EntityDialogTabs,
    EntityInfoBlock,
    EntityInfoGrid,
    EntityRawJson
} from './EntityDialogScaffold.jsx';
import { PreviousInstancesTableDialog } from './PreviousInstancesTableDialog.jsx';
import { UserActivityPanel } from './UserActivityPanel.jsx';
import {
    firstNonGroupIdText,
    formatDate,
    formatStatsDate,
    formatStatsDuration,
    groupIdForRow,
    groupDisplayName,
    groupMemberVisibility,
    isGroupId,
    isOfflineLikeValue,
    normalizedText,
    resolveTabValue,
    summarizeEntityRow,
    userIdForRow,
    userRowSubtitle,
    userTravelingTimestamp,
    worldOccupantSubtitle
} from './user-dialog/userDialogRows.js';
import {
    buildUserDialogListViewData,
    buildUserDialogProfileSummary
} from './user-dialog/userDialogViewData.js';
import {
    isUserDialogDataTab,
    loadUserDialogTabData,
    userDialogDataKeyForTab
} from './user-dialog/userDialogTabService.js';
import { languageOptionLabel } from './user-dialog/userProfileFields.js';

const userDialogTabServiceRepositories = Object.freeze({
    avatarProfileRepository,
    avatarSearchProviderRepository,
    groupProfileRepository,
    userProfileRepository,
    vrchatFavoriteRepository,
    worldProfileRepository
});

function UserTitleLanguages({ languages }) {
    if (!languages.length) {
        return null;
    }

    return (
        <span className="inline-flex shrink-0 flex-wrap items-center gap-1">
            {languages.map((language) => {
                const key = String(language?.key || language?.value || '').trim();
                const label = languageOptionLabel(language);
                return (
                    <Badge
                        key={`${key}:${language?.value || ''}`}
                        variant="outline"
                        className="shrink-0 text-xs"
                        title={label}
                    >
                        {label}
                    </Badge>
                );
            })}
        </span>
    );
}

function downloadJsonFile(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function rowImage(row, kind) {
    if (!row || typeof row !== 'object') {
        return '';
    }
    if (kind === 'user') {
        return userImage(row, true, '64');
    }
    return convertFileUrlToImageUrl(
        row.thumbnailImageUrl || row.imageUrl || row.iconUrl || row.userIcon || row.currentAvatarImageUrl,
        128
    );
}

function UserGroupCard({
    group,
    editable = false,
    selectable = false,
    selected = false,
    busy = false,
    onVisibilityChange,
    onLeave,
    onMove,
    onSelectionChange
}) {
    const groupId = groupIdForRow(group);
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const [profile, setProfile] = useState(null);

    useEffect(() => {
        let active = true;
        setProfile(null);

        if (!groupId) {
            return () => {
                active = false;
            };
        }

        groupProfileRepository
            .getGroupProfile({ groupId, endpoint: currentEndpoint, includeRoles: false })
            .then((groupProfile) => {
                if (active) {
                    setProfile(groupProfile);
                }
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, [currentEndpoint, groupId]);

    const displayGroup = profile ? { ...group, ...profile } : group;
    const image = rowImage(displayGroup, 'group');
    const label = groupDisplayName(displayGroup);
    const visibility = groupMemberVisibility(group);
    const memberCount = Number(group?.memberCount ?? group?.member_count ?? group?.membershipCount ?? group?.membership_count ?? 0) || 0;
    return (
        <div className={cn('flex items-center gap-1 p-1 text-sm', editable ? 'w-56' : 'w-44')}>
            {selectable ? (
                <Checkbox
                    checked={selected}
                    disabled={busy}
                    aria-label={`Select ${label || 'group'}`}
                    className="shrink-0"
                    onCheckedChange={(checked) => onSelectionChange?.(group, checked === true)}
                />
            ) : null}
            <Button
                type="button"
                variant="ghost"
                className="h-auto min-w-0 flex-1 justify-start gap-2 px-1.5 py-1.5 text-left font-normal"
                onClick={() => openRow(displayGroup, 'group')}>
                {image ? (
                    <img src={image} alt="" className="size-9 shrink-0 rounded-full object-cover" />
                ) : (
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                        <UsersIcon data-icon="inline-start" className="size-4 text-muted-foreground" />
                    </span>
                )}
                <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="block truncate font-medium leading-snug">{label || '—'}</span>
                    <span className="inline-flex max-w-full items-center truncate text-xs text-muted-foreground">
                        {group?.isRepresenting || group?.is_representing ? <TagIcon className="mr-1.5 size-3.5 shrink-0" aria-label="Representing" /> : null}
                        {visibility !== 'visible' ? <EyeIcon className="mr-1.5 size-3.5 shrink-0" aria-label={`Visibility ${visibility}`} /> : null}
                        <span className="truncate">({memberCount})</span>
                    </span>
                </span>
            </Button>
            {editable ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button type="button" size="icon-sm" variant="ghost" className="ml-1 shrink-0" disabled={busy} title="Manage group membership" aria-label="Manage group membership">
                            <SettingsIcon data-icon="inline-start" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {onMove ? (
                            <>
                                <DropdownMenuGroup>
                                    <DropdownMenuItem onSelect={() => void onMove(group, 'top')}>
                                        <DownloadIcon className="rotate-180" />
                                        Move Top
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => void onMove(group, 'up')}>
                                        <ArrowUpIcon />
                                        Move Up
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => void onMove(group, 'down')}>
                                        <ArrowDownIcon />
                                        Move Down
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => void onMove(group, 'bottom')}>
                                        <DownloadIcon />
                                        Move Bottom
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                                <DropdownMenuSeparator />
                            </>
                        ) : null}
                        <DropdownMenuGroup>
                            <DropdownMenuItem onSelect={() => onVisibilityChange?.(group, 'visible')}>
                                Visibility: Everyone
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onVisibilityChange?.(group, 'friends')}>
                                Visibility: Friends
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onVisibilityChange?.(group, 'hidden')}>
                                Visibility: Hidden
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onSelect={() => onLeave?.(group)}>
                                <LogOutIcon />
                                Leave Group
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
        </div>
    );
}

function openRow(row, kind) {
    const id = typeof row === 'string' ? row : row?.id || row?.userId || row?.worldId || row?.avatarId || row?.groupId;
    if (!id) {
        return;
    }
    if (kind === 'user' || String(id).startsWith('usr_')) {
        openUserDialog({ userId: id, title: row?.displayName || row?.username || undefined, seedData: typeof row === 'object' ? row : null });
        return;
    }
    if (kind === 'world' || String(id).startsWith('wrld_') || String(id).startsWith('wld_')) {
        openWorldDialog({ worldId: id, title: row?.name || undefined, seedData: typeof row === 'object' ? row : null });
        return;
    }
    if (kind === 'avatar' || String(id).startsWith('avtr_')) {
        openAvatarDialog({ avatarId: id, title: row?.name || undefined, seedData: typeof row === 'object' ? row : null });
        return;
    }
    if (kind === 'group' || String(id).startsWith('grp_')) {
        openGroupDialog({ groupId: id, title: row?.name || undefined, seedData: typeof row === 'object' ? row : null });
    }
}

function EntityList({
    rows,
    kind = '',
    loading = false,
    error = '',
    editableGroups = false,
    selectableGroups = false,
    selectedGroupIds = null,
    groupActionId = '',
    onGroupVisibilityChange,
    onGroupLeave,
    onGroupMove,
    onGroupSelectionChange
}) {
    if (loading) {
        return <EntityBlank>Loading...</EntityBlank>;
    }
    if (error) {
        return <EntityBlank>{error}</EntityBlank>;
    }
    if (!rows.length) {
        return <EntityBlank />;
    }
    const nowMs = Date.now();
    return (
        <div className="flex flex-wrap items-start">
            {rows.map((row, index) => {
                if (kind === 'group') {
                    const groupId = groupIdForRow(row);
                    return (
                        <UserGroupCard
                            key={`${row?.id || row?.groupId || row?.name || 'group'}:${index}`}
                            group={row}
                            editable={editableGroups}
                            selectable={selectableGroups}
                            selected={Boolean(selectedGroupIds?.has(groupId))}
                            busy={Boolean(groupActionId && (groupActionId === groupId || groupActionId === '__bulk_groups__'))}
                            onVisibilityChange={onGroupVisibilityChange}
                            onLeave={onGroupLeave}
                            onMove={onGroupMove}
                            onSelectionChange={onGroupSelectionChange}
                        />
                    );
                }
                const image = rowImage(row, kind);
                const label = kind === 'user'
                    ? row?.displayName || row?.username || ''
                    : summarizeEntityRow(row);
                const subtitle = kind === 'user'
                    ? userRowSubtitle(row, nowMs)
                    : kind === 'world'
                        ? worldOccupantSubtitle(row)
                        : row?.authorName || row?.description || row?.shortCode || row?.username || '';
                const travelingTimestamp = kind === 'user' ? userTravelingTimestamp(row) : 0;
                const dotClassName = kind === 'user' ? userStatusDotClassName(row) : '';
                return (
                    <Button
                        key={`${row?.id || row?.userId || label}:${index}`}
                        type="button"
                        variant="ghost"
                        className="h-auto w-44 justify-start gap-2 px-1.5 py-1.5 text-left font-normal"
                        onClick={() => openRow(row, kind)}>
                        <span className="relative size-9 shrink-0">
                            {image ? (
                                <img src={image} alt="" className="size-9 rounded-full object-cover" />
                            ) : (
                                <span className="flex size-9 items-center justify-center rounded-full bg-muted">
                                    <UserIcon data-icon="inline-start" className="size-4 text-muted-foreground" />
                                </span>
                            )}
                            {dotClassName ? <span className={cn('absolute bottom-0 right-0 z-10 size-2.5 rounded-full border border-background', dotClassName)} /> : null}
                        </span>
                        <span className="min-w-0 flex-1 overflow-hidden">
                            <span className="block truncate font-medium leading-snug" style={kind === 'user' && row?.$userColour ? { color: row.$userColour } : undefined}>{label || '—'}</span>
                            {travelingTimestamp ? (
                                <span className="block truncate text-xs text-muted-foreground">
                                    <Spinner data-icon="inline-start" className="mr-1 inline-block" />
                                    {timeToText(Date.now() - travelingTimestamp)}
                                </span>
                            ) : subtitle ? <span className="block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
                        </span>
                    </Button>
                );
            })}
        </div>
    );
}

function UserGroupSection({
    title,
    rows,
    countText,
    editableGroups = false,
    selectableGroups = false,
    selectedGroupIds = null,
    groupActionId = '',
    onGroupVisibilityChange,
    onGroupLeave,
    onGroupMove,
    onGroupSelectionChange
}) {
    if (!rows.length) {
        return null;
    }

    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-baseline gap-1.5">
                <span className="text-base font-bold">{title}</span>
                <span className="text-xs text-muted-foreground">{countText || rows.length}</span>
            </div>
            <EntityList
                rows={rows}
                kind="group"
                editableGroups={editableGroups}
                selectableGroups={selectableGroups}
                selectedGroupIds={selectedGroupIds}
                groupActionId={groupActionId}
                onGroupVisibilityChange={onGroupVisibilityChange}
                onGroupLeave={onGroupLeave}
                onGroupMove={onGroupMove}
                onGroupSelectionChange={onGroupSelectionChange}
            />
        </section>
    );
}

function FavoriteWorldGroups({ groups, rows, search, filteredRows, loading, error }) {
    const groupedRows = groups.length
        ? groups.map((group) => ({
            key: group.name,
            label: group.displayName || group.name,
            visibility: group.visibility || '',
            rows: rows.filter((world) => world.$favoriteGroupKey === group.name || world.$favoriteGroup === (group.displayName || group.name))
        }))
        : Array.from(
            rows.reduce((map, world) => {
                const key = world.$favoriteGroup || 'Favorites';
                if (!map.has(key)) {
                    map.set(key, { key, label: key, visibility: '', rows: [] });
                }
                map.get(key).rows.push(world);
                return map;
            }, new Map()).values()
        );
    const [activeGroup, setActiveGroup] = useState(groupedRows[0]?.key || '');

    useEffect(() => {
        if (groupedRows.length && !groupedRows.some((group) => group.key === activeGroup)) {
            setActiveGroup(groupedRows[0].key);
        }
    }, [activeGroup, groupedRows]);

    if (search.trim()) {
        return <EntityList rows={filteredRows} kind="world" loading={loading} error={error} />;
    }
    if (loading || error || !groupedRows.length) {
        return <EntityList rows={rows} kind="world" loading={loading} error={error} />;
    }

    return (
        <Tabs value={activeGroup} onValueChange={setActiveGroup} className="gap-2">
            <TabsList variant="line" className="h-auto w-full justify-start overflow-x-auto rounded-none border-b px-0 pb-1">
                {groupedRows.map((group) => (
                    <TabsTrigger key={group.key} value={group.key} className="flex-none rounded-none px-3">
                        <span>{group.label}</span>
                        <span className="ml-1.5 text-xs text-muted-foreground">{group.rows.length}</span>
                    </TabsTrigger>
                ))}
            </TabsList>
            {groupedRows.map((group) => (
                <TabsContent key={group.key} value={group.key} className="m-0">
                    {group.visibility ? <div className="px-1 py-1 text-xs text-muted-foreground">{group.visibility}</div> : null}
                    <EntityList rows={group.rows} kind="world" />
                </TabsContent>
            ))}
        </Tabs>
    );
}

let lastUserDialogTab = 'info';

export function UserDialogTabbedView({
    profile,
    memo,
    detail,
    imageUrl,
    loadStatus,
    actionStatus,
    recentActionVersion = 0,
    reloadToken = 0,
    moderationState,
    extendedModerationState = { interactOff: false, muteChat: false },
    avatarOverrideState = { hideAvatar: false, showAvatar: false },
    isCurrentUser,
    isFriend,
    isFavorite,
    friendRequestState,
    platform,
    platformIcon: PlatformIcon,
    presenceLocation,
    currentAvatarTarget,
    homeLocationTarget,
    canInviteFromCurrentLocation,
    currentUserHasSharedConnectionsOptOut,
    currentUserBoopingEnabled,
    userStats = {},
    previousInstances = [],
    representedGroup = null,
    representedGroupStatus = 'idle',
    hideUserNotes = false,
    hideUserMemos = false,
    onPreviousInstancesChange,
    sameInstanceUsers = [],
    locationOwnerUser = null,
    locationOwnerGroup = null,
    locationInstance = null,
    locationFriendCount = 0,
    locationPlayerCount = 0,
    onRefreshLocation,
    onRefresh,
    onEditMemo,
    onFriendRequest,
    onInvite,
    onInviteMessage,
    onInviteRequest,
    onInviteRequestMessage,
    onBoop,
    onUnfriend,
    onModeration,
    onExtendedModeration,
    onAvatarOverride,
    onReportHacking,
    onGroupModeration,
    onEditSelfStatus,
    onEditSelfLanguages,
    onEditSelfBio,
    onEditSelfBioLinks,
    onEditSelfPronouns,
    onToggleSelfAvatarCopying,
    onToggleSelfBooping,
    onToggleSelfSharedConnections,
    onToggleSelfDiscordConnections,
    onToggleBadgeVisibility,
    onToggleBadgeShowcased
}) {
    const { t } = useI18n();
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore((state) => state.auth.currentUserSnapshot);
    const inGameGroupOrder = useRuntimeStore((state) => state.groupInstances.groupOrder);
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const prompt = useModalStore((state) => state.prompt);
    const confirm = useModalStore((state) => state.confirm);
    const [activeTab, setActiveTab] = useState('info');
    const [previousInstancesOpen, setPreviousInstancesOpen] = useState(false);
    const [remoteData, setRemoteData] = useState({
        groups: [],
        mutual: [],
        worlds: [],
        favoriteWorldGroups: [],
        favoriteWorlds: [],
        avatars: []
    });
    const [remoteStatus, setRemoteStatus] = useState({});
    const [remoteErrors, setRemoteErrors] = useState({});
    const [search, setSearch] = useState({
        mutual: '',
        groups: '',
        worlds: '',
        favoriteWorlds: '',
        avatars: ''
    });
    const [worldSort, setWorldSort] = useState('updated');
    const [worldOrder, setWorldOrder] = useState('descending');
    const [avatarSort, setAvatarSort] = useState('name');
    const [avatarReleaseStatus, setAvatarReleaseStatus] = useState('all');
    const [mutualSort, setMutualSort] = useState('alphabetical');
    const [groupSort, setGroupSort] = useState(isCurrentUser ? 'inGame' : 'alphabetical');
    const [vrchatConfigConstants, setVrchatConfigConstants] = useState(null);
    const [bioTranslation, setBioTranslation] = useState({ userId: '', source: '', text: '' });
    const [bioTranslationLoading, setBioTranslationLoading] = useState(false);
    const [groupActionId, setGroupActionId] = useState('');
    const [groupEditMode, setGroupEditMode] = useState(false);
    const [selectedGroupIds, setSelectedGroupIds] = useState(() => new Set());
    const effectiveAvatarReleaseStatus = profile.id === currentUserId ? avatarReleaseStatus : 'all';
    const loadContextRef = useRef({ endpoint: currentEndpoint, userId: profile.id, reloadToken });
    const handledReloadTokenRef = useRef(reloadToken);
    const {
        profileGroups,
        mutualFriends,
        profileWorlds,
        favoriteWorlds,
        profileAvatars,
        bioLinks,
        filteredMutualFriends,
        visibleMutualFriends,
        effectiveGroupSort,
        sortedProfileGroups,
        filteredProfileGroups,
        selectedUserGroups,
        filteredProfileWorlds,
        filteredFavoriteWorlds,
        visibleProfileAvatars,
        tabs,
        groupSearchActive
    } = buildUserDialogListViewData({
        profile,
        remoteData,
        remoteStatus,
        friendsById,
        search,
        mutualSort,
        groupSort,
        isCurrentUser,
        inGameGroupOrder,
        selectedGroupIds,
        effectiveAvatarReleaseStatus,
        avatarSort,
        currentUserHasSharedConnectionsOptOut
    });
    const isRecentDialogAction = (actionType) =>
        recentActionVersion >= 0 && isActionRecent(profile.id, actionType);
    const recentDialogShortcut = (actionType) =>
        isRecentDialogAction(actionType) ? <ClockIcon className="size-3.5 text-muted-foreground" /> : null;
    useEffect(() => {
        loadContextRef.current = {
            endpoint: currentEndpoint,
            userId: profile.id,
            reloadToken,
            worldSort,
            worldOrder,
            avatarSort,
            avatarReleaseStatus: effectiveAvatarReleaseStatus
        };
        setRemoteData({
            groups: [],
            mutual: [],
            worlds: [],
            favoriteWorldGroups: [],
            favoriteWorlds: [],
            avatars: []
        });
        setRemoteStatus({});
        setRemoteErrors({});
        setSearch({ mutual: '', groups: '', worlds: '', favoriteWorlds: '', avatars: '' });
        const nextTab = resolveTabValue(tabs, lastUserDialogTab);
        lastUserDialogTab = nextTab;
        setActiveTab(nextTab);
    }, [
        currentEndpoint,
        currentUserHasSharedConnectionsOptOut,
        isCurrentUser,
        profile.id,
        reloadToken
    ]);

    useLayoutEffect(() => {
        setAvatarSort('name');
        setAvatarReleaseStatus('all');
    }, [currentUserId, profile.id]);

    function isCurrentLoadContext(context) {
        return (
            loadContextRef.current.endpoint === context.endpoint &&
            loadContextRef.current.userId === context.userId &&
            loadContextRef.current.reloadToken === context.reloadToken &&
            (context.tab !== 'worlds' ||
                (context.worldSort === worldSort && context.worldOrder === worldOrder)) &&
            (context.tab !== 'avatars' ||
                (context.avatarSort === avatarSort && context.avatarReleaseStatus === effectiveAvatarReleaseStatus))
        );
    }

    async function loadTab(tab, { force = false } = {}) {
        if (!profile.id || (!force && (remoteStatus[tab] === 'running' || remoteStatus[tab] === 'ready'))) {
            return;
        }
        if (!isUserDialogDataTab(tab)) {
            return;
        }

        const loadContext = {
            endpoint: currentEndpoint,
            userId: profile.id,
            reloadToken,
            tab,
            worldSort,
            worldOrder,
            avatarSort,
            avatarReleaseStatus: effectiveAvatarReleaseStatus
        };
        setRemoteStatus((current) => ({ ...current, [tab]: 'running' }));
        setRemoteErrors((current) => ({ ...current, [tab]: '' }));
        try {
            const { rows, favoriteWorldGroups } = await loadUserDialogTabData({
                tab,
                userId: profile.id,
                endpoint: currentEndpoint,
                currentUserId,
                worldSort,
                worldOrder,
                avatarSort,
                effectiveAvatarReleaseStatus,
                repositories: userDialogTabServiceRepositories
            });

            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            const dataKey = userDialogDataKeyForTab(tab);
            setRemoteData((current) => ({
                ...current,
                [dataKey]: rows,
                ...(tab === 'favorite-worlds' ? { favoriteWorldGroups } : {})
            }));
            setRemoteStatus((current) => ({ ...current, [tab]: 'ready' }));
        } catch (error) {
            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            setRemoteStatus((current) => ({ ...current, [tab]: 'error' }));
            setRemoteErrors((current) => ({
                ...current,
                [tab]: error instanceof Error ? error.message : 'Failed to load tab data.'
            }));
        }
    }

    function changeTab(tab) {
        lastUserDialogTab = resolveTabValue(tabs, tab);
        setActiveTab(lastUserDialogTab);
    }

    function changeWorldSort(value) {
        loadContextRef.current = { ...loadContextRef.current, worldSort: value };
        setWorldSort(value);
        setRemoteStatus((current) => ({ ...current, worlds: '' }));
    }

    function changeWorldOrder(value) {
        loadContextRef.current = { ...loadContextRef.current, worldOrder: value };
        setWorldOrder(value);
        setRemoteStatus((current) => ({ ...current, worlds: '' }));
    }

    function changeAvatarSort(value) {
        loadContextRef.current = { ...loadContextRef.current, avatarSort: value };
        setAvatarSort(value);
        if (profile.id === currentUserId) {
            setRemoteStatus((current) => ({ ...current, avatars: '' }));
        }
    }

    function changeAvatarReleaseStatus(value) {
        loadContextRef.current = { ...loadContextRef.current, avatarReleaseStatus: value };
        setAvatarReleaseStatus(value);
        if (profile.id === currentUserId) {
            setRemoteStatus((current) => ({ ...current, avatars: '' }));
        }
    }

    useEffect(() => {
        const shouldForceReload = reloadToken > 0 && handledReloadTokenRef.current !== reloadToken;
        if (shouldForceReload) {
            handledReloadTokenRef.current = reloadToken;
        }
        void loadTab(activeTab, { force: shouldForceReload });
    }, [activeTab, currentEndpoint, currentUserId, profile.id, reloadToken]);

    useEffect(() => {
        let active = true;
        vrchatAuthRepository
            .getConfig({ endpoint: currentEndpoint })
            .then((response) => {
                if (active) {
                    setVrchatConfigConstants(response?.json?.constants || null);
                }
            })
            .catch(() => {
                if (active) {
                    setVrchatConfigConstants(null);
                }
            });
        return () => {
            active = false;
        };
    }, [currentEndpoint]);

    useEffect(() => {
        if (activeTab === 'worlds') {
            void loadTab('worlds', { force: true });
        }
    }, [worldOrder, worldSort]);

    useEffect(() => {
        if (activeTab === 'avatars' && profile.id === currentUserId) {
            void loadTab('avatars', { force: true });
        }
    }, [avatarReleaseStatus, avatarSort]);

    useEffect(() => onPreferenceChanged(AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS, () => {
        if (profile.id === currentUserId) {
            return;
        }
        setRemoteData((current) => ({ ...current, avatars: [] }));
        setRemoteStatus((current) => ({ ...current, avatars: '' }));
        setRemoteErrors((current) => ({ ...current, avatars: '' }));
        if (activeTab === 'avatars') {
            void loadTab('avatars', { force: true });
        }
    }), [activeTab, avatarReleaseStatus, avatarSort, currentEndpoint, currentUserId, profile.id]);

    useEffect(() => {
        setBioTranslation({ userId: profile.id || '', source: profile.bio || '', text: '' });
        setBioTranslationLoading(false);
    }, [profile.id, profile.bio]);

    useEffect(() => {
        setGroupEditMode(false);
        setSelectedGroupIds(new Set());
        setMutualSort('alphabetical');
        setGroupSort(isCurrentUser ? 'inGame' : 'alphabetical');
    }, [currentUserId, profile.id]);

    const userUrl = profile.id ? `https://vrchat.com/home/user/${profile.id}` : '';
    const username = profile.username && profile.username !== profile.id ? profile.username : '';
    const userSubtitle = username;
    const pronounsText = Array.isArray(profile.pronouns) ? profile.pronouns.join(', ') : profile.pronouns;
    const {
        previousDisplayNames,
        previousDisplayNamesTitle,
        statusStateText,
        userGroupSections,
        selectedGroupCount,
        ownGroupCountText,
        remainingGroupCountText,
        userTimeSpent,
        userJoinCount,
        lastSeen,
        profileLanguages,
        mutualFriendCount,
        friendNumber
    } = buildUserDialogProfileSummary({
        profile,
        userStats,
        sortedProfileGroups,
        selectedUserGroups,
        mutualFriends,
        isCurrentUser,
        vrchatConfigConstants,
        currentUserSnapshot
    });
    const currentAvatarDisplayName = String(profile.currentAvatarName || profile.avatarName || '').trim();
    const currentAvatarDialogArgs = {
        avatarId: currentAvatarTarget,
        ...(currentAvatarDisplayName ? {
            title: currentAvatarDisplayName,
            seedData: {
                id: currentAvatarTarget,
                name: currentAvatarDisplayName,
                imageUrl: profile.currentAvatarImageUrl || '',
                thumbnailImageUrl: profile.currentAvatarThumbnailImageUrl || ''
            }
        } : {})
    };
    const fallbackAvatarTarget = typeof profile.fallbackAvatar === 'string' ? profile.fallbackAvatar.trim() : '';
    const fallbackAvatarDialogArgs = {
        avatarId: fallbackAvatarTarget,
        title: 'Fallback Avatar'
    };
    const visibleHomeLocationTarget = isOfflineLikeValue(homeLocationTarget) ? '' : homeLocationTarget;
    const visiblePresenceLocation = isOfflineLikeValue(presenceLocation) ? '' : presenceLocation;
    const visiblePresenceParsedLocation = visiblePresenceLocation ? parseLocation(visiblePresenceLocation) : null;
    const locationWorldTitle = normalizedText(
        profile.worldName ||
            profile.$worldName ||
            profile.$location?.worldName ||
            profile.$location?.name ||
            profile.$location?.world?.name
    );
    const translatedBioActive = Boolean(bioTranslation.userId === profile.id && bioTranslation.source === (profile.bio || '') && bioTranslation.text);
    const visibleBio = translatedBioActive ? bioTranslation.text : profile.bio || '—';
    const locationUsers = [];
    const locationUserRowsByKey = new Map();

    function addLocationUser(user, subtitle = '') {
        if (!user) {
            return;
        }
        const source = typeof user === 'string'
            ? { id: user, userId: user, displayName: user }
            : user;
        const userId = normalizedText(source.id || source.userId || source.targetUserId);
        const displayName = normalizedText(source.displayName || source.username || source.name || userId);
        const key = userId || `display:${displayName.toLowerCase()}:${locationUsers.length}`;
        if (!key) {
            return;
        }

        const existing = locationUserRowsByKey.get(key);
        if (existing) {
            if (subtitle && !existing.$subtitle) {
                existing.$subtitle = subtitle;
            }
            if (source.$userColour && !existing.$userColour) {
                existing.$userColour = source.$userColour;
            }
            return;
        }

        const row = {
            ...source,
            id: userId || source.id,
            userId: source.userId || userId,
            displayName,
            $subtitle: subtitle || source.$subtitle || source.subtitle || ''
        };
        locationUserRowsByKey.set(key, row);
        locationUsers.push(row);
    }

    addLocationUser(locationOwnerUser, t('dialog.user.info.instance_creator'));
    for (const user of sameInstanceUsers) {
        addLocationUser(user);
    }
    if (visiblePresenceParsedLocation?.isRealInstance && !sameInstanceUsers.length) {
        addLocationUser(profile);
    }
    const locationOwnerFallbackId = normalizedText(
        visiblePresenceParsedLocation?.userId ||
            locationInstance?.ownerUserId ||
            locationInstance?.owner_user_id ||
            locationInstance?.ownerId ||
            locationInstance?.owner_id ||
            locationInstance?.userId ||
            locationInstance?.user_id ||
            locationInstance?.groupId ||
            locationInstance?.group_id ||
            locationInstance?.group?.id ||
            visiblePresenceParsedLocation?.groupId
    );
    const locationOwnerUserId = userIdForRow(locationOwnerUser);
    const locationOwnerGroupId = groupIdForRow(locationOwnerGroup);
    const locationOwnerIsGroup = Boolean(
        locationOwnerGroupId ||
            isGroupId(locationOwnerFallbackId) ||
            isGroupId(locationOwnerUserId)
    );
    const locationOwnerId = locationOwnerGroupId ||
        (locationOwnerIsGroup ? locationOwnerFallbackId || locationOwnerUserId : locationOwnerUserId) ||
        locationOwnerFallbackId;
    const locationOwnerName = locationOwnerIsGroup
        ? firstNonGroupIdText(
            locationOwnerGroup?.name,
            locationOwnerGroup?.displayName,
            locationOwnerGroup?.display_name,
            locationOwnerGroup?.shortCode,
            locationInstance?.groupName,
            locationInstance?.group_name,
            locationInstance?.group?.name,
            profile?.$location?.groupName,
            profile?.$location?.group_name,
            profile?.$location?.group?.name,
            locationOwnerUser?.displayName,
            locationOwnerUser?.username,
            locationOwnerUser?.name,
            locationOwnerId
        )
        : normalizedText(
            locationOwnerUser?.displayName ||
                locationOwnerUser?.username ||
                locationOwnerUser?.name ||
                locationOwnerId
        );
    const locationOwnerRow = !locationOwnerIsGroup && locationOwnerUser
        ? {
            ...locationOwnerUser,
            $subtitle: t('dialog.user.info.instance_creator')
        }
        : !locationOwnerIsGroup && locationOwnerId
            ? {
                id: locationOwnerId,
                userId: locationOwnerId,
                displayName: locationOwnerName,
                $subtitle: t('dialog.user.info.instance_creator')
            }
        : null;
    const locationPlayerUsers = locationOwnerId && !locationOwnerIsGroup
        ? locationUsers.filter((user) => userIdForRow(user) !== locationOwnerId)
        : locationUsers;

    async function copyUserText(text, label) {
        await copyTextToClipboard(text);
        toast.success(`${label} copied.`);
    }

    async function openDiscordProfile(discordId) {
        try {
            await backend.discord.OpenDiscordProfile(discordId);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to open Discord profile.');
        }
    }

    async function toggleBioTranslation() {
        if (!profile.bio || bioTranslationLoading) {
            return;
        }
        if (translatedBioActive) {
            setBioTranslation({ userId: profile.id || '', source: profile.bio || '', text: '' });
            return;
        }

        setBioTranslationLoading(true);
        try {
            const config = await getTranslationConfig();
            const translated = await translateText(profile.bio, config.bioLanguage, config);
            if (!translated) {
                throw new Error('No translation returned.');
            }
            setBioTranslation({ userId: profile.id || '', source: profile.bio || '', text: translated });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Translation failed.');
        } finally {
            setBioTranslationLoading(false);
        }
    }

    async function showAvatarAuthor() {
        if (!currentAvatarTarget) {
            return;
        }
        try {
            const avatar = await avatarProfileRepository.getAvatarProfile({
                avatarId: currentAvatarTarget,
                endpoint: currentEndpoint
            });
            if (avatar.authorId) {
                openUserDialog({ userId: avatar.authorId, title: avatar.authorName || undefined });
                return;
            }
            toast.error('Avatar author unavailable.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to load avatar author.');
        }
    }

    async function inviteToGroup() {
        if (!profile.id) {
            return;
        }
        const result = await prompt({
            title: 'Invite to group',
            description: 'Enter the VRChat group id to invite this user to.',
            inputValue: '',
            confirmText: 'Invite',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }
        try {
            await groupProfileRepository.sendGroupInvite({
                groupId: result.value,
                userId: profile.id,
                endpoint: currentEndpoint
            });
            toast.success('Group invite sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to send group invite.');
        }
    }

    async function refreshGroupsAfterMembershipChange() {
        setRemoteStatus((current) => ({ ...current, groups: '' }));
        setRemoteData((current) => ({ ...current, groups: [] }));
        await loadTab('groups', { force: true });
    }

    async function changeGroupVisibility(group, visibility) {
        const groupId = groupIdForRow(group);
        if (!groupId || !currentUserId || groupActionId) {
            return;
        }
        setGroupActionId(groupId);
        try {
            await groupProfileRepository.setGroupMemberProps({
                groupId,
                userId: currentUserId,
                endpoint: currentEndpoint,
                params: { visibility }
            });
            toast.success('Group visibility updated.');
            await refreshGroupsAfterMembershipChange();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update group visibility.');
        } finally {
            setGroupActionId('');
        }
    }

    async function leaveUserGroup(group) {
        const groupId = groupIdForRow(group);
        if (!groupId || groupActionId) {
            return;
        }
        const result = await confirm({
            title: 'Leave group',
            description: `Leave ${summarizeEntityRow(group, groupId)}?`,
            confirmText: 'Leave',
            cancelText: 'Cancel',
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        setGroupActionId(groupId);
        try {
            await groupProfileRepository.leaveGroup({ groupId, endpoint: currentEndpoint });
            toast.success('Left group.');
            await refreshGroupsAfterMembershipChange();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to leave group.');
        } finally {
            setGroupActionId('');
        }
    }

    function setGroupSelected(group, selected) {
        const groupId = groupIdForRow(group);
        if (!groupId) {
            return;
        }
        setSelectedGroupIds((current) => {
            const next = new Set(current);
            if (selected) {
                next.add(groupId);
            } else {
                next.delete(groupId);
            }
            return next;
        });
    }

    function selectVisibleGroups(rows) {
        setSelectedGroupIds((current) => {
            const next = new Set(current);
            for (const group of rows) {
                const groupId = groupIdForRow(group);
                if (groupId) {
                    next.add(groupId);
                }
            }
            return next;
        });
    }

    function clearSelectedGroups() {
        setSelectedGroupIds(new Set());
    }

    function exportUserGroups(rows) {
        const groups = rows.length ? rows : profileGroups;
        if (!groups.length) {
            toast.error('No groups to export.');
            return;
        }
        const filenameUser = normalizedText(profile.username || profile.displayName || profile.id).replace(/[^a-z0-9_-]+/gi, '_') || 'user';
        downloadJsonFile(`vrcx-${filenameUser}-groups.json`, groups);
        toast.success(`Exported ${groups.length} groups.`);
    }

    async function changeSelectedGroupsVisibility(visibility) {
        if (!selectedUserGroups.length || !currentUserId || groupActionId) {
            return;
        }
        setGroupActionId('__bulk_groups__');
        try {
            const results = await Promise.allSettled(selectedUserGroups.map((group) =>
                groupProfileRepository.setGroupMemberProps({
                    groupId: groupIdForRow(group),
                    userId: currentUserId,
                    endpoint: currentEndpoint,
                    params: { visibility }
                })
            ));
            const failed = results.filter((result) => result.status === 'rejected').length;
            if (failed) {
                toast.error(`Failed to update ${failed} groups.`);
            } else {
                toast.success(`Updated ${selectedUserGroups.length} groups.`);
            }
            await refreshGroupsAfterMembershipChange();
        } finally {
            setGroupActionId('');
        }
    }

    async function leaveSelectedGroups() {
        if (!selectedUserGroups.length || groupActionId) {
            return;
        }
        const result = await confirm({
            title: 'Leave selected groups',
            description: `Leave ${selectedUserGroups.length} selected groups?`,
            confirmText: 'Leave',
            cancelText: 'Cancel',
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        setGroupActionId('__bulk_groups__');
        try {
            const results = await Promise.allSettled(selectedUserGroups.map((group) =>
                groupProfileRepository.leaveGroup({ groupId: groupIdForRow(group), endpoint: currentEndpoint })
            ));
            const failed = results.filter((entry) => entry.status === 'rejected').length;
            if (failed) {
                toast.error(`Failed to leave ${failed} groups.`);
            } else {
                toast.success(`Left ${selectedUserGroups.length} groups.`);
                clearSelectedGroups();
            }
            await refreshGroupsAfterMembershipChange();
        } finally {
            setGroupActionId('');
        }
    }

    function editableGroupOrder() {
        const nextOrder = [];
        const seen = new Set();
        const pushGroupId = (groupId) => {
            const normalizedGroupId = normalizedText(groupId);
            if (!normalizedGroupId || seen.has(normalizedGroupId)) {
                return;
            }
            seen.add(normalizedGroupId);
            nextOrder.push(normalizedGroupId);
        };
        for (const groupId of inGameGroupOrder || []) {
            pushGroupId(groupId);
        }
        for (const group of profileGroups) {
            pushGroupId(groupIdForRow(group));
        }
        return nextOrder;
    }

    async function moveGroupInGameOrder(group, direction) {
        const groupId = groupIdForRow(group);
        if (!isCurrentUser || !currentUserId || !groupId || groupActionId) {
            return;
        }
        const previousOrder = editableGroupOrder();
        const index = previousOrder.indexOf(groupId);
        if (index === -1) {
            return;
        }
        const nextOrder = previousOrder.slice();
        nextOrder.splice(index, 1);
        let nextIndex = index;
        if (direction === 'top') {
            nextIndex = 0;
        } else if (direction === 'bottom') {
            nextIndex = nextOrder.length;
        } else if (direction === 'up') {
            nextIndex = Math.max(0, index - 1);
        } else if (direction === 'down') {
            nextIndex = Math.min(nextOrder.length, index + 1);
        }
        nextOrder.splice(nextIndex, 0, groupId);
        if (previousOrder.join('\u0000') === nextOrder.join('\u0000')) {
            return;
        }
        setGroupActionId(groupId);
        useRuntimeStore.getState().setGroupInstancesState({ groupOrder: nextOrder });
        setGroupSort('inGame');
        try {
            await backend.app.SetVRChatRegistryKey(`VRC_GROUP_ORDER_${currentUserId}`, JSON.stringify(nextOrder), 3);
            toast.success('Group order updated.');
        } catch (error) {
            useRuntimeStore.getState().setGroupInstancesState({ groupOrder: previousOrder });
            toast.error(error instanceof Error ? error.message : 'Failed to update group order.');
        } finally {
            setGroupActionId('');
        }
    }

    function SearchHeader({ searchKey, tab, rows, filteredRows, placeholder, children }) {
        return (
            <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm text-muted-foreground">{filteredRows.length}/{rows.length}</div>
                {tab ? (
                    <Button type="button" size="sm" variant="outline" disabled={remoteStatus[tab] === 'running'} onClick={() => void loadTab(tab, { force: true })}>
                        Refresh
                    </Button>
                ) : null}
                {children}
                <Input
                    value={search[searchKey]}
                    onChange={(event) => setSearch((current) => ({ ...current, [searchKey]: event.target.value }))}
                    placeholder={placeholder}
                    className="ml-auto h-8 max-w-64"
                />
            </div>
        );
    }

    return (
        <EntityDialogScaffold>
            <EntityDialogHeader
                imageUrl={imageUrl}
                imageAlt={profile.displayName || profile.id || 'User'}
                imageClassName="aspect-[4/3] w-40"
                onImageClick={imageUrl ? () => openImagePreview({ url: imageUrl, title: profile.displayName || profile.username || 'User' }) : null}
                imagePlaceholder={<UsersIcon className="size-8 text-muted-foreground" />}
                title={profile.displayName || profile.username || 'User'}
                onTitleClick={profile.displayName || profile.username ? () => void copyUserText(profile.displayName || profile.username, 'Display name') : undefined}
                titleMeta={
                    <>
                        <UserTitleLanguages languages={profileLanguages} />
                        {previousDisplayNames.length ? (
                            <Badge variant="outline" className="shrink-0 text-xs" title={previousDisplayNamesTitle}>
                                Names {previousDisplayNames.length}
                            </Badge>
                        ) : null}
                    </>
                }
                subtitle={userSubtitle}
                onSubtitleClick={username ? () => void copyUserText(username, 'Username') : undefined}
                description={profile.statusDescription}
                detail={detail}
                badges={
                    <>
                        {statusStateText ? <Badge variant="outline" title={statusStateText}>{statusStateText}</Badge> : null}
                        {pronounsText ? <Badge variant="outline">{pronounsText}</Badge> : null}
                        {isFriend ? <Badge variant="secondary">Friend</Badge> : null}
                        {isFavorite ? (
                            <Badge>
                                <HeartIcon data-icon="inline-start" className="fill-current" />
                                Favorite
                            </Badge>
                        ) : null}
                        {profile.$isModerator ? (
                            <Badge variant="secondary">
                                <ShieldCheckIcon data-icon="inline-start" />
                                Moderator
                            </Badge>
                        ) : null}
                        {profile.$isTroll ? <Badge variant="destructive">Nuisance</Badge> : null}
                        {profile.$isProbableTroll ? <Badge variant="outline">Almost Nuisance</Badge> : null}
                        {profile.$customTag ? (
                            <Badge
                                variant="outline"
                                style={profile.$customTagColour ? {
                                    color: profile.$customTagColour,
                                    borderColor: profile.$customTagColour
                                } : undefined}>
                                {profile.$customTag}
                            </Badge>
                        ) : null}
                        {profile.ageVerified ? <Badge variant="outline">18+</Badge> : null}
                        {friendNumber ? <Badge variant="outline">Friend #{friendNumber}</Badge> : null}
                        {mutualFriendCount ? <Badge variant="outline">{mutualFriendCount} mutual</Badge> : null}
                        {moderationState.block ? <Badge variant="destructive">Blocked</Badge> : null}
                        {moderationState.mute ? <Badge variant="destructive">Muted</Badge> : null}
                        <Badge variant="outline">{profile.$trustLevel || 'Visitor'}</Badge>
                        <Badge variant="outline">
                            {PlatformIcon ? <PlatformIcon data-icon="inline-start" /> : null}
                            {platform.label}
                        </Badge>
                        {profile.discordId ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                className="h-5 rounded-4xl px-2 py-0.5 text-xs"
                                onClick={() => void openDiscordProfile(profile.discordId)}>
                                Discord
                            </Button>
                        ) : null}
                    </>
                }
                mediaBadges={
                    <>
                        {profile.userIcon ? (
                            <Button type="button" variant="ghost" size="icon" className="size-8 overflow-hidden p-0" onClick={() => openImagePreview({ url: convertFileUrlToImageUrl(profile.userIcon, 512), title: profile.displayName || profile.username || 'User' })}>
                                <img src={convertFileUrlToImageUrl(profile.userIcon, 64)} alt="" className="size-8 rounded-md object-cover" />
                            </Button>
                        ) : null}
                        {Array.isArray(profile.badges) ? profile.badges.filter((badge) => badge?.badgeImageUrl).map((badge) => (
                            <Popover key={badge.badgeId || badge.id || badge.badgeName}>
                                <PopoverTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        title={`${badge.badgeName || 'Badge'}${badge.hidden ? ' (Hidden)' : ''}`}
                                        className="size-8 rounded-sm p-0"
                                        onClick={(event) => event.stopPropagation()}>
                                        <img
                                            src={badge.badgeImageUrl}
                                            alt={badge.badgeName || ''}
                                            className={cn('size-8 rounded-sm object-cover', badge.hidden && 'grayscale')}
                                        />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent side="bottom" className="flex w-72 flex-col gap-3">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="h-auto w-full p-0"
                                        onClick={() => badge.badgeImageUrl && openImagePreview({ url: badge.badgeImageUrl, title: badge.badgeName || profile.displayName || profile.username || 'Badge' })}>
                                        <img src={badge.badgeImageUrl} alt={badge.badgeName || ''} className="max-h-56 w-full rounded-md object-contain" />
                                    </Button>
                                    <div className="flex flex-col gap-1 text-sm">
                                        <div className="font-medium">
                                            {badge.badgeName || 'Badge'}
                                            {badge.hidden ? <span className="ml-1 text-xs text-muted-foreground">(Hidden)</span> : null}
                                        </div>
                                        {badge.badgeDescription ? <div className="text-xs text-muted-foreground">{badge.badgeDescription}</div> : null}
                                        {badge.assignedAt ? <div className="text-xs font-mono text-muted-foreground">Assigned: {formatStatsDate(badge.assignedAt)}</div> : null}
                                    </div>
                                    {isCurrentUser ? (
                                        <FieldGroup data-slot="checkbox-group" className="border-t pt-3 text-sm">
                                            <Field orientation="horizontal">
                                                <Checkbox
                                                    checked={Boolean(badge.hidden)}
                                                    disabled={actionStatus !== 'idle' || !onToggleBadgeVisibility}
                                                    aria-label="Hidden"
                                                    onCheckedChange={(checked) => onToggleBadgeVisibility?.(badge, Boolean(checked))}
                                                />
                                                <FieldLabel>Hidden</FieldLabel>
                                            </Field>
                                            <Field orientation="horizontal">
                                                <Checkbox
                                                    checked={Boolean(badge.showcased)}
                                                    disabled={actionStatus !== 'idle' || !onToggleBadgeShowcased}
                                                    aria-label="Showcased"
                                                    onCheckedChange={(checked) => onToggleBadgeShowcased?.(badge, Boolean(checked))}
                                                />
                                                <FieldLabel>Showcased</FieldLabel>
                                            </Field>
                                        </FieldGroup>
                                    ) : null}
                                </PopoverContent>
                            </Popover>
                        )) : null}
                    </>
                }
                actions={
                    <>
                        {!isCurrentUser ? <FavoriteActionMenu kind="friend" entityId={profile.id} entity={profile} /> : null}
                        <EntityActionDropdown
                            busy={loadStatus === 'running' || actionStatus !== 'idle'}
                            dangerous={moderationState.block || moderationState.mute}
                            indicator={friendRequestState.incoming || friendRequestState.outgoing}>
                            <EntityActionItem icon={RefreshCwIcon} disabled={loadStatus === 'running'} onSelect={onRefresh}>
                                Refresh
                            </EntityActionItem>
                            {userUrl ? (
                                <>
                                    <EntityActionItem icon={Share2Icon} onSelect={() => void copyUserText(userUrl, 'User URL')}>
                                        Share / Copy URL
                                    </EntityActionItem>
                                    <EntityActionItem icon={ExternalLinkIcon} onSelect={() => openExternalLink(userUrl)}>
                                        Open VRChat Page
                                    </EntityActionItem>
                                    <EntityActionItem icon={CopyIcon} onSelect={() => void copyUserText(profile.id, 'User ID')}>
                                        Copy User ID
                                    </EntityActionItem>
                                    <EntityActionSeparator />
                                </>
                            ) : null}
                            <EntityActionItem icon={UserIcon} onSelect={onEditMemo}>Edit Note Memo</EntityActionItem>
                            {currentAvatarTarget ? (
                                <EntityActionItem icon={UserIcon} onSelect={() => void showAvatarAuthor()}>
                                    Show Avatar Author
                                </EntityActionItem>
                            ) : null}
                            {fallbackAvatarTarget ? (
                                <EntityActionItem icon={UserIcon} onSelect={() => openAvatarDialog(fallbackAvatarDialogArgs)}>
                                    Show Fallback Avatar Details
                                </EntityActionItem>
                            ) : null}
                            {isCurrentUser ? (
                                <>
                                    <EntityActionSeparator />
                                    <EntityActionItem icon={PencilIcon} disabled={actionStatus !== 'idle'} onSelect={onEditSelfStatus}>Edit Social Status</EntityActionItem>
                                    <EntityActionItem icon={PencilIcon} disabled={actionStatus !== 'idle'} onSelect={onEditSelfLanguages}>Edit Language</EntityActionItem>
                                    <EntityActionItem icon={PencilIcon} disabled={actionStatus !== 'idle'} onSelect={onEditSelfBio}>Edit Bio</EntityActionItem>
                                    <EntityActionItem icon={PencilIcon} disabled={actionStatus !== 'idle'} onSelect={onEditSelfBioLinks}>Edit Bio Links</EntityActionItem>
                                    <EntityActionItem icon={PencilIcon} disabled={actionStatus !== 'idle'} onSelect={onEditSelfPronouns}>Edit Pronouns</EntityActionItem>
                                </>
                            ) : null}
                            {!isCurrentUser ? (
                                <>
                                    <EntityActionSeparator />
                                    {!isFriend && friendRequestState.incoming ? (
                                        <>
                                            <EntityActionItem icon={CheckIcon} disabled={actionStatus !== 'idle'} onSelect={() => onFriendRequest('accept')}>
                                                Accept Friend Request
                                            </EntityActionItem>
                                            <EntityActionItem icon={XIcon} destructive disabled={actionStatus !== 'idle'} onSelect={() => onFriendRequest('decline')}>
                                                Decline Friend Request
                                            </EntityActionItem>
                                        </>
                                    ) : !isFriend && friendRequestState.outgoing ? (
                                        <EntityActionItem icon={XIcon} disabled={actionStatus !== 'idle'} onSelect={() => onFriendRequest('cancel')}>
                                            Cancel Friend Request
                                        </EntityActionItem>
                                    ) : !isFriend ? (
                                        <EntityActionItem
                                            icon={UserIcon}
                                            shortcut={recentDialogShortcut('Send Friend Request')}
                                            disabled={actionStatus !== 'idle'}
                                            onSelect={() => onFriendRequest('send')}>
                                            Send Friend Request
                                        </EntityActionItem>
                                    ) : null}
                                    {isFriend ? (
                                        <>
                                            <EntityActionItem
                                                icon={MessageSquareIcon}
                                                shortcut={recentDialogShortcut('Invite')}
                                                disabled={actionStatus !== 'idle' || !canInviteFromCurrentLocation}
                                                onSelect={onInvite}>
                                                Invite
                                            </EntityActionItem>
                                            <EntityActionItem
                                                icon={MessageSquareIcon}
                                                shortcut={recentDialogShortcut('Invite Message')}
                                                disabled={actionStatus !== 'idle' || !canInviteFromCurrentLocation}
                                                onSelect={onInviteMessage}>
                                                Invite Message
                                            </EntityActionItem>
                                            <EntityActionItem
                                                icon={MailIcon}
                                                shortcut={recentDialogShortcut('Request Invite')}
                                                disabled={actionStatus !== 'idle'}
                                                onSelect={onInviteRequest}>
                                                Request Invite
                                            </EntityActionItem>
                                            <EntityActionItem
                                                icon={MailIcon}
                                                shortcut={recentDialogShortcut('Request Invite Message')}
                                                disabled={actionStatus !== 'idle'}
                                                onSelect={onInviteRequestMessage}>
                                                Request Invite Message
                                            </EntityActionItem>
                                            <EntityActionItem icon={MousePointerIcon} disabled={actionStatus !== 'idle' || !currentUserBoopingEnabled} onSelect={onBoop}>
                                                Boop
                                            </EntityActionItem>
                                            <EntityActionItem icon={UserMinusIcon} destructive disabled={actionStatus !== 'idle'} onSelect={onUnfriend}>
                                                Unfriend
                                            </EntityActionItem>
                                        </>
                                    ) : null}
                                    <EntityActionItem icon={UsersIcon} disabled={actionStatus !== 'idle'} onSelect={() => void inviteToGroup()}>
                                        Invite To Group
                                    </EntityActionItem>
                                    <EntityActionItem icon={SettingsIcon} disabled={actionStatus !== 'idle'} onSelect={onGroupModeration}>
                                        Group Moderation
                                    </EntityActionItem>
                                    <EntityActionSeparator />
                                    <EntityActionItem icon={MapPinIcon} disabled={!previousInstances.length} onSelect={() => setPreviousInstancesOpen(true)}>
                                        Previous Instances
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={BanIcon}
                                        destructive={moderationState.block}
                                        disabled={actionStatus !== 'idle' || (!moderationState.block && Boolean(profile.$isModerator))}
                                        onSelect={() => onModeration('block', !moderationState.block)}>
                                        {moderationState.block ? 'Unblock' : 'Block'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={VolumeXIcon}
                                        destructive={moderationState.mute}
                                        disabled={actionStatus !== 'idle' || (!moderationState.mute && Boolean(profile.$isModerator))}
                                        onSelect={() => onModeration('mute', !moderationState.mute)}>
                                        {moderationState.mute ? 'Unmute' : 'Mute'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={UserIcon}
                                        destructive={avatarOverrideState.hideAvatar}
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={() => onAvatarOverride?.('hideAvatar')}>
                                        {avatarOverrideState.hideAvatar ? 'Reset Hidden Avatar' : 'Hide Avatar'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={UserIcon}
                                        destructive={avatarOverrideState.showAvatar}
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={() => onAvatarOverride?.('showAvatar')}>
                                        {avatarOverrideState.showAvatar ? 'Reset Shown Avatar' : 'Show Avatar'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={BanIcon}
                                        destructive={extendedModerationState.interactOff}
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={() => onExtendedModeration?.('interactOff', !extendedModerationState.interactOff)}>
                                        {extendedModerationState.interactOff ? 'Enable Avatar Interaction' : 'Disable Avatar Interaction'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={VolumeXIcon}
                                        destructive={extendedModerationState.muteChat}
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={() => onExtendedModeration?.('muteChat', !extendedModerationState.muteChat)}>
                                        {extendedModerationState.muteChat ? 'Enable Chatbox' : 'Disable Chatbox'}
                                    </EntityActionItem>
                                    <EntityActionItem icon={BanIcon} destructive disabled={actionStatus !== 'idle'} onSelect={onReportHacking}>
                                        Report Hacking
                                    </EntityActionItem>
                                </>
                            ) : null}
                        </EntityActionDropdown>
                    </>
                }
            />
            <EntityDialogTabs value={activeTab} onValueChange={changeTab} tabs={tabs}>
                <EntityDialogTabContent value="info">
                    {visiblePresenceLocation ? (
                        <div className="mb-2 flex flex-col gap-2 border-b border-border pb-2">
                            <div className="flex flex-col gap-1 text-sm">
                                {visiblePresenceLocation.includes(':') ? (
                                    <InstanceActionBar
                                        location={visiblePresenceLocation}
                                        launchLocation={visiblePresenceLocation}
                                        inviteLocation={visiblePresenceLocation}
                                        instanceLocation={visiblePresenceLocation}
                                        instance={locationInstance}
                                        worldName={locationWorldTitle}
                                        friendCount={locationFriendCount}
                                        playerCount={locationPlayerCount}
                                        capacity={locationInstance?.capacity ?? locationInstance?.recommendedCapacity}
                                        refreshTooltip={t('dialog.user.info.refresh_instance_info')}
                                        showHistory={Boolean(previousInstances.length)}
                                        onRefresh={onRefreshLocation}
                                        onHistory={() => setPreviousInstancesOpen(true)}
                                    />
                                ) : null}
                                {visiblePresenceLocation.includes(':') ? (
                                    <LocationWorld
                                        locationObject={{
                                            ...(locationInstance || {}),
                                            tag: visiblePresenceLocation,
                                            location: visiblePresenceLocation,
                                            userId: locationOwnerId,
                                            playerCount: locationPlayerCount,
                                            capacity: locationInstance?.capacity ?? locationInstance?.recommendedCapacity
                                        }}
                                        currentUserId={currentUserId}
                                        grouphint={locationInstance?.groupName || profile.$location?.groupName || ''}
                                        instanceOwner={locationOwnerIsGroup ? '' : locationOwnerId}
                                        instanceOwnerName={locationOwnerIsGroup ? '' : locationOwnerName}
                                        playerCount={locationPlayerCount}
                                        capacity={locationInstance?.capacity ?? locationInstance?.recommendedCapacity}
                                        endpoint={currentEndpoint}
                                        hint={locationWorldTitle}
                                        instanceClickAction="world"
                                    />
                                ) : (
                                    <Location
                                        location={visiblePresenceLocation}
                                        hint={locationWorldTitle}
                                        enableContextMenu
                                        showLaunchActions
                                    />
                                )}
                            </div>
                            {locationOwnerRow || locationPlayerUsers.length ? (
                                <div className="flex max-h-36 flex-col gap-2 overflow-auto">
                                    {locationOwnerRow ? (
                                        <div className="flex flex-col gap-1">
                                            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                                {t('dialog.user.info.instance_creator')}
                                            </div>
                                            <EntityList rows={[locationOwnerRow]} kind="user" />
                                        </div>
                                    ) : null}
                                    {locationPlayerUsers.length ? (
                                        <div className="flex flex-col gap-1">
                                            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                                {t('dialog.user.info.instance_users')} {locationPlayerUsers.length}
                                            </div>
                                            <EntityList rows={locationPlayerUsers} kind="user" />
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                    <EntityInfoGrid>
                        {profile.note && !hideUserNotes ? (
                            <EntityInfoBlock label="Note" full onClick={onEditMemo}>
                                <pre className="max-h-52 whitespace-pre-wrap text-xs font-sans text-muted-foreground">{profile.note}</pre>
                            </EntityInfoBlock>
                        ) : null}
                        {memo && !hideUserMemos ? (
                            <EntityInfoBlock label="Memo" full onClick={onEditMemo}>
                                <pre className="max-h-52 whitespace-pre-wrap text-xs font-sans text-muted-foreground">{memo}</pre>
                            </EntityInfoBlock>
                        ) : null}
                        <EntityInfoBlock label="Avatar Info" full>
                            {currentAvatarTarget ? (
                                <Button type="button" variant="link" className="h-auto justify-start p-0 text-left text-xs" onClick={() => openAvatarDialog(currentAvatarDialogArgs)}>
                                    <UserIcon data-icon="inline-start" />
                                    {currentAvatarDisplayName || 'Avatar'}
                                </Button>
                            ) : <span className="block truncate text-xs">—</span>}
                        </EntityInfoBlock>
                        <EntityInfoBlock label="Represented Group" full>
                            {representedGroupStatus === 'running' ? (
                                <span className="block text-xs text-muted-foreground">Loading...</span>
                            ) : representedGroup?.isRepresenting ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-auto max-w-full justify-start gap-2 p-0 text-left text-xs font-normal whitespace-normal hover:bg-transparent hover:underline"
                                    onClick={() => openGroupDialog({
                                        groupId: representedGroup.groupId,
                                        title: representedGroup.name || undefined,
                                        seedData: {
                                            ...representedGroup,
                                            $memberId: representedGroup.id,
                                            id: representedGroup.groupId,
                                            myMember: {
                                                ...(representedGroup.myMember || {}),
                                                id: representedGroup.id,
                                                groupId: representedGroup.groupId,
                                                isRepresenting: Boolean(representedGroup.isRepresenting),
                                                isSubscribedToAnnouncements: Boolean(representedGroup.isSubscribedToAnnouncements),
                                                visibility: representedGroup.visibility || representedGroup.memberVisibility || 'visible',
                                                membershipStatus: representedGroup.membershipStatus || ''
                                            }
                                        }
                                    })}>
                                    {representedGroup.iconUrl ? (
                                        <img
                                            src={convertFileUrlToImageUrl(representedGroup.iconUrl, 128)}
                                            alt=""
                                            className="size-10 shrink-0 rounded-md object-cover"
                                        />
                                    ) : null}
                                    <span className="min-w-0">
                                        <span className="block truncate">
                                            {representedGroup.ownerId === profile.id ? 'Owner - ' : ''}{representedGroup.name || 'Group'}
                                        </span>
                                        <span className="block truncate text-muted-foreground">
                                            {representedGroup.memberCount ? `${representedGroup.memberCount} members` : ''}
                                        </span>
                                    </span>
                                </Button>
                            ) : (
                                <span className="block text-xs text-muted-foreground">—</span>
                            )}
                        </EntityInfoBlock>
                        <EntityInfoBlock label="Bio" full>
                            <div className="flex items-start gap-2">
                                <pre className="max-h-52 min-w-0 flex-1 overflow-auto whitespace-pre-wrap text-xs font-sans text-muted-foreground">{visibleBio}</pre>
                                {profile.bio ? (
                                    <Button
                                        type="button"
                                        size="icon-xs"
                                        variant="ghost"
                                        className="shrink-0"
                                        disabled={bioTranslationLoading}
                                        title={translatedBioActive ? 'Show original bio' : 'Translate bio'}
                                        aria-label={translatedBioActive ? 'Show original bio' : 'Translate bio'}
                                        onClick={() => void toggleBioTranslation()}>
                                        {bioTranslationLoading ? <Spinner data-icon="inline-start" /> : <LanguagesIcon data-icon="inline-start" />}
                                    </Button>
                                ) : null}
                            </div>
                            {bioLinks.length ? (
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {bioLinks.map((link) => (
                                        <Button
                                            key={link}
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            title={link}
                                            aria-label={`Open ${link}`}
                                            onClick={() => openExternalLink(link)}>
                                            {getFaviconUrl(link) ? (
                                                <img src={getFaviconUrl(link)} alt="" className="size-4" />
                                            ) : (
                                                <ExternalLinkIcon data-icon="inline-start" />
                                            )}
                                        </Button>
                                    ))}
                                </div>
                            ) : null}
                        </EntityInfoBlock>
                        <EntityInfoBlock label="Status" value={profile.status || profile.state} />
                        <EntityInfoBlock label="Last Platform" value={platform.label} />
                        {!isCurrentUser ? <EntityInfoBlock label="Last Seen" value={formatStatsDate(lastSeen)} /> : null}
                        <EntityInfoBlock label="Last Login" value={formatDate(profile.last_login || profile.last_activity)} />
                        <EntityInfoBlock label="Last Activity" value={formatDate(profile.last_activity)} />
                        <EntityInfoBlock label="Date Joined" value={profile.date_joined} />
                        {isCurrentUser ? (
                            <EntityInfoBlock
                                label="Play Time"
                                value={formatStatsDuration(userTimeSpent)}
                                onClick={previousInstances.length ? () => setPreviousInstancesOpen(true) : undefined}
                            />
                        ) : (
                            <>
                                <EntityInfoBlock
                                    label="Join Count"
                                    value={userJoinCount ? String(userJoinCount) : '—'}
                                    onClick={previousInstances.length ? () => setPreviousInstancesOpen(true) : undefined}
                                />
                                <EntityInfoBlock label="Time Together" value={formatStatsDuration(userTimeSpent)} />
                            </>
                        )}
                        {isCurrentUser ? (
                            <>
                                <EntityInfoBlock
                                    label="Avatar Cloning"
                                    value={profile.allowAvatarCopying ? 'Allow' : 'Deny'}
                                    onClick={actionStatus === 'idle' ? onToggleSelfAvatarCopying : undefined}
                                />
                                <EntityInfoBlock
                                    label="Booping"
                                    value={profile.isBoopingEnabled === false ? 'Deny' : 'Allow'}
                                    onClick={actionStatus === 'idle' ? onToggleSelfBooping : undefined}
                                />
                                <EntityInfoBlock
                                    label="Show Mutual Friends"
                                    value={profile.hasSharedConnectionsOptOut ? 'Deny' : 'Allow'}
                                    onClick={actionStatus === 'idle' ? onToggleSelfSharedConnections : undefined}
                                />
                                <EntityInfoBlock
                                    label="Show Discord Connections"
                                    value={profile.hasDiscordFriendsOptOut ? 'Deny' : 'Allow'}
                                    onClick={actionStatus === 'idle' ? onToggleSelfDiscordConnections : undefined}
                                />
                            </>
                        ) : (
                            <EntityInfoBlock label="Avatar Cloning" value={profile.allowAvatarCopying ? 'Allow' : 'Deny'} />
                        )}
                        {visibleHomeLocationTarget ? (
                            <EntityInfoBlock label="Home Location" full>
                                <Location
                                    location={visibleHomeLocationTarget}
                                    enableContextMenu
                                    showLaunchActions
                                />
                            </EntityInfoBlock>
                        ) : null}
                        <EntityInfoBlock
                            label="User ID"
                            mono
                            full>
                            <span className="block truncate text-xs font-mono">
                                {profile.id || '—'}
                                {profile.id ? (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                type="button"
                                                aria-label="Open user copy menu"
                                                title="Copy user details"
                                                className="ml-1"
                                                size="icon-xs"
                                                variant="ghost"
                                                onClick={(event) => event.stopPropagation()}>
                                                <CopyIcon data-icon="inline-start" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start">
                                            <DropdownMenuGroup>
                                                <DropdownMenuItem onSelect={() => void copyUserText(profile.id, 'User ID')}>
                                                    Copy User ID
                                                </DropdownMenuItem>
                                                {userUrl ? (
                                                    <DropdownMenuItem onSelect={() => void copyUserText(userUrl, 'User URL')}>
                                                        Copy User URL
                                                    </DropdownMenuItem>
                                                ) : null}
                                                {profile.displayName ? (
                                                    <DropdownMenuItem onSelect={() => void copyUserText(profile.displayName, 'Display name')}>
                                                        Copy Display Name
                                                    </DropdownMenuItem>
                                                ) : null}
                                            </DropdownMenuGroup>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                ) : null}
                            </span>
                        </EntityInfoBlock>
                        {userUrl ? (
                            <EntityInfoBlock
                                label="User URL"
                                value={userUrl}
                                mono
                                full
                                onClick={() => void copyUserText(userUrl, 'User URL')}
                            />
                        ) : null}
                    </EntityInfoGrid>
                </EntityDialogTabContent>
                <EntityDialogTabContent value="mutual" className="flex flex-col gap-2">
                    <SearchHeader searchKey="mutual" tab="mutual" rows={mutualFriends} filteredRows={filteredMutualFriends} placeholder="Search mutual friends">
                        <span className="text-sm text-muted-foreground">Sort By</span>
                        <Select value={mutualSort} onValueChange={setMutualSort} disabled={remoteStatus.mutual === 'running'}>
                            <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {Object.entries(userDialogMutualFriendSortingOptions).map(([key, option]) => (
                                        <SelectItem key={key} value={option.value}>
                                            {t(option.name)}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </SearchHeader>
                    <EntityList rows={visibleMutualFriends} kind="user" loading={remoteStatus.mutual === 'running'} error={remoteErrors.mutual} />
                </EntityDialogTabContent>
                <EntityDialogTabContent value="groups" className="flex flex-col gap-2">
                    <SearchHeader searchKey="groups" tab="groups" rows={profileGroups} filteredRows={filteredProfileGroups} placeholder="Search groups">
                        {!groupEditMode ? (
                            <>
                                <span className="text-sm text-muted-foreground">Sort By</span>
                                <Select value={effectiveGroupSort} onValueChange={setGroupSort} disabled={remoteStatus.groups === 'running'}>
                                    <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {Object.entries(userDialogGroupSortingOptions).map(([key, option]) => (
                                                <SelectItem key={key} value={option.value} disabled={option.value === 'inGame' && !isCurrentUser}>
                                                    {t(option.name)}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </>
                        ) : null}
                        {isCurrentUser ? (
                            <>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={groupEditMode ? 'secondary' : 'outline'}
                                    disabled={groupActionId === '__bulk_groups__'}
                                    onClick={() => {
                                        const nextGroupEditMode = !groupEditMode;
                                        setGroupEditMode(nextGroupEditMode);
                                        if (nextGroupEditMode) {
                                            setGroupSort('inGame');
                                        }
                                        clearSelectedGroups();
                                    }}>
                                    {groupEditMode ? 'Done' : 'Edit'}
                                </Button>
                                {groupEditMode ? (
                                    <>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={groupActionId === '__bulk_groups__' || !filteredProfileGroups.length}
                                            onClick={() => selectVisibleGroups(filteredProfileGroups)}>
                                            Select Visible
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={groupActionId === '__bulk_groups__' || !selectedGroupCount}
                                            onClick={clearSelectedGroups}>
                                            Clear Selected
                                        </Button>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button type="button" size="sm" variant="outline" disabled={groupActionId === '__bulk_groups__'}>
                                                    <SettingsIcon data-icon="inline-start" />
                                                    Bulk Actions
                                                    {selectedGroupCount ? <span className="text-xs text-muted-foreground">({selectedGroupCount})</span> : null}
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="start">
                                                <DropdownMenuGroup>
                                                    <DropdownMenuItem disabled={!selectedGroupCount} onSelect={() => void changeSelectedGroupsVisibility('visible')}>
                                                        <EyeIcon />
                                                        Set Selected Visible
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem disabled={!selectedGroupCount} onSelect={() => void changeSelectedGroupsVisibility('hidden')}>
                                                        <EyeIcon />
                                                        Set Selected Hidden
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem disabled={!selectedGroupCount} onSelect={() => void changeSelectedGroupsVisibility('friends')}>
                                                        <UsersIcon />
                                                        Set Selected Friends
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onSelect={() => exportUserGroups(selectedUserGroups)}>
                                                        <DownloadIcon />
                                                        Export {selectedGroupCount ? 'Selected' : 'All'} Groups
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem variant="destructive" disabled={!selectedGroupCount} onSelect={() => void leaveSelectedGroups()}>
                                                        <LogOutIcon />
                                                        Leave Selected
                                                    </DropdownMenuItem>
                                                </DropdownMenuGroup>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </>
                                ) : null}
                            </>
                        ) : null}
                    </SearchHeader>
                    {remoteStatus.groups === 'running' || remoteErrors.groups ? (
                        <EntityList rows={filteredProfileGroups} kind="group" loading={remoteStatus.groups === 'running'} error={remoteErrors.groups} />
                    ) : groupSearchActive ? (
                        <EntityList
                            rows={filteredProfileGroups}
                            kind="group"
                            editableGroups={isCurrentUser && groupEditMode}
                            selectableGroups={groupEditMode}
                            selectedGroupIds={selectedGroupIds}
                            groupActionId={groupActionId}
                            onGroupVisibilityChange={(group, visibility) => void changeGroupVisibility(group, visibility)}
                            onGroupLeave={(group) => void leaveUserGroup(group)}
                            onGroupMove={groupEditMode ? (group, direction) => void moveGroupInGameOrder(group, direction) : undefined}
                            onGroupSelectionChange={setGroupSelected}
                        />
                    ) : userGroupSections.ownGroups.length || userGroupSections.mutualGroups.length || userGroupSections.remainingGroups.length ? (
                        <div className="flex flex-col gap-4">
                            <UserGroupSection
                                title={t('dialog.user.groups.own_groups')}
                                rows={userGroupSections.ownGroups}
                                countText={ownGroupCountText}
                                editableGroups={isCurrentUser && groupEditMode}
                                selectableGroups={groupEditMode}
                                selectedGroupIds={selectedGroupIds}
                                groupActionId={groupActionId}
                                onGroupVisibilityChange={(group, visibility) => void changeGroupVisibility(group, visibility)}
                                onGroupLeave={(group) => void leaveUserGroup(group)}
                                onGroupMove={groupEditMode ? (group, direction) => void moveGroupInGameOrder(group, direction) : undefined}
                                onGroupSelectionChange={setGroupSelected}
                            />
                            <UserGroupSection
                                title={t('dialog.user.groups.mutual_groups')}
                                rows={userGroupSections.mutualGroups}
                                editableGroups={isCurrentUser && groupEditMode}
                                selectableGroups={groupEditMode}
                                selectedGroupIds={selectedGroupIds}
                                groupActionId={groupActionId}
                                onGroupVisibilityChange={(group, visibility) => void changeGroupVisibility(group, visibility)}
                                onGroupLeave={(group) => void leaveUserGroup(group)}
                                onGroupMove={groupEditMode ? (group, direction) => void moveGroupInGameOrder(group, direction) : undefined}
                                onGroupSelectionChange={setGroupSelected}
                            />
                            <UserGroupSection
                                title={t('dialog.user.groups.groups')}
                                rows={userGroupSections.remainingGroups}
                                countText={remainingGroupCountText}
                                editableGroups={isCurrentUser && groupEditMode}
                                selectableGroups={groupEditMode}
                                selectedGroupIds={selectedGroupIds}
                                groupActionId={groupActionId}
                                onGroupVisibilityChange={(group, visibility) => void changeGroupVisibility(group, visibility)}
                                onGroupLeave={(group) => void leaveUserGroup(group)}
                                onGroupMove={groupEditMode ? (group, direction) => void moveGroupInGameOrder(group, direction) : undefined}
                                onGroupSelectionChange={setGroupSelected}
                            />
                        </div>
                    ) : (
                        <EntityBlank />
                    )}
                </EntityDialogTabContent>
                <EntityDialogTabContent value="worlds" className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm text-muted-foreground">{filteredProfileWorlds.length}/{profileWorlds.length}</div>
                            <Button type="button" size="sm" variant="outline" disabled={remoteStatus.worlds === 'running'} onClick={() => void loadTab('worlds', { force: true })}>
                                Refresh
                            </Button>
                            <Input
                                value={search.worlds}
                                onChange={(event) => setSearch((current) => ({ ...current, worlds: event.target.value }))}
                                placeholder="Search worlds"
                                className="ml-auto h-8 w-40"
                            />
                            <span className="text-sm text-muted-foreground">Sort By</span>
                            <Select value={worldSort} onValueChange={changeWorldSort} disabled={remoteStatus.worlds === 'running'}>
                                <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectItem value="name">Name</SelectItem>
                                        <SelectItem value="updated">Updated</SelectItem>
                                        <SelectItem value="created">Created</SelectItem>
                                        <SelectItem value="favorites">Favorites</SelectItem>
                                        <SelectItem value="popularity">Popularity</SelectItem>
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                            <span className="text-sm text-muted-foreground">Order By</span>
                            <Select value={worldOrder} onValueChange={changeWorldOrder} disabled={remoteStatus.worlds === 'running'}>
                                <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectItem value="descending">Descending</SelectItem>
                                        <SelectItem value="ascending">Ascending</SelectItem>
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </div>
                        <EntityList rows={filteredProfileWorlds} kind="world" loading={remoteStatus.worlds === 'running'} error={remoteErrors.worlds} />
                    </div>
                </EntityDialogTabContent>
                <EntityDialogTabContent value="favorite-worlds" className="flex flex-col gap-2">
                    <SearchHeader searchKey="favoriteWorlds" tab="favorite-worlds" rows={favoriteWorlds} filteredRows={filteredFavoriteWorlds} placeholder="Search favorite worlds" />
                    <FavoriteWorldGroups
                        groups={remoteData.favoriteWorldGroups}
                        rows={favoriteWorlds}
                        search={search.favoriteWorlds}
                        filteredRows={filteredFavoriteWorlds}
                        loading={remoteStatus['favorite-worlds'] === 'running'}
                        error={remoteErrors['favorite-worlds']}
                    />
                </EntityDialogTabContent>
                <EntityDialogTabContent value="avatars" className="flex flex-col gap-2">
                    {currentAvatarTarget ? (
                        <Button type="button" variant="link" className="h-auto justify-start p-0 text-left" onClick={() => openAvatarDialog(currentAvatarDialogArgs)}>
                            <UserIcon data-icon="inline-start" />
                            Current Avatar: {currentAvatarDisplayName || 'Avatar'}
                        </Button>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm text-muted-foreground">{visibleProfileAvatars.length}/{profileAvatars.length}</div>
                        <Button type="button" size="sm" variant="outline" disabled={remoteStatus.avatars === 'running'} onClick={() => void loadTab('avatars', { force: true })}>
                            Refresh
                        </Button>
                        <Input
                            value={search.avatars}
                            onChange={(event) => setSearch((current) => ({ ...current, avatars: event.target.value }))}
                            placeholder="Search avatars"
                            className="ml-auto h-8 w-40"
                        />
                        {profile.id === currentUserId ? (
                            <>
                                <span className="text-sm text-muted-foreground">Sort By</span>
                                <Select value={avatarSort} onValueChange={changeAvatarSort} disabled={remoteStatus.avatars === 'running'}>
                                    <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            <SelectItem value="name">Name</SelectItem>
                                            <SelectItem value="update">Updated</SelectItem>
                                            <SelectItem value="createdAt">Uploaded</SelectItem>
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                                <span className="text-sm text-muted-foreground">Group By</span>
                                <Select value={avatarReleaseStatus} onValueChange={changeAvatarReleaseStatus} disabled={remoteStatus.avatars === 'running'}>
                                    <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            <SelectItem value="all">All</SelectItem>
                                            <SelectItem value="public">Public</SelectItem>
                                            <SelectItem value="private">Private</SelectItem>
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </>
                        ) : null}
                    </div>
                    <EntityList rows={visibleProfileAvatars} kind="avatar" loading={remoteStatus.avatars === 'running'} error={remoteErrors.avatars} />
                </EntityDialogTabContent>
                <EntityDialogTabContent value="activity" className="flex flex-col gap-4">
                    <UserActivityPanel profile={profile} isCurrentUser={isCurrentUser} active={activeTab === 'activity'} />
                </EntityDialogTabContent>
                <EntityDialogTabContent value="json"><EntityRawJson value={{ profile, memo, moderationState, isFriend, isFavorite }} /></EntityDialogTabContent>
            </EntityDialogTabs>
            <PreviousInstancesTableDialog
                open={previousInstancesOpen}
                onOpenChange={setPreviousInstancesOpen}
                title={`Previous Instances - ${profile.displayName || profile.username || 'User'}`}
                instances={previousInstances}
                variant="user"
                targetRef={profile}
                onRowsChange={onPreviousInstancesChange}
            />
        </EntityDialogScaffold>
    );
}
