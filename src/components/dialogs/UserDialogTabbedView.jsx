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
    LoaderCircleIcon,
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
import { formatDateFilter, timeToText } from '@/lib/dateTime.js';
import { convertFileUrlToImageUrl, copyTextToClipboard, openExternalLink, userImage } from '@/lib/entityMedia.js';
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
import { languageMappings } from '@/shared/constants/language.js';
import { userDialogGroupSortingOptions, userDialogMutualFriendSortingOptions } from '@/shared/constants/user.js';
import { compareByDisplayName, compareByFriendOrder, compareByLastActiveRef, compareByMemberCount, compareByName } from '@/shared/utils/compare.js';
import { getFaviconUrl } from '@/shared/utils/urlUtils.js';
import { parseLocation } from '@/shared/utils/location.js';
import { useModalStore } from '@/state/modalStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Badge } from '@/ui/shadcn/badge.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import { Checkbox } from '@/ui/shadcn/checkbox.jsx';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu.jsx';
import { Input } from '@/ui/shadcn/input.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover.jsx';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs.jsx';
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

function firstArray(...values) {
    return values.find((value) => Array.isArray(value)) || [];
}

function normalizedText(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function isOfflineLikeValue(value) {
    const normalized = normalizedText(value).toLowerCase();
    return !normalized || normalized === 'offline' || normalized === 'private' || normalized === 'traveling';
}

function summarizeEntityRow(row, fallback = '—') {
    if (typeof row === 'string') {
        return /^(usr|wrld|wld|avtr|grp)_/i.test(row.trim()) ? fallback : row;
    }
    if (!row || typeof row !== 'object') {
        return fallback;
    }
    const label = row.displayName || row.name || row.worldName || row.groupName || row.avatarName || fallback;
    return row.$favoriteGroup ? `${row.$favoriteGroup}: ${label}` : label;
}

function filterRows(rows, query) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) {
        return rows;
    }
    return rows.filter((row) =>
        [
            row?.displayName,
            row?.name,
            row?.worldName,
            row?.groupName,
            row?.avatarName,
            row?.authorName,
            row?.description,
            row?.id,
            row?.$favoriteGroup
        ].some((value) => String(value || '').toLowerCase().includes(normalizedQuery))
    );
}

function sortAvatarRows(rows, sortBy) {
    const nextRows = [...rows];
    if (sortBy === 'update') {
        return nextRows.sort((left, right) => String(right.updated_at || right.updatedAt || '').localeCompare(String(left.updated_at || left.updatedAt || '')));
    }
    if (sortBy === 'createdAt') {
        return nextRows.sort((left, right) => String(right.created_at || right.createdAt || '').localeCompare(String(left.created_at || left.createdAt || '')));
    }
    return nextRows.sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
}

function sortMutualFriendRows(rows, sortBy) {
    const comparers = {
        alphabetical: compareByDisplayName,
        lastActive: compareByLastActiveRef,
        friendOrder: compareByFriendOrder
    };
    const comparer = comparers[sortBy] || comparers.alphabetical;
    return [...rows].sort((left, right) => {
        const result = comparer(left, right);
        return Number.isFinite(result) ? result : compareByDisplayName(left, right);
    });
}

function compareGroupRowsByInGameOrder(groupOrder = []) {
    const orderMap = new Map((groupOrder || []).map((groupId, index) => [groupId, index]));
    return (left, right) => {
        const leftOrder = orderMap.has(groupIdForRow(left)) ? orderMap.get(groupIdForRow(left)) : Number.MAX_SAFE_INTEGER;
        const rightOrder = orderMap.has(groupIdForRow(right)) ? orderMap.get(groupIdForRow(right)) : Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
        }
        return compareByName(left, right);
    };
}

function sortUserGroupRows(rows, sortBy, groupOrder = []) {
    const comparers = {
        alphabetical: compareByName,
        members: compareByMemberCount,
        inGame: compareGroupRowsByInGameOrder(groupOrder)
    };
    const comparer = comparers[sortBy] || comparers.alphabetical;
    return [...rows].sort((left, right) => {
        const result = comparer(left, right);
        return Number.isFinite(result) && result !== 0 ? result : compareByName(left, right);
    });
}

function hydrateMutualFriendRows(rows, friendsById) {
    return rows.map((row) => {
        const userId = normalizedText(row?.id || row?.userId);
        const cachedFriend = userId ? friendsById?.[userId] : null;
        if (!cachedFriend) {
            return row;
        }
        const friendNumber = row?.$friendNumber ?? row?.friendNumber ?? cachedFriend.$friendNumber ?? cachedFriend.friendNumber;
        return {
            ...cachedFriend,
            ...row,
            ...(friendNumber !== undefined ? { $friendNumber: friendNumber, friendNumber } : {})
        };
    });
}

function worldOccupantSubtitle(row) {
    const occupants = Number(row?.occupants ?? row?.userCount ?? 0) || 0;
    return occupants > 0 ? `(${occupants})` : '';
}

function normalizeLanguageRows(rows, tags = []) {
    const normalizedRows = firstArray(rows).map((entry) => {
        if (typeof entry === 'string') {
            return { key: entry, value: entry };
        }
        return {
            key: entry?.key || entry?.id || entry?.value || '',
            value: entry?.value || entry?.label || entry?.name || entry?.key || ''
        };
    }).filter((entry) => entry.key || entry.value);
    const seen = new Set(normalizedRows.map((entry) => String(entry.key || entry.value).toLowerCase()));
    for (const tag of firstArray(tags)) {
        const normalizedTag = String(tag || '').trim().toLowerCase();
        if (!normalizedTag.startsWith('language_')) {
            continue;
        }
        const key = normalizedTag.replace(/^language_/, '');
        if (!key || seen.has(key)) {
            continue;
        }
        normalizedRows.push({ key, value: key });
        seen.add(key);
    }
    return normalizedRows;
}

function formatDate(value) {
    if (!value) {
        return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatStatsDate(value) {
    return value ? formatDateFilter(value, 'long') : '—';
}

function formatStatsDuration(value) {
    const duration = Number(value) || 0;
    return duration > 0 ? timeToText(duration) : '—';
}

function normalizePreviousDisplayNames(value) {
    const rows = value instanceof Map
        ? Array.from(value, ([displayName, updated_at]) => ({ displayName, updated_at }))
        : firstArray(value);

    return rows
        .map((entry) => {
            if (typeof entry === 'string') {
                return { displayName: entry, updated_at: '' };
            }
            return {
                displayName: normalizedText(entry?.displayName || entry?.name),
                updated_at: entry?.updated_at || entry?.updatedAt || entry?.date || ''
            };
        })
        .filter((entry) => entry.displayName);
}

function groupMemberVisibility(group) {
    return normalizedText(
        group?.memberVisibility ||
            group?.member_visibility ||
            group?.myMember?.visibility ||
            group?.my_member?.visibility ||
            'visible'
    ) || 'visible';
}

function isMutualGroup(group) {
    const membership = group?.membership && typeof group.membership === 'object' ? group.membership : {};
    const myMember = group?.myMember || group?.my_member || {};
    return normalizedBoolean(
        group?.mutualGroup ??
            group?.mutual_group ??
            group?.isMutualGroup ??
            group?.is_mutual_group ??
            group?.isMutual ??
            group?.is_mutual ??
            group?.mutualMembership ??
            group?.mutual_membership ??
            group?.sharedGroup ??
            group?.shared_group ??
            group?.isSharedGroup ??
            group?.is_shared_group ??
            membership.mutual ??
            membership.isMutual ??
            membership.is_mutual ??
            myMember.mutual ??
            myMember.isMutual ??
            myMember.is_mutual ??
            group?.mutual ??
            group?.shared
    );
}

function normalizedBoolean(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    const normalized = normalizedText(value).toLowerCase();
    if (!normalized || normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
    }
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
    }
    return Boolean(value);
}

function firstText(...values) {
    for (const value of values) {
        const normalized = normalizedText(value);
        if (normalized) {
            return normalized;
        }
    }
    return '';
}

function groupOwnerId(group) {
    const owner = group?.owner;
    const creator = group?.creator || group?.createdBy || group?.created_by;
    return firstText(
        group?.ownerId,
        group?.owner_id,
        group?.ownerUserId,
        group?.owner_user_id,
        group?.ownerUserID,
        group?.owner_userID,
        group?.creatorId,
        group?.creator_id,
        group?.creatorUserId,
        group?.creator_user_id,
        typeof owner === 'string' ? owner : '',
        owner?.id,
        owner?.userId,
        owner?.user_id,
        owner?.userID,
        typeof creator === 'string' ? creator : '',
        creator?.id,
        creator?.userId,
        creator?.user_id,
        creator?.userID
    );
}

function groupMemberUserId(group) {
    const myMember = group?.myMember || group?.my_member || {};
    return firstText(
        group?.userId,
        group?.user_id,
        group?.memberUserId,
        group?.member_user_id,
        myMember.userId,
        myMember.user_id,
        myMember.userID
    );
}

function topLevelMembershipStatus(group) {
    return firstText(
        group?.membershipStatus,
        group?.membership_status,
        group?.memberStatus,
        group?.member_status,
        group?.membership?.status,
        group?.membership?.role,
        group?.member?.role,
        group?.myMember?.role,
        group?.my_member?.role,
        group?.roleName,
        group?.role_name,
        group?.role,
        group?.relationship
    ).toLowerCase();
}

function roleNameContainsOwner(value) {
    if (!value) {
        return false;
    }
    if (Array.isArray(value)) {
        return value.some(roleNameContainsOwner);
    }
    if (typeof value === 'object') {
        return roleNameContainsOwner(value.name || value.displayName || value.roleName || value.role_name || value.id);
    }
    return normalizedText(value).toLowerCase().includes('owner');
}

function groupIdForRow(group) {
    const nestedGroup = group?.group && typeof group.group === 'object' ? group.group : {};
    const explicitGroupId = firstText(
        group?.groupId,
        group?.group_id,
        nestedGroup.id,
        nestedGroup.groupId,
        nestedGroup.group_id
    );
    if (explicitGroupId) {
        return explicitGroupId;
    }
    const directId = firstText(group?.id);
    return directId.startsWith('grp_') ? directId : '';
}

function isOwnedGroupForUser(group, userId) {
    const normalizedUserId = normalizedText(userId);
    if (!normalizedUserId) {
        return false;
    }

    const ownerId = groupOwnerId(group);
    if (ownerId && ownerId === normalizedUserId) {
        return true;
    }

    const memberUserId = groupMemberUserId(group);
    const status = topLevelMembershipStatus(group);
    if ((memberUserId === normalizedUserId || !memberUserId) && (status === 'owner' || status === 'owned' || status.includes('owner'))) {
        return true;
    }

    return (memberUserId === normalizedUserId || !memberUserId) && (
        normalizedBoolean(group?.isOwner ?? group?.is_owner ?? group?.owned) ||
        roleNameContainsOwner(group?.membership?.roles) ||
        roleNameContainsOwner(group?.member?.roles) ||
        roleNameContainsOwner(group?.userRoles) ||
        roleNameContainsOwner(group?.user_roles) ||
        roleNameContainsOwner(group?.userRoleNames) ||
        roleNameContainsOwner(group?.user_role_names) ||
        roleNameContainsOwner(group?.myMember?.roles) ||
        roleNameContainsOwner(group?.my_member?.roles)
    );
}

function isMutualGroupForUser(group, isCurrentUser) {
    if (isCurrentUser) {
        return false;
    }
    return isMutualGroup(group);
}

function normalizeUserGroupMembershipRow(group) {
    if (!group || typeof group !== 'object') {
        return group;
    }

    const nestedGroup = group.group && typeof group.group === 'object' ? group.group : {};
    const groupId = groupIdForRow(group);
    const currentId = normalizedText(group.id);
    const memberId = normalizedText(group.$memberId || group.memberId || group.member_id || (currentId && currentId !== groupId ? currentId : ''));
    const myMember = group.myMember || group.my_member || {};
    const mergedGroup = { ...nestedGroup, ...group };
    const ownerId = groupOwnerId(mergedGroup);

    return {
        ...nestedGroup,
        ...group,
        ...(memberId ? { $memberId: memberId } : {}),
        id: groupId,
        groupId,
        ownerId,
        memberVisibility: group.memberVisibility || group.member_visibility || myMember.visibility || group.visibility || 'visible',
        isRepresenting: Boolean(group.isRepresenting || group.is_representing || myMember.isRepresenting || myMember.is_representing),
        mutualGroup: isMutualGroup(mergedGroup),
        myMember: {
            ...myMember,
            ...(memberId ? { id: memberId } : {}),
            groupId,
            visibility: myMember.visibility || group.memberVisibility || group.member_visibility || group.visibility || 'visible',
            isRepresenting: Boolean(myMember.isRepresenting || myMember.is_representing || group.isRepresenting || group.is_representing)
        }
    };
}

function normalizeUserGroupMembershipRows(groups) {
    return firstArray(groups).map(normalizeUserGroupMembershipRow);
}

function formatCountText(count, max) {
    const normalizedMax = Number(max) || 0;
    return normalizedMax ? `${count}/${normalizedMax}` : String(count);
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

function resolveStatusStateText(profile) {
    const state = normalizedText(profile?.state);
    const status = normalizedText(profile?.status);
    if (state && status && state.toLowerCase() !== status.toLowerCase()) {
        return `${state} / ${status}`;
    }
    return state || status || '';
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

function userRowSubtitle(row) {
    if (userTravelingTimestamp(row)) {
        return '';
    }
    const explicit = row?.$subtitle || row?.subtitle;
    if (explicit) {
        return explicit;
    }
    const joinedAt = normalizedText(row?.$location_at || row?.locationAt || row?.joinedAt || row?.created_at || row?.createdAt);
    const timestamp = joinedAt ? Date.parse(joinedAt) : Number.NaN;
    if (!Number.isNaN(timestamp)) {
        return timeToText(Date.now() - timestamp);
    }
    return row?.statusDescription || row?.status || row?.stateBucket || row?.state || '';
}

function rowUserId(row) {
    if (typeof row === 'string') {
        return normalizedText(row);
    }
    return normalizedText(row?.id || row?.userId || row?.user_id || row?.targetUserId || row?.target_user_id);
}

function userTravelingTimestamp(row) {
    if (normalizedText(row?.location).toLowerCase() !== 'traveling') {
        return 0;
    }
    const value = row?.$travelingToTime || row?.travelingToTime || row?.traveling_to_time;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
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
    const image = rowImage(group, 'group');
    const label = summarizeEntityRow(group);
    const visibility = groupMemberVisibility(group);
    const memberCount = Number(group?.memberCount ?? group?.member_count ?? group?.membershipCount ?? group?.membership_count ?? 0) || 0;
    return (
        <div className={`box-border flex ${editable ? 'w-[220px]' : 'w-[167px]'} items-center p-1.5 text-[13px] hover:rounded-[25px_5px_5px_25px] hover:bg-muted/50`}>
            {selectable ? (
                <Checkbox
                    checked={selected}
                    disabled={busy}
                    aria-label={`Select ${label || 'group'}`}
                    className="mr-1.5 shrink-0"
                    onCheckedChange={(checked) => onSelectionChange?.(group, checked === true)}
                />
            ) : null}
            <button
                type="button"
                className="flex min-w-0 flex-1 cursor-pointer items-center text-left"
                onClick={() => openRow(group, 'group')}>
                {image ? (
                    <img src={image} alt="" className="mr-2.5 size-9 shrink-0 rounded-full object-cover" />
                ) : (
                    <div className="mr-2.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                        <UsersIcon className="size-4 text-muted-foreground" />
                    </div>
                )}
                <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="block truncate font-medium leading-[18px]">{label || '—'}</span>
                    <span className="inline-flex max-w-full items-center truncate text-xs text-muted-foreground">
                        {group?.isRepresenting || group?.is_representing ? <TagIcon className="mr-1.5 size-3.5 shrink-0" aria-label="Representing" /> : null}
                        {visibility !== 'visible' ? <EyeIcon className="mr-1.5 size-3.5 shrink-0" aria-label={`Visibility ${visibility}`} /> : null}
                        <span className="truncate">({memberCount})</span>
                    </span>
                </span>
            </button>
            {editable ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button type="button" size="icon-sm" variant="ghost" className="ml-1 shrink-0" disabled={busy} title="Manage group membership">
                            <SettingsIcon className="size-3.5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {onMove ? (
                            <>
                                <DropdownMenuItem onSelect={() => void onMove(group, 'top')}>
                                    <DownloadIcon className="size-4 rotate-180" />
                                    Move Top
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => void onMove(group, 'up')}>
                                    <ArrowUpIcon className="size-4" />
                                    Move Up
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => void onMove(group, 'down')}>
                                    <ArrowDownIcon className="size-4" />
                                    Move Down
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => void onMove(group, 'bottom')}>
                                    <DownloadIcon className="size-4" />
                                    Move Bottom
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                            </>
                        ) : null}
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
                            <LogOutIcon className="size-4" />
                            Leave Group
                        </DropdownMenuItem>
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
                    ? userRowSubtitle(row)
                    : kind === 'world'
                        ? worldOccupantSubtitle(row)
                        : row?.authorName || row?.description || row?.shortCode || row?.username || '';
                const travelingTimestamp = kind === 'user' ? userTravelingTimestamp(row) : 0;
                const dotClassName = kind === 'user' ? userStatusDotClassName(row) : '';
                return (
                    <button
                        key={`${row?.id || row?.userId || label}:${index}`}
                        type="button"
                        className="box-border flex w-[167px] cursor-pointer items-center p-1.5 text-left text-[13px] hover:rounded-[25px_5px_5px_25px] hover:bg-muted/50"
                        onClick={() => openRow(row, kind)}>
                        <span className="relative mr-2.5 size-9 shrink-0">
                            {image ? (
                                <img src={image} alt="" className="size-9 rounded-full object-cover" />
                            ) : (
                                <span className="flex size-9 items-center justify-center rounded-full bg-muted">
                                    <UserIcon className="size-4 text-muted-foreground" />
                                </span>
                            )}
                            {dotClassName ? <span className={`absolute bottom-0 right-0 z-10 size-2.5 rounded-full border border-background ${dotClassName}`} /> : null}
                        </span>
                        <span className="min-w-0 flex-1 overflow-hidden">
                            <span className="block truncate font-medium leading-[18px]" style={kind === 'user' && row?.$userColour ? { color: row.$userColour } : undefined}>{label || '—'}</span>
                            {travelingTimestamp ? (
                                <span className="block truncate text-xs text-muted-foreground">
                                    <LoaderCircleIcon className="mr-1 inline-block size-3 animate-spin" />
                                    {timeToText(Date.now() - travelingTimestamp)}
                                </span>
                            ) : subtitle ? <span className="block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

function splitUserGroups(groups, userId, isCurrentUser) {
    const ownGroups = [];
    const mutualGroups = [];
    const remainingGroups = [];

    for (const group of groups || []) {
        if (isOwnedGroupForUser(group, userId)) {
            ownGroups.push(group);
            continue;
        }
        if (isMutualGroupForUser(group, isCurrentUser)) {
            mutualGroups.push(group);
            continue;
        }
        remainingGroups.push(group);
    }

    return { ownGroups, mutualGroups, remainingGroups };
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
        <section className="space-y-2">
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

function resolveTabValue(tabs, preferred, fallback = 'info') {
    return tabs.some((tab) => tab.value === preferred) ? preferred : fallback;
}

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
    onEditSelfStatusDescription,
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
    const profileGroups = normalizeUserGroupMembershipRows(
        remoteStatus.groups === 'ready'
            ? remoteData.groups
            : firstArray(profile.groups, profile.groupMemberships, profile.$groups)
    );
    const mutualFriends = hydrateMutualFriendRows(
        remoteStatus.mutual === 'ready'
            ? remoteData.mutual
            : firstArray(profile.mutualFriends, profile.$mutualFriends),
        friendsById
    );
    const profileWorlds = remoteStatus.worlds === 'ready'
        ? remoteData.worlds
        : firstArray(profile.worlds, profile.$worlds, profile.recentWorlds);
    const favoriteWorlds = remoteStatus['favorite-worlds'] === 'ready'
        ? remoteData.favoriteWorlds
        : firstArray(profile.favoriteWorlds, profile.$favoriteWorlds);
    const profileAvatars = remoteStatus.avatars === 'ready'
        ? remoteData.avatars
        : firstArray(profile.avatars, profile.$avatars);
    const bioLinks = firstArray(profile.bioLinks);
    const filteredMutualFriends = filterRows(mutualFriends, search.mutual);
    const visibleMutualFriends = sortMutualFriendRows(filteredMutualFriends, mutualSort);
    const effectiveGroupSort = !isCurrentUser && groupSort === 'inGame' ? 'alphabetical' : groupSort;
    const sortedProfileGroups = sortUserGroupRows(profileGroups, effectiveGroupSort, inGameGroupOrder);
    const filteredProfileGroups = filterRows(sortedProfileGroups, search.groups);
    const selectedUserGroups = sortedProfileGroups.filter((group) => selectedGroupIds.has(groupIdForRow(group)));
    const filteredProfileWorlds = filterRows(profileWorlds, search.worlds);
    const filteredFavoriteWorlds = filterRows(favoriteWorlds, search.favoriteWorlds);
    const filteredProfileAvatars = filterRows(profileAvatars, search.avatars);
    const visibleProfileAvatars = sortAvatarRows(
        effectiveAvatarReleaseStatus === 'all'
            ? filteredProfileAvatars
            : filteredProfileAvatars.filter((avatar) => avatar.releaseStatus === effectiveAvatarReleaseStatus),
        avatarSort
    );
    const isRecentDialogAction = (actionType) =>
        recentActionVersion >= 0 && isActionRecent(profile.id, actionType);
    const recentDialogShortcut = (actionType) =>
        isRecentDialogAction(actionType) ? <ClockIcon className="size-3.5 text-muted-foreground" /> : null;
    const tabs = [
        { value: 'info', label: 'Info' },
        ...(!isCurrentUser && !currentUserHasSharedConnectionsOptOut ? [{ value: 'mutual', label: 'Mutual' }] : []),
        { value: 'groups', label: 'Groups' },
        { value: 'worlds', label: 'Worlds' },
        ...(!isCurrentUser
            ? [
                { value: 'favorite-worlds', label: 'Favorite Worlds' },
                { value: 'avatars', label: 'Avatars' }
            ]
            : []),
        { value: 'activity', label: 'Activity' },
        { value: 'json', label: 'JSON' }
    ];
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
        if (!['mutual', 'groups', 'worlds', 'favorite-worlds', 'avatars'].includes(tab)) {
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
            let rows = [];
            let favoriteGroupsForTab = [];
            if (tab === 'mutual') {
                rows = await userProfileRepository.getAllMutualFriends({
                    userId: profile.id,
                    endpoint: currentEndpoint
                });
            } else if (tab === 'groups') {
                rows = await groupProfileRepository.getUserGroups({
                    userId: profile.id,
                    endpoint: currentEndpoint
                });
            } else if (tab === 'worlds') {
                rows = await worldProfileRepository.getAllWorldsByUser({
                    userId: profile.id,
                    endpoint: currentEndpoint,
                    sort: worldSort,
                    order: worldOrder,
                    releaseStatus: profile.id === currentUserId ? 'all' : 'public'
                });
            } else if (tab === 'avatars') {
                if (profile.id === currentUserId) {
                    rows = await avatarProfileRepository.getAllAvatarsByUser({
                        userId: profile.id,
                        user: 'me',
                        endpoint: currentEndpoint,
                        sort: avatarSort === 'createdAt' ? 'createdAt' : avatarSort === 'update' ? 'updated' : 'name',
                        order: avatarSort === 'name' ? 'ascending' : 'descending',
                        releaseStatus: effectiveAvatarReleaseStatus
                    });
                } else {
                    const providerConfig = await avatarSearchProviderRepository.getConfig();
                    if (!providerConfig.enabled || !providerConfig.selectedProvider) {
                        rows = [];
                    } else {
                        const response = await avatarSearchProviderRepository.search({
                            provider: providerConfig.selectedProvider,
                            query: profile.id
                        });
                        rows = response.avatars.filter((avatar) => avatar.authorId === profile.id);
                    }
                }
            } else if (tab === 'favorite-worlds') {
                const favoriteGroups = await vrchatFavoriteRepository.getAllFavoriteGroups({
                    endpoint: currentEndpoint,
                    ownerId: profile.id
                });
                const worldGroups = favoriteGroups
                    .filter((group) => group?.type === 'world');
                favoriteGroupsForTab = worldGroups;
                const worldListResults = await Promise.allSettled(
                    worldGroups.map(async (group) => {
                        const worlds = await vrchatFavoriteRepository.getAllFavoriteWorlds({
                            endpoint: currentEndpoint,
                            ownerId: profile.id,
                            userId: profile.id,
                            tag: group.name
                        });
                        return worlds
                            .map((world) => ({
                                ...world,
                                $favoriteGroup: group.displayName || group.name,
                                $favoriteGroupKey: group.name
                            }));
                    })
                );
                rows = worldListResults
                    .filter((result) => result.status === 'fulfilled')
                    .flatMap((result) => result.value);
            }

            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            const dataKey = tab === 'favorite-worlds' ? 'favoriteWorlds' : tab;
            setRemoteData((current) => ({
                ...current,
                [dataKey]: rows,
                ...(tab === 'favorite-worlds' ? { favoriteWorldGroups: favoriteGroupsForTab } : {})
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
    const previousDisplayNames = normalizePreviousDisplayNames(
        userStats.previousDisplayNames?.length
            ? userStats.previousDisplayNames
            : profile.previousDisplayNames || profile.pastDisplayNames
    );
    const previousDisplayNamesTitle = previousDisplayNames
        .map((entry) =>
            entry.updated_at
                ? `${entry.displayName} - ${formatStatsDate(entry.updated_at)}`
                : entry.displayName
        )
        .join('\n');
    const statusStateText = resolveStatusStateText(profile);
    const groupSearchActive = normalizedText(search.groups).length > 0;
    const userGroupSections = splitUserGroups(sortedProfileGroups, profile.id, isCurrentUser);
    const selectedGroupCount = selectedUserGroups.length;
    const groupLimits = vrchatConfigConstants?.GROUPS || {};
    const isLocalUserVrcPlusSupporter = Boolean(
        currentUserSnapshot?.$isVRCPlus ||
            currentUserSnapshot?.tags?.includes?.('system_supporter') ||
            globalThis?.$debug?.debugVrcPlus
    );
    const ownGroupCountText = formatCountText(userGroupSections.ownGroups.length, groupLimits.MAX_OWNED);
    const remainingGroupCountText = formatCountText(
        userGroupSections.remainingGroups.length,
        isCurrentUser
            ? isLocalUserVrcPlusSupporter
                ? groupLimits.MAX_JOINED_PLUS
                : groupLimits.MAX_JOINED
            : 0
    );
    const userTimeSpent = Number(userStats.timeSpent ?? profile.timeSpent ?? profile.$timeSpent ?? 0) || 0;
    const userJoinCount = Number(userStats.joinCount ?? profile.joinCount ?? profile.$joinCount ?? 0) || 0;
    const lastSeen = userStats.lastSeen || profile.lastSeen || '';
    const profileLanguages = normalizeLanguageRows(firstArray(profile.$languages, profile.languages), profile.tags);
    const mutualFriendCount = Number(profile.mutualFriendCount ?? profile.$mutualFriendCount ?? mutualFriends.length ?? 0) || 0;
    const friendNumber = Number(profile.$friendNumber ?? profile.friendNumber ?? 0) || 0;
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
            locationInstance?.user_id
    );
    const locationOwnerId = rowUserId(locationOwnerUser) || locationOwnerFallbackId;
    const locationOwnerName = normalizedText(
        locationOwnerUser?.displayName ||
            locationOwnerUser?.username ||
            locationOwnerUser?.name ||
            locationOwnerId
    );
    const locationOwnerRow = locationOwnerUser
        ? {
            ...locationOwnerUser,
            $subtitle: t('dialog.user.info.instance_creator')
        }
        : locationOwnerId
            ? {
                id: locationOwnerId,
                userId: locationOwnerId,
                displayName: locationOwnerName,
                $subtitle: t('dialog.user.info.instance_creator')
            }
        : null;
    const locationPlayerUsers = locationOwnerId
        ? locationUsers.filter((user) => rowUserId(user) !== locationOwnerId)
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
                imageClassName="h-[120px] w-[160px]"
                onImageClick={imageUrl ? () => openImagePreview({ url: imageUrl, title: profile.displayName || profile.username || 'User' }) : null}
                imagePlaceholder={<UsersIcon className="size-8 text-muted-foreground" />}
                title={profile.displayName || profile.username || 'User'}
                onTitleClick={profile.displayName || profile.username ? () => void copyUserText(profile.displayName || profile.username, 'Display name') : undefined}
                titleMeta={
                    <>
                        {previousDisplayNames.length ? (
                            <Badge variant="outline" className="shrink-0 text-[11px]" title={previousDisplayNamesTitle}>
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
                        {isCurrentUser ? <Badge>Current</Badge> : null}
                        {isFriend ? <Badge variant="secondary">Friend</Badge> : null}
                        {isFavorite ? (
                            <Badge>
                                <HeartIcon className="mr-1 size-3.5 fill-current" />
                                Favorite
                            </Badge>
                        ) : null}
                        {profile.$isModerator ? (
                            <Badge variant="secondary">
                                <ShieldCheckIcon className="mr-1 size-3.5" />
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
                            {PlatformIcon ? <PlatformIcon className="mr-1 size-3.5" /> : null}
                            {platform.label}
                        </Badge>
                        {profileLanguages.map((language) => (
                            <Badge key={`${language.key}:${language.value}`} variant="outline" title={language.value || language.key}>
                                {languageMappings[String(language.key).toLowerCase()] || language.key || language.value}
                            </Badge>
                        ))}
                        {profile.discordId ? (
                            <button type="button" onClick={() => void openDiscordProfile(profile.discordId)}>
                                <Badge variant="outline">Discord</Badge>
                            </button>
                        ) : null}
                    </>
                }
                mediaBadges={
                    <>
                        {profile.userIcon ? (
                            <button type="button" onClick={() => openImagePreview({ url: convertFileUrlToImageUrl(profile.userIcon, 512), title: profile.displayName || profile.username || 'User' })}>
                                <img src={convertFileUrlToImageUrl(profile.userIcon, 64)} alt="" className="size-8 rounded-md object-cover" />
                            </button>
                        ) : null}
                        {Array.isArray(profile.badges) ? profile.badges.filter((badge) => badge?.badgeImageUrl).map((badge) => (
                            <Popover key={badge.badgeId || badge.id || badge.badgeName}>
                                <PopoverTrigger asChild>
                                    <button
                                        type="button"
                                        title={`${badge.badgeName || 'Badge'}${badge.hidden ? ' (Hidden)' : ''}`}
                                        className="rounded-sm"
                                        onClick={(event) => event.stopPropagation()}>
                                        <img
                                            src={badge.badgeImageUrl}
                                            alt={badge.badgeName || ''}
                                            className={`size-8 rounded-sm object-cover ${badge.hidden ? 'grayscale' : ''}`}
                                        />
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent side="bottom" className="w-72 space-y-3">
                                    <button
                                        type="button"
                                        className="block w-full"
                                        onClick={() => badge.badgeImageUrl && openImagePreview({ url: badge.badgeImageUrl, title: badge.badgeName || profile.displayName || profile.username || 'Badge' })}>
                                        <img src={badge.badgeImageUrl} alt={badge.badgeName || ''} className="max-h-56 w-full rounded-md object-contain" />
                                    </button>
                                    <div className="space-y-1 text-sm">
                                        <div className="font-medium">
                                            {badge.badgeName || 'Badge'}
                                            {badge.hidden ? <span className="ml-1 text-xs text-muted-foreground">(Hidden)</span> : null}
                                        </div>
                                        {badge.badgeDescription ? <div className="text-xs text-muted-foreground">{badge.badgeDescription}</div> : null}
                                        {badge.assignedAt ? <div className="text-xs font-mono text-muted-foreground">Assigned: {formatStatsDate(badge.assignedAt)}</div> : null}
                                    </div>
                                    {isCurrentUser ? (
                                        <div className="space-y-2 border-t pt-3 text-sm">
                                            <label className="flex items-center gap-2">
                                                <Checkbox
                                                    checked={Boolean(badge.hidden)}
                                                    disabled={actionStatus !== 'idle' || !onToggleBadgeVisibility}
                                                    onCheckedChange={(checked) => onToggleBadgeVisibility?.(badge, Boolean(checked))}
                                                />
                                                <span>Hidden</span>
                                            </label>
                                            <label className="flex items-center gap-2">
                                                <Checkbox
                                                    checked={Boolean(badge.showcased)}
                                                    disabled={actionStatus !== 'idle' || !onToggleBadgeShowcased}
                                                    onCheckedChange={(checked) => onToggleBadgeShowcased?.(badge, Boolean(checked))}
                                                />
                                                <span>Showcased</span>
                                            </label>
                                        </div>
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
                                    <EntityActionItem icon={PencilIcon} disabled={actionStatus !== 'idle'} onSelect={onEditSelfStatusDescription}>Edit Status Description</EntityActionItem>
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
                        <div className="mb-2 space-y-2 border-b border-border pb-2">
                            <div className="space-y-1 text-sm">
                                {visiblePresenceLocation.includes(':') ? (
                                    <InstanceActionBar
                                        location={visiblePresenceLocation}
                                        launchLocation={visiblePresenceLocation}
                                        inviteLocation={visiblePresenceLocation}
                                        instanceLocation={visiblePresenceLocation}
                                        instance={locationInstance}
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
                                        instanceOwner={locationOwnerId}
                                        instanceOwnerName={locationOwnerName}
                                        playerCount={locationPlayerCount}
                                        capacity={locationInstance?.capacity ?? locationInstance?.recommendedCapacity}
                                        endpoint={currentEndpoint}
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
                                <div className="max-h-[150px] space-y-2 overflow-auto">
                                    {locationOwnerRow ? (
                                        <div className="space-y-1">
                                            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                                {t('dialog.user.info.instance_creator')}
                                            </div>
                                            <EntityList rows={[locationOwnerRow]} kind="user" />
                                        </div>
                                    ) : null}
                                    {locationPlayerUsers.length ? (
                                        <div className="space-y-1">
                                            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
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
                                <pre className="max-h-[210px] whitespace-pre-wrap text-xs font-[inherit] text-muted-foreground">{profile.note}</pre>
                            </EntityInfoBlock>
                        ) : null}
                        {memo && !hideUserMemos ? (
                            <EntityInfoBlock label="Memo" full onClick={onEditMemo}>
                                <pre className="max-h-[210px] whitespace-pre-wrap text-xs font-[inherit] text-muted-foreground">{memo}</pre>
                            </EntityInfoBlock>
                        ) : null}
                        <EntityInfoBlock label="Avatar Info" full>
                            {currentAvatarTarget ? (
                                <Button type="button" variant="link" className="h-auto justify-start p-0 text-left text-xs" onClick={() => openAvatarDialog(currentAvatarDialogArgs)}>
                                    <UserIcon className="mr-1 size-3.5" />
                                    {currentAvatarDisplayName || 'Avatar'}
                                </Button>
                            ) : <span className="block truncate text-xs">—</span>}
                        </EntityInfoBlock>
                        <EntityInfoBlock label="Represented Group" full>
                            {representedGroupStatus === 'running' ? (
                                <span className="block text-xs text-muted-foreground">Loading...</span>
                            ) : representedGroup?.isRepresenting ? (
                                <button
                                    type="button"
                                    className="flex max-w-full items-center gap-2 text-left text-xs hover:underline"
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
                                </button>
                            ) : (
                                <span className="block text-xs text-muted-foreground">—</span>
                            )}
                        </EntityInfoBlock>
                        <EntityInfoBlock label="Bio" full>
                            <div className="flex items-start gap-2">
                                <pre className="max-h-[210px] min-w-0 flex-1 overflow-auto whitespace-pre-wrap text-xs font-[inherit] text-muted-foreground">{visibleBio}</pre>
                                {profile.bio ? (
                                    <Button
                                        type="button"
                                        size="icon-sm"
                                        variant="ghost"
                                        className="h-6 w-6 shrink-0"
                                        disabled={bioTranslationLoading}
                                        title={translatedBioActive ? 'Show original bio' : 'Translate bio'}
                                        onClick={() => void toggleBioTranslation()}>
                                        {bioTranslationLoading ? <LoaderCircleIcon className="size-3 animate-spin" /> : <LanguagesIcon className="size-3" />}
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
                                            size="icon-sm"
                                            className="size-6"
                                            title={link}
                                            onClick={() => openExternalLink(link)}>
                                            {getFaviconUrl(link) ? (
                                                <img src={getFaviconUrl(link)} alt="" className="size-4" />
                                            ) : (
                                                <ExternalLinkIcon className="size-4" />
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
                                                className="ml-1 size-6 rounded-full p-0"
                                                size="icon-sm"
                                                variant="ghost"
                                                onClick={(event) => event.stopPropagation()}>
                                                <CopyIcon className="size-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start">
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
                <EntityDialogTabContent value="mutual" className="space-y-2">
                    <SearchHeader searchKey="mutual" tab="mutual" rows={mutualFriends} filteredRows={filteredMutualFriends} placeholder="Search mutual friends">
                        <span className="text-sm text-muted-foreground">Sort By</span>
                        <Select value={mutualSort} onValueChange={setMutualSort} disabled={remoteStatus.mutual === 'running'}>
                            <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {Object.entries(userDialogMutualFriendSortingOptions).map(([key, option]) => (
                                    <SelectItem key={key} value={option.value}>
                                        {t(option.name)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </SearchHeader>
                    <EntityList rows={visibleMutualFriends} kind="user" loading={remoteStatus.mutual === 'running'} error={remoteErrors.mutual} />
                </EntityDialogTabContent>
                <EntityDialogTabContent value="groups" className="space-y-2">
                    <SearchHeader searchKey="groups" tab="groups" rows={profileGroups} filteredRows={filteredProfileGroups} placeholder="Search groups">
                        {!groupEditMode ? (
                            <>
                                <span className="text-sm text-muted-foreground">Sort By</span>
                                <Select value={effectiveGroupSort} onValueChange={setGroupSort} disabled={remoteStatus.groups === 'running'}>
                                    <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(userDialogGroupSortingOptions).map(([key, option]) => (
                                            <SelectItem key={key} value={option.value} disabled={option.value === 'inGame' && !isCurrentUser}>
                                                {t(option.name)}
                                            </SelectItem>
                                        ))}
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
                                                    <SettingsIcon className="size-3.5" />
                                                    Bulk Actions
                                                    {selectedGroupCount ? <span className="text-xs text-muted-foreground">({selectedGroupCount})</span> : null}
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="start">
                                                <DropdownMenuItem disabled={!selectedGroupCount} onSelect={() => void changeSelectedGroupsVisibility('visible')}>
                                                    <EyeIcon className="size-4" />
                                                    Set Selected Visible
                                                </DropdownMenuItem>
                                                <DropdownMenuItem disabled={!selectedGroupCount} onSelect={() => void changeSelectedGroupsVisibility('hidden')}>
                                                    <EyeIcon className="size-4" />
                                                    Set Selected Hidden
                                                </DropdownMenuItem>
                                                <DropdownMenuItem disabled={!selectedGroupCount} onSelect={() => void changeSelectedGroupsVisibility('friends')}>
                                                    <UsersIcon className="size-4" />
                                                    Set Selected Friends
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => exportUserGroups(selectedUserGroups)}>
                                                    <DownloadIcon className="size-4" />
                                                    Export {selectedGroupCount ? 'Selected' : 'All'} Groups
                                                </DropdownMenuItem>
                                                <DropdownMenuItem variant="destructive" disabled={!selectedGroupCount} onSelect={() => void leaveSelectedGroups()}>
                                                    <LogOutIcon className="size-4" />
                                                    Leave Selected
                                                </DropdownMenuItem>
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
                        <div className="space-y-4">
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
                <EntityDialogTabContent value="worlds" className="space-y-4">
                    <div className="space-y-2">
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
                                    <SelectItem value="name">Name</SelectItem>
                                    <SelectItem value="updated">Updated</SelectItem>
                                    <SelectItem value="created">Created</SelectItem>
                                    <SelectItem value="favorites">Favorites</SelectItem>
                                    <SelectItem value="popularity">Popularity</SelectItem>
                                </SelectContent>
                            </Select>
                            <span className="text-sm text-muted-foreground">Order By</span>
                            <Select value={worldOrder} onValueChange={changeWorldOrder} disabled={remoteStatus.worlds === 'running'}>
                                <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="descending">Descending</SelectItem>
                                    <SelectItem value="ascending">Ascending</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <EntityList rows={filteredProfileWorlds} kind="world" loading={remoteStatus.worlds === 'running'} error={remoteErrors.worlds} />
                    </div>
                </EntityDialogTabContent>
                <EntityDialogTabContent value="favorite-worlds" className="space-y-2">
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
                <EntityDialogTabContent value="avatars" className="space-y-2">
                    {currentAvatarTarget ? (
                        <Button type="button" variant="link" className="h-auto justify-start p-0 text-left" onClick={() => openAvatarDialog(currentAvatarDialogArgs)}>
                            <UserIcon className="mr-1 size-3.5" />
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
                                        <SelectItem value="name">Name</SelectItem>
                                        <SelectItem value="update">Updated</SelectItem>
                                        <SelectItem value="createdAt">Uploaded</SelectItem>
                                    </SelectContent>
                                </Select>
                                <span className="text-sm text-muted-foreground">Group By</span>
                                <Select value={avatarReleaseStatus} onValueChange={changeAvatarReleaseStatus} disabled={remoteStatus.avatars === 'running'}>
                                    <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All</SelectItem>
                                        <SelectItem value="public">Public</SelectItem>
                                        <SelectItem value="private">Private</SelectItem>
                                    </SelectContent>
                                </Select>
                            </>
                        ) : null}
                    </div>
                    <EntityList rows={visibleProfileAvatars} kind="avatar" loading={remoteStatus.avatars === 'running'} error={remoteErrors.avatars} />
                </EntityDialogTabContent>
                <EntityDialogTabContent value="activity" className="space-y-4">
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
