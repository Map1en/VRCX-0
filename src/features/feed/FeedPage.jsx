import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowDownIcon,
    ArrowRightIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    CopyIcon,
    ExternalLinkIcon,
    ListFilterIcon,
    LockIcon,
    StarIcon,
    XIcon
} from 'lucide-react';
import { toast } from 'sonner';
import {
    getCoreRowModel,
    getExpandedRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';

import { cn } from '@/lib/utils.js';
import { useI18n } from '@/app/hooks/use-i18n.js';
import {
    ResizableTableCell
} from '@/components/data-table/ResizableTableParts.jsx';
import {
    DataTableHeader,
    DataTableEmptyRow,
    DataTablePagination,
    DataTableScrollArea,
    DataTableSurface
} from '@/components/data-table/DataTableView.jsx';
import {
    PageBody,
    PageFooter,
    PageScaffold,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold.jsx';
import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu.jsx';
import { PreviousInstancesTableDialog } from '@/components/dialogs/PreviousInstancesTableDialog.jsx';
import { Location } from '@/components/Location.jsx';
import { formatDateFilter, timeToText } from '@/lib/dateTime.js';
import { copyTextToClipboard } from '@/lib/entityMedia.js';
import {
    configRepository,
    FEED_FILTER_TYPES,
    avatarSearchProviderRepository,
    feedRepository,
    friendLogRepository,
    gameLogRepository,
    localFavoritesRepository,
    notificationRepository,
    userProfileRepository,
    vrchatSearchRepository
} from '@/repositories/index.js';
import avatarProfileRepository from '@/repositories/avatarProfileRepository.js';
import { openAvatarDialog, openGroupDialog, openUserDialog, openWorldDialog } from '@/services/dialogService.js';
import { tryOpenLaunchLocation } from '@/services/directAccessService.js';
import { selfInviteToInstance } from '@/services/launchService.js';
import { getTablePageSizesPreference } from '@/services/preferencesService.js';
import { extractFileId } from '@/shared/utils/fileUtils.js';
import { checkCanInvite, checkCanInviteSelf } from '@/shared/utils/invite.js';
import { parseLocation, resolveFriendPresenceLocation } from '@/shared/utils/location.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFeedLiveStore } from '@/state/feedLiveStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Calendar } from '@/ui/shadcn/calendar';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import { Input } from '@/ui/shadcn/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Spinner } from '@/ui/shadcn/spinner';
import {
    Table,
    TableBody,
    TableCell,
    TableRow
} from '@/ui/shadcn/table';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from '@/ui/shadcn/tooltip';

import {
    FEED_TABLE_DEFAULT_PAGE_SIZES as DEFAULT_PAGE_SIZES,
    readPersistedFeedTableState as readPersistedState,
    resolveFeedPageSize as resolvePageSize,
    safeJsonParse,
    sanitizeFeedColumnOrder as sanitizeColumnOrder,
    sanitizeFeedColumnSizing as sanitizeColumnSizing,
    sanitizeFeedColumnVisibility as sanitizeColumnVisibility,
    sanitizeFeedPageSizes as sanitizePageSizes,
    sanitizeFeedSorting as sanitizeSorting,
    writePersistedFeedTableState as writePersistedState
} from './feedTableState.js';
import {
    buildFeedFavoriteIdSet as buildFavoriteIdSet,
    canRequestInviteFromFeedFriend,
    collectMatchingLiveFeedEntries,
    getFeedRowId,
    mergeLiveFeedEntries,
    normalizeFeedId as normalizeId,
    parseDateInput,
    resolveDisplayNameCandidate,
    resolveFeedCurrentInviteLocation as resolveCurrentInviteLocation,
    resolveFeedStatusMeta as resolveStatusMeta,
    resolveFeedUserDisplayName,
    resolveFeedUserId,
    toDateInputValue,
    toIsoRangeEnd,
    toIsoRangeStart,
    UNKNOWN_FEED_USER_DISPLAY_NAME
} from './feedRows.js';

function resolvePresenceLocation(profile) {
    return resolveFriendPresenceLocation(profile);
}

async function findAvatarByImageUrl({ imageUrl, avatarName }) {
    const fileId = extractFileId(imageUrl);
    const query = normalizeId(avatarName) || fileId;
    if (!fileId || query.length < 3) {
        return null;
    }

    const cachedAvatars = await localFavoritesRepository.getAvatarCache().catch(() => []);
    const cachedMatch = cachedAvatars.find((avatar) => (
        avatar?.id &&
        (
            extractFileId(avatar.imageUrl) === fileId ||
            extractFileId(avatar.thumbnailImageUrl) === fileId
        )
    ));
    if (cachedMatch) {
        return avatarProfileRepository.normalize(cachedMatch);
    }

    const config = await avatarSearchProviderRepository.getConfig();
    if (!config.enabled || !config.selectedProvider) {
        return null;
    }

    const response = await avatarSearchProviderRepository.search({
        provider: config.selectedProvider,
        query
    });

    return response.avatars.find((avatar) => (
        avatar?.id &&
        (
            extractFileId(avatar.imageUrl) === fileId ||
            extractFileId(avatar.thumbnailImageUrl) === fileId
        )
    )) || null;
}

function formatTimestamp(value) {
    if (!value) {
        return '-';
    }

    return formatDateFilter(value, 'short');
}

function formatTimestampLong(value) {
    if (!value) {
        return '-';
    }

    return formatDateFilter(value, 'long');
}

async function copyFeedText(text, label = 'Value') {
    const value = String(text || '').trim();
    if (!value) {
        return;
    }
    await copyTextToClipboard(value);
    toast.success(`${label} copied.`);
}

function FeedStatusBadge({ status, label }) {
    const meta = resolveStatusMeta(status);
    return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
            {meta.className ? (
                <span className={cn('size-2.5 shrink-0 rounded-full', meta.className)} />
            ) : null}
            {label ? <span className="truncate">{label}</span> : null}
        </span>
    );
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll(/&/g, '&amp;')
        .replaceAll(/</g, '&lt;')
        .replaceAll(/>/g, '&gt;')
        .replaceAll(/"/g, '&quot;')
        .replaceAll(/'/g, '&#039;')
        .replaceAll(/\n/g, '<br>');
}

function formatDifferenceHtml(
    oldValue,
    newValue,
    markerAddition = '<span class="rounded bg-primary/10 px-0.5 text-primary">{{text}}</span>',
    markerDeletion = '<span class="rounded bg-destructive/10 px-0.5 text-destructive line-through">{{text}}</span>'
) {
    const oldWords = escapeHtml(oldValue)
        .split(/\s+/)
        .flatMap((word) => word.split(/(<br>)/));
    const newWords = escapeHtml(newValue)
        .split(/\s+/)
        .flatMap((word) => word.split(/(<br>)/));

    function findLongestMatch(oldStart, oldEnd, newStart, newEnd) {
        let bestOldStart = oldStart;
        let bestNewStart = newStart;
        let bestSize = 0;
        const lookup = new Map();

        for (let i = oldStart; i < oldEnd; i += 1) {
            const word = oldWords[i];
            if (!lookup.has(word)) {
                lookup.set(word, []);
            }
            lookup.get(word).push(i);
        }

        for (let j = newStart; j < newEnd; j += 1) {
            const word = newWords[j];
            if (!lookup.has(word)) {
                continue;
            }
            for (const i of lookup.get(word)) {
                let size = 0;
                while (
                    i + size < oldEnd &&
                    j + size < newEnd &&
                    oldWords[i + size] === newWords[j + size]
                ) {
                    size += 1;
                }
                if (size > bestSize) {
                    bestOldStart = i;
                    bestNewStart = j;
                    bestSize = size;
                }
            }
        }

        return { oldStart: bestOldStart, newStart: bestNewStart, size: bestSize };
    }

    function build(words, start, end, pattern) {
        const result = [];
        const parts = words
            .slice(start, end)
            .filter((word) => word.length > 0)
            .join(' ')
            .split('<br>');

        for (let i = 0; i < parts.length; i += 1) {
            if (i > 0) {
                result.push('<br>');
            }
            if (parts[i].length > 0) {
                result.push(pattern.replace('{{text}}', parts[i]));
            }
        }
        return result;
    }

    function buildDiff(oldStart, oldEnd, newStart, newEnd) {
        const result = [];
        const match = findLongestMatch(oldStart, oldEnd, newStart, newEnd);

        if (match.size > 0) {
            if (oldStart < match.oldStart || newStart < match.newStart) {
                result.push(...buildDiff(oldStart, match.oldStart, newStart, match.newStart));
            }
            result.push(oldWords.slice(match.oldStart, match.oldStart + match.size).join(' '));
            if (match.oldStart + match.size < oldEnd || match.newStart + match.size < newEnd) {
                result.push(...buildDiff(match.oldStart + match.size, oldEnd, match.newStart + match.size, newEnd));
            }
        } else {
            if (oldStart < oldEnd) {
                result.push(...build(oldWords, oldStart, oldEnd, markerDeletion));
            }
            if (newStart < newEnd) {
                result.push(...build(newWords, newStart, newEnd, markerAddition));
            }
        }

        return result;
    }

    return buildDiff(0, oldWords.length, 0, newWords.length)
        .join(' ')
        .replace(/<br>[ ]+<br>/g, '<br><br>')
        .replace(/<br> /g, '<br>');
}

function SortButton({ column, label }) {
    const direction = column.getIsSorted();

    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto justify-start gap-1 px-1 py-0 text-left text-xs font-medium uppercase tracking-wide"
            onClick={() => column.toggleSorting(direction === 'asc')}>
            <span>{label}</span>
            {direction === 'asc' ? (
                <ArrowUpIcon data-icon="inline-end" />
            ) : direction === 'desc' ? (
                <ArrowDownIcon data-icon="inline-end" />
            ) : (
                <ArrowUpDownIcon data-icon="inline-end" />
            )}
        </Button>
    );
}

function AvatarInfoLine({ avatarName, avatarTags, imageUrl, ownerId, userId }) {
    const { t } = useI18n();
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentUserSnapshot = useRuntimeStore((state) => state.auth.currentUserSnapshot);
    const [info, setInfo] = useState(() => ({
        avatarName: typeof avatarName === 'string' ? avatarName.trim() : '',
        ownerId: normalizeId(ownerId),
        status: 'idle'
    }));

    useEffect(() => {
        const hintedName = typeof avatarName === 'string' ? avatarName.trim() : '';
        const hintedOwnerId = normalizeId(ownerId);

        if (!imageUrl) {
            setInfo({
                avatarName: hintedName,
                ownerId: hintedOwnerId,
                status: 'idle'
            });
            return undefined;
        }

        if (hintedName || hintedOwnerId) {
            setInfo({
                avatarName: hintedName,
                ownerId: hintedOwnerId,
                status: 'ready'
            });
            return undefined;
        }

        let active = true;
        setInfo({
            avatarName: '',
            ownerId: '',
            status: 'loading'
        });

        avatarProfileRepository
            .getAvatarNameFromImageUrl(imageUrl, { endpoint: currentEndpoint })
            .then((nextInfo) => {
                if (!active) {
                    return;
                }

                setInfo({
                    avatarName:
                        typeof nextInfo?.avatarName === 'string' ? nextInfo.avatarName.trim() : '',
                    ownerId: normalizeId(nextInfo?.ownerId),
                    status: 'ready'
                });
            })
            .catch(() => {
                if (!active) {
                    return;
                }
                setInfo({
                    avatarName: hintedName,
                    ownerId: hintedOwnerId,
                    status: 'error'
                });
            });

        return () => {
            active = false;
        };
    }, [avatarName, currentEndpoint, imageUrl, ownerId]);

    const normalizedOwnerId = normalizeId(info.ownerId);
    const normalizedUserId = normalizeId(userId);
    const avatarType =
        normalizedOwnerId && normalizedUserId
            ? normalizedOwnerId === normalizedUserId
                ? 'own'
                : 'public'
            : '';
    const label =
        info.status === 'loading'
            ? 'Resolving avatar info...'
            : info.avatarName || t('dialog.user.info.unknown_avatar');

    async function openAvatarAuthorTarget() {
        if (!imageUrl) {
            return;
        }

        if (normalizedUserId && normalizeId(currentUserSnapshot?.id) === normalizedUserId && currentUserSnapshot?.currentAvatar) {
            openAvatarDialog({
                avatarId: currentUserSnapshot.currentAvatar,
                title: currentUserSnapshot.currentAvatarName || currentUserSnapshot.avatarName || info.avatarName || undefined
            });
            return;
        }

        let nextOwnerId = normalizedOwnerId;
        let nextAvatarName = info.avatarName;
        if (!nextOwnerId) {
            try {
                const nextInfo = await avatarProfileRepository.getAvatarNameFromImageUrl(
                    imageUrl,
                    { endpoint: currentEndpoint }
                );
                nextOwnerId = normalizeId(nextInfo?.ownerId);
                nextAvatarName = nextInfo?.avatarName || nextAvatarName;
            } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Failed to resolve avatar author.');
                return;
            }
        }

        try {
            const avatar = await findAvatarByImageUrl({
                imageUrl,
                avatarName: nextAvatarName
            });
            if (avatar?.id) {
                openAvatarDialog({
                    avatarId: avatar.id,
                    title: avatar.name || nextAvatarName || undefined,
                    seedData: avatar
                });
                return;
            }
        } catch {
            // Fall back to the old author/private distinction when the remote avatar index is unavailable.
        }

        if (!nextOwnerId) {
            toast.warning('Avatar author unavailable.');
            return;
        }

        if (nextOwnerId === normalizedUserId) {
            toast.warning('Avatar is private or not found.');
            return;
        }

        openUserDialog({
            userId: nextOwnerId,
            title: nextAvatarName || undefined
        });
    }

    return (
        <div className="flex flex-col gap-0.5">
            <Button
                type="button"
                variant="link"
                className="h-auto w-fit justify-start p-0 text-left font-normal"
                disabled={!imageUrl}
                onClick={() => void openAvatarAuthorTarget()}>
                {label}
                {avatarType === 'own' ? <LockIcon data-icon="inline-end" /> : null}
            </Button>
            {Array.isArray(avatarTags) && avatarTags.length ? (
                <div className="truncate text-xs text-muted-foreground">
                    {avatarTags.map((tag) => String(tag).replace('content_', '')).join(', ')}
                </div>
            ) : null}
        </div>
    );
}

function FeedLocationLink({
    location = '',
    worldName = '',
    groupName = '',
    loadingHistoryKey = '',
    endpoint = '',
    onOpenPreviousInstances,
    onNewInstance,
    disableTooltip = false,
    wrapperClassName = '',
    className = ''
}) {
    const normalizedLocation = normalizeId(location);
    const parsedLocation = parseLocation(normalizedLocation);
    const worldTarget = parsedLocation.worldId || '';

    return (
        <span className={cn('block min-w-0', wrapperClassName)}>
            <Location
                location={normalizedLocation || worldTarget}
                hint={worldName}
                grouphint={groupName}
                endpoint={endpoint}
                enableContextMenu
                showLaunchActions
                disableTooltip={disableTooltip}
                previousInstancesDisabled={!worldTarget || loadingHistoryKey === normalizedLocation}
                onShowPreviousInstances={onOpenPreviousInstances ? (payload) =>
                    onOpenPreviousInstances({
                        ...payload,
                        location: normalizedLocation || payload.location,
                        worldId: worldTarget || payload.worldId,
                        worldName: worldName || payload.worldName,
                        groupName: groupName || payload.groupName
                    }) : undefined
                }
                onNewInstance={onNewInstance ? (payload) =>
                    onNewInstance({
                        ...payload,
                        location: normalizedLocation || payload.location,
                        worldId: worldTarget || payload.worldId,
                        worldName: worldName || payload.worldName
                    }) : undefined
                }
                className={cn('max-w-full text-sm text-muted-foreground', className)}
            />
        </span>
    );
}

function FeedUserLink({
    row,
    friend,
    cachedDisplayName = '',
    endpoint = '',
    currentUserId = '',
    currentUserSnapshot = null,
    canSendInvite = false,
    canBoop = false,
    canUseFriendInstance,
    actions
}) {
    const userId = resolveFeedUserId(row);
    const displayName = resolveFeedUserDisplayName(row, friend, cachedDisplayName);
    const [resolvedDisplayName, setResolvedDisplayName] = useState(displayName);
    const location = resolvePresenceLocation(friend);
    const parsedLocation = parseLocation(location);
    const worldTarget = parsedLocation.worldId || '';
    const worldDialogTarget = parsedLocation.isRealInstance && parsedLocation.tag ? parsedLocation.tag : worldTarget;
    const groupTarget = parsedLocation.groupId || '';
    const isCurrentUser = Boolean(userId && userId === normalizeId(currentUserId));
    const canRequestInvite = canRequestInviteFromFeedFriend(friend, currentUserSnapshot);
    const canUseFriendLocation = Boolean(
        !isCurrentUser &&
        parsedLocation.isRealInstance &&
        parsedLocation.worldId &&
        parsedLocation.instanceId &&
        canUseFriendInstance?.(location)
    );

    useEffect(() => {
        let active = true;
        setResolvedDisplayName(displayName);
        if (!userId || displayName !== UNKNOWN_FEED_USER_DISPLAY_NAME) {
            return () => {
                active = false;
            };
        }

        userProfileRepository
            .getUserProfile({ userId, endpoint })
            .then((profile) => {
                if (!active) {
                    return;
                }
                const nextName = resolveDisplayNameCandidate(profile?.displayName || profile?.username || profile?.name, userId);
                setResolvedDisplayName(nextName || UNKNOWN_FEED_USER_DISPLAY_NAME);
            })
            .catch(() => {
                if (active) {
                    setResolvedDisplayName(UNKNOWN_FEED_USER_DISPLAY_NAME);
                }
            });

        return () => {
            active = false;
        };
    }, [displayName, endpoint, userId]);

    const userLabel = resolvedDisplayName || displayName || UNKNOWN_FEED_USER_DISPLAY_NAME;

    const trigger = (
        <div className="flex min-w-0 flex-col gap-0.5">
            <Button
                type="button"
                variant="link"
                className="h-auto justify-start p-0 text-left font-medium"
                disabled={!userId}
                onClick={() =>
                    openUserDialog({
                        userId,
                        title: userLabel
                    })
                }>
                <span className="truncate">{userLabel}</span>
            </Button>
        </div>
    );

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <span className="block min-w-0">{trigger}</span>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
                <ContextMenuItem
                    disabled={!userId}
                    onSelect={() =>
                        openUserDialog({
                            userId,
                            title: userLabel
                        })
                    }>
                    <ExternalLinkIcon className="size-4" />
                    Open user
                </ContextMenuItem>
                <ContextMenuItem
                    disabled={!worldTarget}
                    onSelect={() =>
                        openWorldDialog({
                            worldId: worldDialogTarget,
                            title: friend?.worldName || worldTarget
                        })
                    }>
                    <ExternalLinkIcon className="size-4" />
                    Open current location
                </ContextMenuItem>
                <ContextMenuItem
                    disabled={!groupTarget}
                    onSelect={() =>
                        openGroupDialog({
                            groupId: groupTarget,
                            title: undefined
                        })
                    }>
                    <ExternalLinkIcon className="size-4" />
                    Open group
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                    disabled={!canUseFriendLocation}
                    onSelect={() => void actions?.launchLocation(location)}>
                    <ExternalLinkIcon className="size-4" />
                    Launch in VRChat
                </ContextMenuItem>
                <ContextMenuItem
                    disabled={!canUseFriendLocation}
                    onSelect={() => void actions?.selfInviteLocation(location)}>
                    <ExternalLinkIcon className="size-4" />
                    Self invite
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                    disabled={isCurrentUser || !canSendInvite}
                    onSelect={() => void actions?.sendInvite(friend || row)}>
                    <ExternalLinkIcon className="size-4" />
                    Send invite
                </ContextMenuItem>
                <ContextMenuItem
                    disabled={isCurrentUser || !canRequestInvite}
                    onSelect={() => void actions?.requestInvite(friend || row)}>
                    <ExternalLinkIcon className="size-4" />
                    Request invite
                </ContextMenuItem>
                <ContextMenuItem
                    disabled={isCurrentUser || !canBoop}
                    onSelect={() => void actions?.sendBoop(friend || row)}>
                    <ExternalLinkIcon className="size-4" />
                    Send boop
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem disabled={!userId} onSelect={() => void copyFeedText(userId, 'User ID')}>
                    <CopyIcon className="size-4" />
                    Copy user ID
                </ContextMenuItem>
                <ContextMenuItem disabled={!displayName} onSelect={() => void copyFeedText(displayName, 'Display name')}>
                    <CopyIcon className="size-4" />
                    Copy display name
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}

function FeedDetailCell({ row, loadingHistoryKey, endpoint = '', onOpenPreviousInstances, onNewInstance }) {
    const type = row?.type;

    if (type === 'GPS' || type === 'Online' || type === 'Offline') {
        return (
            <FeedLocationLink
                location={row?.location}
                worldName={row?.worldName}
                groupName={row?.groupName}
                loadingHistoryKey={loadingHistoryKey}
                endpoint={endpoint}
                onOpenPreviousInstances={onOpenPreviousInstances}
                onNewInstance={onNewInstance}
                disableTooltip
            />
        );
    }

    if (type === 'Status') {
        if (row?.statusDescription === row?.previousStatusDescription) {
            return (
                <div className="flex min-w-0 items-center gap-2 text-sm">
                    <FeedStatusBadge status={row?.previousStatus} />
                    <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
                    <FeedStatusBadge status={row?.status} />
                </div>
            );
        }

        return (
            <div className="flex min-w-0 items-center gap-2">
                <FeedStatusBadge status={row?.status} />
                <span className="block w-full min-w-0 truncate">{row?.statusDescription || ''}</span>
            </div>
        );
    }

    if (type === 'Avatar') {
        return (
            <div className="w-full min-w-0 truncate">
                <AvatarInfoLine
                    imageUrl={row?.currentAvatarImageUrl}
                    userId={row?.userId}
                    ownerId={row?.ownerId}
                    avatarName={row?.avatarName}
                    avatarTags={row?.currentAvatarTags}
                />
            </div>
        );
    }

    if (type === 'Bio') {
        return <span className="block w-full min-w-0 truncate">{row?.bio || ''}</span>;
    }

    return row?.message ? <span className="block w-full min-w-0 truncate">{row.message}</span> : null;
}

function FeedExpandedRow({
    row,
    loadingHistoryKey,
    endpoint = '',
    onOpenPreviousInstances,
    onNewInstance,
    onPreviewImage
}) {
    if (row?.type === 'GPS') {
        return (
            <div className="pl-5 text-sm">
                {row.previousLocation ? (
                    <>
                        <FeedLocationLink
                            location={row.previousLocation}
                            worldName={row.previousWorldName}
                            groupName={row.previousGroupName}
                            loadingHistoryKey={loadingHistoryKey}
                            endpoint={endpoint}
                            onOpenPreviousInstances={onOpenPreviousInstances}
                            onNewInstance={onNewInstance}
                            disableTooltip
                            wrapperClassName="inline-block align-middle"
                        />
                        {row.time ? (
                            <Badge variant="secondary" className="ml-1 w-fit">
                                {timeToText(row.time)}
                            </Badge>
                        ) : null}
                        <br />
                        <span className="inline-flex">
                            <ArrowDownIcon className="size-4" />
                        </span>
                    </>
                ) : null}
                {row.location ? (
                    <FeedLocationLink
                        location={row.location}
                        worldName={row.worldName}
                        groupName={row.groupName}
                        loadingHistoryKey={loadingHistoryKey}
                        endpoint={endpoint}
                        onOpenPreviousInstances={onOpenPreviousInstances}
                        onNewInstance={onNewInstance}
                        disableTooltip
                    />
                ) : null}
            </div>
        );
    }

    if (row?.type === 'Offline') {
        return row.location ? (
            <div className="pl-5 text-sm">
                <FeedLocationLink
                    location={row.location}
                    worldName={row.worldName}
                    groupName={row.groupName}
                    loadingHistoryKey={loadingHistoryKey}
                    endpoint={endpoint}
                    onOpenPreviousInstances={onOpenPreviousInstances}
                    onNewInstance={onNewInstance}
                    disableTooltip
                    wrapperClassName="inline-block align-middle"
                />
                {row.time ? (
                    <Badge variant="secondary" className="ml-1 w-fit">
                        {timeToText(row.time)}
                    </Badge>
                ) : null}
            </div>
        ) : null;
    }

    if (row?.type === 'Online') {
        return row.location ? (
            <div className="pl-5 text-sm">
                <FeedLocationLink
                    location={row.location}
                    worldName={row.worldName}
                    groupName={row.groupName}
                    loadingHistoryKey={loadingHistoryKey}
                    endpoint={endpoint}
                    onOpenPreviousInstances={onOpenPreviousInstances}
                    onNewInstance={onNewInstance}
                    disableTooltip
                />
            </div>
        ) : null;
    }

    if (row?.type === 'Status') {
        if (row.statusDescription === row.previousStatusDescription) {
            return (
                <div className="flex items-center pl-5 text-sm">
                    <FeedStatusBadge status={row.previousStatus} />
                    <span className="mx-2 inline-flex">
                        <ArrowRightIcon className="size-4" />
                    </span>
                    <FeedStatusBadge status={row.status} />
                </div>
            );
        }

        return (
            <div className="flex items-center pl-5 text-sm">
                <FeedStatusBadge status={row.previousStatus} label={row.previousStatusDescription || ''} />
                <span className="mx-2 inline-flex">
                    <ArrowRightIcon className="size-4" />
                </span>
                <FeedStatusBadge status={row.status} label={row.statusDescription || ''} />
            </div>
        );
    }

    if (row?.type === 'Bio') {
        return (
            <div className="pl-5 text-sm">
                <pre
                    className="whitespace-pre-wrap font-inherit text-xs leading-5"
                    dangerouslySetInnerHTML={{ __html: formatDifferenceHtml(row.previousBio, row.bio) }}
                />
            </div>
        );
    }

    if (row?.type === 'Avatar') {
        const previousImage =
            row.previousCurrentAvatarThumbnailImageUrl || row.previousCurrentAvatarImageUrl || '';
        const currentImage =
            row.currentAvatarThumbnailImageUrl || row.currentAvatarImageUrl || '';

        return (
            <div className="pl-5 text-sm">
                <div className="flex items-center">
                    <div className="inline-block w-40 align-top">
                        {previousImage ? (
                            <>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-auto p-0"
                                    aria-label="Preview previous avatar"
                                    onClick={() => onPreviewImage?.({
                                        url: row.previousCurrentAvatarImageUrl || previousImage,
                                        title: row.previousAvatarName || 'Previous avatar'
                                    })}>
                                    <img
                                        src={previousImage}
                                        alt="Previous avatar"
                                        className="h-30 w-40 rounded object-cover"
                                        loading="lazy"
                                    />
                                </Button>
                                <br />
                                <AvatarInfoLine
                                    imageUrl={previousImage}
                                    userId={row.userId}
                                    ownerId={row.previousOwnerId}
                                    avatarName={row.previousAvatarName}
                                    avatarTags={row.previousCurrentAvatarTags}
                                />
                            </>
                        ) : null}
                    </div>
                    <span className="mx-2 inline-flex">
                        <ArrowRightIcon className="size-4" />
                    </span>
                    <div className="inline-block w-40 align-top">
                        {currentImage ? (
                            <>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-auto p-0"
                                    aria-label="Preview current avatar"
                                    onClick={() => onPreviewImage?.({
                                        url: row.currentAvatarImageUrl || currentImage,
                                        title: row.avatarName || 'Current avatar'
                                    })}>
                                    <img
                                        src={currentImage}
                                        alt={row.avatarName || 'Current avatar'}
                                        className="h-30 w-40 rounded object-cover"
                                        loading="lazy"
                                    />
                                </Button>
                                <br />
                                <AvatarInfoLine
                                    imageUrl={currentImage}
                                    userId={row.userId}
                                    ownerId={row.ownerId}
                                    avatarName={row.avatarName}
                                    avatarTags={row.currentAvatarTags}
                                />
                            </>
                        ) : null}
                    </div>
                </div>
            </div>
        );
    }

    return null;
}

export function FeedPage({ embedded = false } = {}) {
    const { t } = useI18n();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentUserSnapshot = useRuntimeStore((state) => state.auth.currentUserSnapshot);
    const gameState = useRuntimeStore((state) => state.gameState);
    const isFavoritesLoaded = useSessionStore((state) => state.isFavoritesLoaded);
    const remoteFavoritesById = useFavoriteStore((state) => state.remoteFavoritesById);
    const localFriendFavorites = useFavoriteStore((state) => state.localFriendFavorites);
    const liveFeedEntries = useFeedLiveStore((state) => state.entries);
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const friendRosterLastLoadedAt = useFriendRosterStore((state) => state.lastLoadedAt);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const preferencesHydrated = usePreferencesStore((state) => state.preferencesHydrated);
    const tablePageSizesPreference = usePreferencesStore((state) => state.tablePageSizes);
    const maxFeedRows = usePreferencesStore((state) => state.tableLimits.maxTableSize);
    const favoriteGroupFilterIds = usePreferencesStore((state) => state.localFavoriteFriendsGroups);

    const persistedState = useMemo(() => readPersistedState(), []);
    const persistedPageSize = Number.parseInt(persistedState.pageSize, 10);
    const initialPageSizes = useMemo(
        () => sanitizePageSizes([...DEFAULT_PAGE_SIZES, persistedPageSize]),
        [persistedPageSize]
    );
    const requestIdRef = useRef(0);
    const hasWrittenPageSizeRef = useRef(false);
    const lastLiveFeedSequenceRef = useRef(0);
    const [searchDraft, setSearchDraft] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [dateDraftFrom, setDateDraftFrom] = useState('');
    const [dateDraftTo, setDateDraftTo] = useState('');
    const [dateFilterOpen, setDateFilterOpen] = useState(false);
    const [activeFilters, setActiveFilters] = useState([]);
    const [favoritesOnly, setFavoritesOnly] = useState(false);
    const [rows, setRows] = useState([]);
    const [friendLogNamesById, setFriendLogNamesById] = useState({});
    const [loadStatus, setLoadStatus] = useState('idle');
    const [preferencesReady, setPreferencesReady] = useState(false);
    const [expanded, setExpanded] = useState({});
    const [pageSizes, setPageSizes] = useState(initialPageSizes);
    const [previousInstancesOpen, setPreviousInstancesOpen] = useState(false);
    const [previousInstancesRows, setPreviousInstancesRows] = useState([]);
    const [previousInstancesTitle, setPreviousInstancesTitle] = useState('Previous Instances');
    const [loadingPreviousInstancesKey, setLoadingPreviousInstancesKey] = useState('');
    const [sorting, setSorting] = useState(() => sanitizeSorting(persistedState.sorting));
    const [columnVisibility, setColumnVisibility] = useState(() =>
        sanitizeColumnVisibility(persistedState.columnVisibility)
    );
    const [columnOrder, setColumnOrder] = useState(() =>
        sanitizeColumnOrder(persistedState.columnOrder)
    );
    const [columnSizing, setColumnSizing] = useState(() =>
        sanitizeColumnSizing(persistedState.columnSizing)
    );
    const [columnOrderLocked, setColumnOrderLocked] = useState(
        () => persistedState.columnOrderLocked === true
    );
    const [pagination, setPagination] = useState({
        pageIndex: 0,
        pageSize: resolvePageSize(persistedState.pageSize, initialPageSizes)
    });
    const deferredSearchQuery = useDeferredValue(searchQuery);

    const favoriteIdSet = useMemo(
        () => buildFavoriteIdSet(remoteFavoritesById, localFriendFavorites, favoriteGroupFilterIds),
        [favoriteGroupFilterIds, localFriendFavorites, remoteFavoritesById]
    );
    const friendsMap = useMemo(() => new Map(Object.entries(friendsById || {})), [friendsById]);
    const dateDraftRange = useMemo(() => {
        const from = parseDateInput(dateDraftFrom);
        const to = parseDateInput(dateDraftTo);
        return from || to ? { from, to } : undefined;
    }, [dateDraftFrom, dateDraftTo]);
    const todayDate = useMemo(() => new Date(), []);
    const currentInviteLocation = useMemo(
        () => resolveCurrentInviteLocation(gameState, currentUserSnapshot),
        [gameState, currentUserSnapshot]
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
    const canSendInviteFromFeed = Boolean(gameState?.isGameRunning && currentInviteLocation && canInviteFromCurrentLocation);
    const canBoopFromFeed = Boolean(currentUserSnapshot?.isBoopingEnabled);
    const activeFilterCount = dateFrom || dateTo ? 1 : 0;

    function setFeedFilters(nextFilters) {
        const nextUniqueFilters = [...new Set((Array.isArray(nextFilters) ? nextFilters : []).filter((filter) => FEED_FILTER_TYPES.includes(filter)))];
        setActiveFilters(nextUniqueFilters.length === FEED_FILTER_TYPES.length ? [] : nextUniqueFilters);
    }

    function toggleFeedFilter(filter) {
        setActiveFilters((current) => {
            const nextFilters = current.includes(filter)
                ? current.filter((entry) => entry !== filter)
                : [...current, filter];
            return nextFilters.length === FEED_FILTER_TYPES.length ? [] : nextFilters;
        });
    }

    function commitSearch(nextValue = searchDraft) {
        setSearchQuery(nextValue);
    }

    function clearSearch() {
        setSearchDraft('');
        setSearchQuery('');
    }

    function applyDateFilter() {
        if (dateDraftFrom && dateDraftTo && dateDraftFrom > dateDraftTo) {
            setDateFrom(dateDraftTo);
            setDateTo(dateDraftFrom);
        } else {
            setDateFrom(dateDraftFrom);
            setDateTo(dateDraftTo);
        }
        setDateFilterOpen(false);
    }

    function clearDateFilter() {
        setDateDraftFrom('');
        setDateDraftTo('');
        setDateFrom('');
        setDateTo('');
        setDateFilterOpen(false);
    }

    async function openPreviousInstancesForLocation({
        location = '',
        worldId = '',
        worldName = '',
        groupName = ''
    } = {}) {
        const normalizedLocation = normalizeId(location);
        const normalizedWorldId = normalizeId(worldId) || parseLocation(normalizedLocation).worldId;
        if (!normalizedWorldId || loadingPreviousInstancesKey) {
            return;
        }

        setLoadingPreviousInstancesKey(normalizedLocation || normalizedWorldId);
        try {
            const instances = await gameLogRepository.getPreviousInstancesByWorldId({
                worldId: normalizedWorldId
            });
            const sortedInstances = [...instances].sort((left, right) => {
                if (normalizedLocation) {
                    if (normalizeId(left?.location) === normalizedLocation) {
                        return -1;
                    }
                    if (normalizeId(right?.location) === normalizedLocation) {
                        return 1;
                    }
                }
                return Date.parse(right?.created_at || right?.createdAt || 0) - Date.parse(left?.created_at || left?.createdAt || 0);
            });
            setPreviousInstancesRows(sortedInstances);
            setPreviousInstancesTitle(
                [worldName || 'World', groupName].filter(Boolean).join(' / ') || 'Previous Instances'
            );
            setPreviousInstancesOpen(true);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to load previous instances.');
        } finally {
            setLoadingPreviousInstancesKey('');
        }
    }

    function canUseFeedFriendLocation(location) {
        const parsedLocation = parseLocation(location);
        if (!parsedLocation.isRealInstance || !parsedLocation.worldId || !parsedLocation.instanceId) {
            return false;
        }

        return checkCanInviteSelf(location, {
            currentUserId,
            cachedInstances: new Map(),
            friends: friendsMap
        });
    }

    async function launchFeedFriendLocation(location) {
        const parsedLocation = parseLocation(location);
        if (!parsedLocation.isRealInstance || !parsedLocation.worldId || !parsedLocation.instanceId) {
            return;
        }

        try {
            const opened = await tryOpenLaunchLocation(location, parsedLocation.shortName || '', currentEndpoint);
            if (opened) {
                toast.success('VRChat launch request sent.');
                return;
            }
            toast.error('Unable to open this instance in VRChat.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to launch instance.');
        }
    }

    async function selfInviteFeedFriendLocation(location) {
        const parsedLocation = parseLocation(location);
        if (!parsedLocation.isRealInstance || !parsedLocation.worldId || !parsedLocation.instanceId) {
            return;
        }

        try {
            await selfInviteToInstance(location, parsedLocation.shortName || '', currentEndpoint);
            toast.success('Self invite sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to send self invite.');
        }
    }

    async function sendFeedFriendInvite(friend) {
        const friendId = normalizeId(friend?.id || friend?.userId);
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
            description: friend?.displayName || 'this user',
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
            toast.success('Invite sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to send invite.');
        }
    }

    async function requestFeedFriendInvite(friend) {
        const friendId = normalizeId(friend?.id || friend?.userId);
        if (!friendId || friendId === normalizeId(currentUserId)) {
            return;
        }
        if (!canRequestInviteFromFeedFriend(friend, currentUserSnapshot)) {
            toast.error('Cannot request invite: friend is not online.');
            return;
        }

        const result = await confirm({
            title: 'Request invite?',
            description: friend?.displayName || 'this user',
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
            toast.success('Invite request sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to request invite.');
        }
    }

    async function sendFeedFriendBoop(friend) {
        const friendId = normalizeId(friend?.id || friend?.userId);
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

    function openFeedNewInstance({
        location = '',
        worldId = '',
        worldName = '',
        selfInvite = false
    } = {}) {
        const target = normalizeId(worldId) || parseLocation(location).worldId || normalizeId(location);
        if (!target) {
            return;
        }

        openWorldDialog({
            worldId: target,
            title: worldName || target,
            initialAction: selfInvite ? 'newInstanceSelfInvite' : 'newInstance'
        });
    }

    useEffect(() => {
        lastLiveFeedSequenceRef.current = useFeedLiveStore.getState().version;
    }, [currentUserId]);

    useEffect(() => {
        let active = true;
        const normalizedCurrentUserId = normalizeId(currentUserId);
        if (!normalizedCurrentUserId) {
            setFriendLogNamesById({});
            return () => {
                active = false;
            };
        }

        friendLogRepository
            .getFriendLogCurrent(normalizedCurrentUserId)
            .then((entries) => {
                if (!active) {
                    return;
                }
                const nextNamesById = {};
                for (const entry of Array.isArray(entries) ? entries : []) {
                    const userId = normalizeId(entry?.userId);
                    const displayName = resolveDisplayNameCandidate(entry?.displayName, userId);
                    if (userId && displayName) {
                        nextNamesById[userId] = displayName;
                    }
                }
                setFriendLogNamesById(nextNamesById);
            })
            .catch(() => {
                if (active) {
                    setFriendLogNamesById({});
                }
            });

        return () => {
            active = false;
        };
    }, [currentUserId, friendRosterLastLoadedAt]);

    useEffect(() => {
        const missingUserIds = [];
        const seenUserIds = new Set();

        for (const row of rows) {
            const userId = resolveFeedUserId(row);
            if (!userId || friendLogNamesById[userId] || seenUserIds.has(userId)) {
                continue;
            }

            if (resolveDisplayNameCandidate(row?.displayName, userId)) {
                continue;
            }

            seenUserIds.add(userId);
            missingUserIds.push(userId);
            if (missingUserIds.length >= 100) {
                break;
            }
        }

        if (missingUserIds.length === 0) {
            return undefined;
        }

        let active = true;
        gameLogRepository
            .getAllUserStats({ userIds: missingUserIds })
            .then((statsRows) => {
                if (!active) {
                    return;
                }

                setFriendLogNamesById((current) => {
                    let changed = false;
                    const nextNamesById = { ...current };
                    for (const row of Array.isArray(statsRows) ? statsRows : []) {
                        const userId = normalizeId(row?.userId);
                        const displayName = resolveDisplayNameCandidate(row?.displayName, userId);
                        if (userId && displayName && !nextNamesById[userId]) {
                            nextNamesById[userId] = displayName;
                            changed = true;
                        }
                    }
                    return changed ? nextNamesById : current;
                });
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, [friendLogNamesById, rows]);

    useEffect(() => {
        if (dateFilterOpen) {
            setDateDraftFrom(dateFrom);
            setDateDraftTo(dateTo);
        }
    }, [dateFilterOpen, dateFrom, dateTo]);

    useEffect(() => {
        let active = true;

        Promise.all([
            configRepository.getString('feedTableFilters', '[]'),
            configRepository.getBool('VRCX_feedTableVIPFilter', false),
            getTablePageSizesPreference(DEFAULT_PAGE_SIZES),
            configRepository.getInt('tablePageSize', DEFAULT_PAGE_SIZES[1])
        ])
            .then(([savedFilters, savedVip, savedPageSizes, savedPageSize]) => {
                if (!active) {
                    return;
                }

                const parsedFilters = safeJsonParse(savedFilters);
                const nextPageSizes = sanitizePageSizes(
                    savedPageSizes
                );
                const resolvedSavedPageSize = resolvePageSize(savedPageSize, nextPageSizes);
                const resolvedActivePageSize = Number.isFinite(persistedPageSize)
                    ? resolvePageSize(persistedPageSize, nextPageSizes, resolvedSavedPageSize)
                    : resolvedSavedPageSize;
                setFeedFilters(
                    Array.isArray(parsedFilters)
                        ? parsedFilters.filter((filter) => FEED_FILTER_TYPES.includes(filter))
                        : []
                );
                setFavoritesOnly(Boolean(savedVip));
                setPageSizes(nextPageSizes);
                setPagination((current) => ({
                    ...current,
                    pageSize: resolvedActivePageSize
                }));
                setPreferencesReady(true);
            })
            .catch(() => {
                if (!active) {
                    return;
                }
                setPreferencesReady(true);
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!preferencesHydrated) {
            return;
        }
        const nextPageSizes = sanitizePageSizes(tablePageSizesPreference);
        setPageSizes(nextPageSizes);
        setPagination((current) => ({
            ...current,
            pageIndex: 0,
            pageSize: resolvePageSize(current.pageSize, nextPageSizes)
        }));
    }, [preferencesHydrated, tablePageSizesPreference]);

    useEffect(() => {
        if (!preferencesReady) {
            return;
        }

        void configRepository.setString('VRCX_feedTableFilters', JSON.stringify(activeFilters));
    }, [activeFilters, preferencesReady]);

    useEffect(() => {
        if (!preferencesReady) {
            return;
        }

        void configRepository.setBool('VRCX_feedTableVIPFilter', favoritesOnly);
    }, [favoritesOnly, preferencesReady]);

    useEffect(() => {
        writePersistedState({
            sorting: sanitizeSorting(sorting)
        });
    }, [sorting]);

    useEffect(() => {
        if (!hasWrittenPageSizeRef.current) {
            hasWrittenPageSizeRef.current = true;
            return;
        }

        writePersistedState({
            pageSize: pagination.pageSize
        });
    }, [pagination.pageSize]);

    useEffect(() => {
        writePersistedState({
            columnVisibility: sanitizeColumnVisibility(columnVisibility)
        });
    }, [columnVisibility]);

    useEffect(() => {
        writePersistedState({
            columnOrder: sanitizeColumnOrder(columnOrder),
            columnSizing: sanitizeColumnSizing(columnSizing),
            columnOrderLocked
        });
    }, [columnOrder, columnOrderLocked, columnSizing]);

    useEffect(() => {
        setPagination((current) => ({
            ...current,
            pageIndex: 0
        }));
    }, [activeFilters, dateFrom, dateTo, deferredSearchQuery, favoritesOnly]);

    useEffect(() => {
        if (!preferencesReady) {
            return;
        }

        if (!currentUserId) {
            requestIdRef.current += 1;
            setRows([]);
            setLoadStatus('idle');
            return;
        }

        if (favoritesOnly && !isFavoritesLoaded) {
            requestIdRef.current += 1;
            setLoadStatus('idle');
            setRows([]);
            return;
        }

        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        const favoriteUserIds = favoritesOnly ? Array.from(favoriteIdSet) : [];
        const liveFeedSequenceAtRequestStart = useFeedLiveStore.getState().version;
        const liveFeedContext = {
            currentUserId,
            activeFilters,
            dateFrom,
            dateTo,
            favoriteIdSet,
            favoritesOnly,
            search: deferredSearchQuery
        };

        setLoadStatus('running');

        feedRepository
            .queryFeed({
                userId: currentUserId,
                search: deferredSearchQuery,
                filters: activeFilters,
                favoriteUserIds,
                dateFrom: toIsoRangeStart(dateFrom),
                dateTo: toIsoRangeEnd(dateTo)
            })
            .then((nextRows) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }

                const liveFeedSnapshot = useFeedLiveStore.getState();
                const { matchingEntries, maxSequence } = collectMatchingLiveFeedEntries(
                    liveFeedSnapshot.entries,
                    liveFeedSequenceAtRequestStart,
                    liveFeedContext
                );
                if (maxSequence > lastLiveFeedSequenceRef.current) {
                    lastLiveFeedSequenceRef.current = maxSequence;
                }

                setRows(mergeLiveFeedEntries(nextRows, matchingEntries, maxFeedRows));
                setLoadStatus('ready');
            })
            .catch((error) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }

                setRows([]);
                setLoadStatus('error');
                console.error(error);
            });
    }, [
        activeFilters,
        currentUserId,
        dateFrom,
        dateTo,
        deferredSearchQuery,
        favoriteIdSet,
        favoritesOnly,
        isFavoritesLoaded,
        maxFeedRows,
        preferencesReady
    ]);

    useEffect(() => {
        if (!preferencesReady || !currentUserId || liveFeedEntries.length === 0) {
            return;
        }
        const { matchingEntries, maxSequence } = collectMatchingLiveFeedEntries(
            liveFeedEntries,
            lastLiveFeedSequenceRef.current,
            {
                currentUserId,
                activeFilters,
                dateFrom,
                dateTo,
                favoriteIdSet,
                favoritesOnly,
                search: deferredSearchQuery
            }
        );
        if (maxSequence > lastLiveFeedSequenceRef.current) {
            lastLiveFeedSequenceRef.current = maxSequence;
        }
        if (!matchingEntries.length) {
            return;
        }
        setRows((current) => mergeLiveFeedEntries(current, matchingEntries, maxFeedRows));
    }, [
        activeFilters,
        currentUserId,
        dateFrom,
        dateTo,
        deferredSearchQuery,
        favoriteIdSet,
        favoritesOnly,
        liveFeedEntries,
        maxFeedRows,
        preferencesReady
    ]);

    useEffect(() => {
        const maxPageIndex = Math.max(0, Math.ceil(rows.length / pagination.pageSize) - 1);
        if (pagination.pageIndex > maxPageIndex) {
            setPagination((current) => ({
                ...current,
                pageIndex: maxPageIndex
            }));
        }
    }, [pagination.pageIndex, pagination.pageSize, rows.length]);

    const columns = useMemo(
        () => [
            {
                id: 'expander',
                size: 20,
                enableSorting: false,
                enableHiding: false,
                meta: { label: '' },
                header: () => null,
                cell: ({ row }) =>
                    row.getCanExpand() ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => row.toggleExpanded()}>
                            {row.getIsExpanded() ? (
                                <ChevronDownIcon data-icon="icon" />
                            ) : (
                                <ChevronRightIcon data-icon="icon" />
                            )}
                        </Button>
                    ) : null
            },
            {
                id: 'created_at',
                accessorFn: (row) => new Date(row?.created_at || 0).valueOf() || 0,
                meta: { label: t('table.feed.date') },
                header: ({ column }) => <SortButton column={column} label={t('table.feed.date')} />,
                cell: ({ row }) => (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span className="text-sm text-muted-foreground">
                                {formatTimestamp(row.original.created_at)}
                            </span>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                            {formatTimestampLong(row.original.created_at)}
                        </TooltipContent>
                    </Tooltip>
                )
            },
            {
                id: 'type',
                accessorFn: (row) => String(row?.type || ''),
                meta: { label: t('table.feed.type') },
                header: ({ column }) => <SortButton column={column} label={t('table.feed.type')} />,
                cell: ({ row }) => {
                    const typeLabel = row.original.type ? t(`view.feed.filters.${row.original.type}`) : '';
                    const parsedLocation = parseLocation(row.original?.location || '');
                    const worldDialogTarget = parsedLocation.isRealInstance && parsedLocation.tag ? parsedLocation.tag : parsedLocation.worldId;
                    if (row.original?.type !== 'Location' && row.original?.location && parsedLocation.worldId) {
                        return (
                            <Button
                                type="button"
                                variant="ghost"
                                className="h-auto p-0"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    openWorldDialog({
                                        worldId: worldDialogTarget,
                                        title: row.original.worldName || parsedLocation.worldId
                                    });
                                }}>
                                <Badge variant="outline">{typeLabel}</Badge>
                            </Button>
                        );
                    }
                    return <Badge variant="outline">{typeLabel}</Badge>;
                }
            },
            {
                id: 'displayName',
                accessorFn: (row) =>
                    resolveFeedUserDisplayName(
                        row,
                        friendsById?.[resolveFeedUserId(row)],
                        friendLogNamesById?.[resolveFeedUserId(row)]
                    ),
                meta: { label: t('table.feed.user') },
                header: ({ column }) => <SortButton column={column} label={t('table.feed.user')} />,
                cell: ({ row }) => (
                    <FeedUserLink
                        row={row.original}
                        friend={friendsById?.[resolveFeedUserId(row.original)]}
                        cachedDisplayName={friendLogNamesById?.[resolveFeedUserId(row.original)]}
                        endpoint={currentEndpoint}
                        currentUserId={currentUserId}
                        currentUserSnapshot={currentUserSnapshot}
                        canSendInvite={canSendInviteFromFeed}
                        canBoop={canBoopFromFeed}
                        canUseFriendInstance={canUseFeedFriendLocation}
                        actions={{
                            launchLocation: launchFeedFriendLocation,
                            selfInviteLocation: selfInviteFeedFriendLocation,
                            sendInvite: sendFeedFriendInvite,
                            requestInvite: requestFeedFriendInvite,
                            sendBoop: sendFeedFriendBoop
                        }}
                    />
                )
            },
            {
                id: 'detail',
                accessorFn: (row) =>
                    [
                        row?.location,
                        row?.worldName,
                        row?.statusDescription,
                        row?.avatarName,
                        row?.bio,
                        row?.message
                ].filter(Boolean).join(' '),
                enableSorting: false,
                meta: { label: t('table.feed.detail') },
                header: () => t('table.feed.detail'),
                minSize: 100,
                cell: ({ row }) => (
                    <FeedDetailCell
                        row={row.original}
                        loadingHistoryKey={loadingPreviousInstancesKey}
                        endpoint={currentEndpoint}
                        onOpenPreviousInstances={openPreviousInstancesForLocation}
                        onNewInstance={openFeedNewInstance}
                    />
                )
            }
        ],
        [
            canBoopFromFeed,
            canInviteFromCurrentLocation,
            canSendInviteFromFeed,
            confirm,
            currentEndpoint,
            currentInviteLocation,
            currentUserId,
            currentUserSnapshot,
            friendsById,
            friendLogNamesById,
            friendsMap,
            loadingPreviousInstancesKey,
            prompt,
            t
        ]
    );

    const table = useReactTable({
        data: rows,
        columns,
        state: {
            expanded,
            columnVisibility,
            columnOrder,
            columnSizing,
            sorting,
            pagination
        },
        onExpandedChange: setExpanded,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnOrderChange: setColumnOrder,
        onColumnSizingChange: setColumnSizing,
        onSortingChange: setSorting,
        onPaginationChange: setPagination,
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        getCoreRowModel: getCoreRowModel(),
        getExpandedRowModel: getExpandedRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getRowId: (row) => getFeedRowId(row),
        getRowCanExpand: () => true,
        meta: {
            columnOrderLocked,
            setColumnOrderLocked
        }
    });

    return (
        <PageScaffold embedded={embedded} className={embedded ? '' : 'feed'}>
            <PageToolbar>
                <PageToolbarRow>
                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                                <Popover open={dateFilterOpen} onOpenChange={setDateFilterOpen}>
                                    <PopoverTrigger asChild>
                                        <Button type="button" variant="outline" size="sm" className="gap-1.5">
                                            <ListFilterIcon data-icon="inline-start" />
                                            {t('view.feed.filter')}
                                            {activeFilterCount ? (
                                                <Badge variant="secondary" className="ml-0.5 h-4.5 min-w-4.5 rounded-full px-1 text-xs">
                                                    {activeFilterCount}
                                                </Badge>
                                            ) : null}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto" align="end">
                                        <Calendar
                                            mode="range"
                                            numberOfMonths={2}
                                            selected={dateDraftRange}
                                            disabled={{ after: todayDate }}
                                            onSelect={(range) => {
                                                setDateDraftFrom(toDateInputValue(range?.from));
                                                setDateDraftTo(toDateInputValue(range?.to));
                                            }}
                                        />
                                        <div className="flex items-center justify-between gap-4 px-3 pb-3">
                                            <div className="min-w-0 text-xs text-muted-foreground">
                                                {[dateDraftFrom || '...', dateDraftTo || '...'].join(' - ')}
                                            </div>
                                            <div className="flex justify-end gap-2">
                                                <Button type="button" variant="outline" size="sm" onClick={clearDateFilter}>
                                                    {t('common.actions.clear')}
                                                </Button>
                                                <Button type="button" size="sm" onClick={applyDateFilter}>
                                                    {t('common.actions.confirm')}
                                                </Button>
                                            </div>
                                        </div>
                                    </PopoverContent>
                                </Popover>
                                <Button
                                    type="button"
                                    variant={favoritesOnly ? 'default' : 'outline'}
                                    size="icon-sm"
                                    title={t('view.feed.favorites_only_tooltip')}
                                    aria-label={t('view.feed.favorites_only_tooltip')}
                                    onClick={() => setFavoritesOnly((current) => !current)}>
                                    <StarIcon data-icon="icon" />
                                </Button>
                            </div>

                            <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant={activeFilters.length === 0 ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setFeedFilters([])}>
                                    {t('view.search.avatar.all')}
                                </Button>
                                {FEED_FILTER_TYPES.map((filter) => {
                                    const active = activeFilters.includes(filter);
                                    return (
                                        <Button
                                            key={filter}
                                            type="button"
                                            variant={active ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={() => toggleFeedFilter(filter)}>
                                            {t(`view.feed.filters.${filter}`)}
                                        </Button>
                                    );
                                })}
                            </div>

                            <div className="relative min-w-64 flex-1">
                                <Input
                                    value={searchDraft}
                                    onChange={(event) => setSearchDraft(event.target.value)}
                                    onBlur={() => commitSearch()}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            commitSearch(event.currentTarget.value);
                                        }
                                    }}
                                    placeholder={t('view.feed.search_placeholder')}
                                    className="h-9 pr-9"
                                />
                                {searchDraft ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label="Clear search"
                                        className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
                                        onClick={clearSearch}>
                                        <XIcon data-icon="icon" />
                                    </Button>
                                ) : null}
                            </div>

                            <div className="flex items-center gap-2">
                                <TableColumnVisibilityMenu table={table} />
                            </div>
                </PageToolbarRow>
            </PageToolbar>

            <PageBody>
                <DataTableSurface>
                    <DataTableScrollArea>
                        <Table className="table-fixed">
                            <DataTableHeader table={table} />
                            <TableBody>
                                {table.getRowModel().rows.length > 0 ? (
                                    table.getRowModel().rows.map((row) => (
                                        <Fragment key={row.id}>
                                            <TableRow>
                                                {row.getVisibleCells().map((cell) => (
                                                    <ResizableTableCell key={cell.id} cell={cell} />
                                                ))}
                                            </TableRow>
                                            {row.getIsExpanded() ? (
                                                <TableRow>
                                                    <TableCell colSpan={row.getVisibleCells().length}>
                                                        <FeedExpandedRow
                                                            row={row.original}
                                                            loadingHistoryKey={loadingPreviousInstancesKey}
                                                            endpoint={currentEndpoint}
                                                            onOpenPreviousInstances={openPreviousInstancesForLocation}
                                                            onNewInstance={openFeedNewInstance}
                                                            onPreviewImage={openImagePreview}
                                                        />
                                                    </TableCell>
                                                </TableRow>
                                            ) : null}
                                        </Fragment>
                                    ))
                                ) : (
                                    <DataTableEmptyRow colSpan={columns.length}>
                                        {loadStatus === 'running' ? (
                                            <span className="inline-flex items-center gap-2">
                                                <Spinner />
                                                Loading feed rows
                                            </span>
                                        ) : favoritesOnly && !isFavoritesLoaded ? (
                                            'Favorites are still hydrating.'
                                        ) : loadStatus === 'error' ? (
                                            'Feed query failed.'
                                        ) : (
                                            'No feed rows match the current filters.'
                                        )}
                                    </DataTableEmptyRow>
                                )}
                            </TableBody>
                        </Table>
                    </DataTableScrollArea>
                </DataTableSurface>

                <PageFooter>
                    <div className="text-sm text-muted-foreground">
                            {rows.length} rows
                            {favoritesOnly ? ' · Favorites only' : ''}
                    </div>
                    <DataTablePagination
                        table={table}
                        pageIndex={table.getState().pagination.pageIndex}
                        pageCount={table.getPageCount() || 1}
                        pageSize={pagination.pageSize}
                        pageSizes={pageSizes}
                        pageSizeLabel={t('table.pagination.rows_per_page')}
                        onPageSizeChange={(value) =>
                            setPagination({
                                pageIndex: 0,
                                pageSize: resolvePageSize(value, pageSizes, pagination.pageSize)
                            })
                        }
                    />
                </PageFooter>
            </PageBody>
            <PreviousInstancesTableDialog
                open={previousInstancesOpen}
                onOpenChange={setPreviousInstancesOpen}
                title={previousInstancesTitle}
                instances={previousInstancesRows}
                onRowsChange={setPreviousInstancesRows}
            />
        </PageScaffold>
    );
}
