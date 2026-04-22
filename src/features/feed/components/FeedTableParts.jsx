import { ArrowDownIcon, ArrowRightIcon, ArrowUpDownIcon, ArrowUpIcon, CopyIcon, ExternalLinkIcon, GlobeIcon, LockIcon, UserIcon, UsersIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { Location } from '@/components/Location.jsx';
import { formatDateFilter, timeToText } from '@/lib/dateTime.js';
import { copyTextToClipboard } from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import avatarProfileRepository from '@/repositories/avatarProfileRepository.js';
import { avatarSearchProviderRepository, localFavoritesRepository, userProfileRepository } from '@/repositories/index.js';
import { openAvatarDialog, openGroupDialog, openUserDialog, openWorldDialog } from '@/services/dialogService.js';
import { appI18n } from '@/services/i18nService.js';
import { extractFileId } from '@/shared/utils/fileUtils.js';
import { parseLocation, resolveFriendPresenceLocation } from '@/shared/utils/location.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/ui/shadcn/context-menu';

import { canRequestInviteFromFeedFriend, normalizeFeedId as normalizeId, resolveDisplayNameCandidate, resolveFeedStatusMeta as resolveStatusMeta, resolveFeedUserDisplayName, resolveFeedUserId, UNKNOWN_FEED_USER_DISPLAY_NAME } from '../feedRows.js';
function resolvePresenceLocation(profile) {
    return resolveFriendPresenceLocation(profile);
}

async function findAvatarByImageUrl({ imageUrl, avatarName }) {
    const fileId = extractFileId(imageUrl);
    const query = normalizeId(avatarName) || fileId;
    if (!fileId || query.length < 3) {
        return null;
    }

    const cachedAvatars = await localFavoritesRepository
        .getAvatarCache()
        .catch(() => []);
    const cachedMatch = cachedAvatars.find(
        (avatar) =>
            avatar?.id &&
            (extractFileId(avatar.imageUrl) === fileId ||
                extractFileId(avatar.thumbnailImageUrl) === fileId)
    );
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

    return (
        response.avatars.find(
            (avatar) =>
                avatar?.id &&
                (extractFileId(avatar.imageUrl) === fileId ||
                    extractFileId(avatar.thumbnailImageUrl) === fileId)
        ) || null
    );
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
    toast.success(appI18n.t('view.feed.generated_dynamic.value_copied', { value: label }));
}

function FeedStatusBadge({ status, label }) {
    const meta = resolveStatusMeta(status);
    return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
            {meta.className ? (
                <span
                    className={cn(
                        'size-2.5 shrink-0 rounded-full',
                        meta.className
                    )}
                />
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

        return {
            oldStart: bestOldStart,
            newStart: bestNewStart,
            size: bestSize
        };
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
                result.push(
                    ...buildDiff(
                        oldStart,
                        match.oldStart,
                        newStart,
                        match.newStart
                    )
                );
            }
            result.push(
                oldWords
                    .slice(match.oldStart, match.oldStart + match.size)
                    .join(' ')
            );
            if (
                match.oldStart + match.size < oldEnd ||
                match.newStart + match.size < newEnd
            ) {
                result.push(
                    ...buildDiff(
                        match.oldStart + match.size,
                        oldEnd,
                        match.newStart + match.size,
                        newEnd
                    )
                );
            }
        } else {
            if (oldStart < oldEnd) {
                result.push(
                    ...build(oldWords, oldStart, oldEnd, markerDeletion)
                );
            }
            if (newStart < newEnd) {
                result.push(
                    ...build(newWords, newStart, newEnd, markerAddition)
                );
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
            className="h-auto justify-start gap-1 px-1 py-0 text-left text-xs font-medium tracking-wide uppercase"
            onClick={() => column.toggleSorting(direction === 'asc')}
        >
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

const avatarInfoLineCache = new Map();

function getAvatarInfoLineCacheKey(imageUrl, endpoint) {
    const normalizedImageUrl = String(imageUrl || '').trim();
    if (!normalizedImageUrl) {
        return '';
    }
    return `${String(endpoint || '').trim()}\n${normalizedImageUrl}`;
}

function normalizeAvatarInfoLineState({
    avatarName = '',
    ownerId = '',
    status = 'idle',
    cacheKey = ''
} = {}) {
    return {
        avatarName: typeof avatarName === 'string' ? avatarName.trim() : '',
        ownerId: normalizeId(ownerId),
        status,
        cacheKey
    };
}

function isSameAvatarInfoLineState(left, right) {
    return (
        left?.avatarName === right?.avatarName &&
        left?.ownerId === right?.ownerId &&
        left?.status === right?.status &&
        left?.cacheKey === right?.cacheKey
    );
}

function setAvatarInfoLineState(setInfo, nextInfo) {
    setInfo((current) =>
        isSameAvatarInfoLineState(current, nextInfo) ? current : nextInfo
    );
}

function resolveInitialAvatarInfoLineState({
    avatarName,
    imageUrl,
    ownerId,
    endpoint
}) {
    const hintedName = typeof avatarName === 'string' ? avatarName.trim() : '';
    const hintedOwnerId = normalizeId(ownerId);
    const cacheKey = getAvatarInfoLineCacheKey(imageUrl, endpoint);

    if (!cacheKey) {
        return normalizeAvatarInfoLineState({
            avatarName: hintedName,
            ownerId: hintedOwnerId,
            status: 'idle'
        });
    }

    if (hintedName || hintedOwnerId) {
        const nextInfo = normalizeAvatarInfoLineState({
            avatarName: hintedName,
            ownerId: hintedOwnerId,
            status: 'ready',
            cacheKey
        });
        avatarInfoLineCache.set(cacheKey, nextInfo);
        return nextInfo;
    }

    const cachedInfo = avatarInfoLineCache.get(cacheKey);
    if (cachedInfo) {
        return cachedInfo;
    }

    return normalizeAvatarInfoLineState({
        status: 'loading',
        cacheKey
    });
}

function avatarTagsEqual(left, right) {
    if (left === right) {
        return true;
    }
    if (!Array.isArray(left) || !Array.isArray(right)) {
        return !left?.length && !right?.length;
    }
    if (left.length !== right.length) {
        return false;
    }
    return left.every((value, index) => value === right[index]);
}

const AvatarInfoLine = memo(function AvatarInfoLine({
    avatarName,
    avatarTags,
    imageUrl,
    ownerId,
    userId
}) {
    const { t } = useI18n();
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const [info, setInfo] = useState(() =>
        resolveInitialAvatarInfoLineState({
            avatarName,
            imageUrl,
            ownerId,
            endpoint: currentEndpoint
        })
    );

    useEffect(() => {
        const hintedName =
            typeof avatarName === 'string' ? avatarName.trim() : '';
        const hintedOwnerId = normalizeId(ownerId);
        const cacheKey = getAvatarInfoLineCacheKey(imageUrl, currentEndpoint);

        if (!cacheKey) {
            setAvatarInfoLineState(setInfo, {
                avatarName: hintedName,
                ownerId: hintedOwnerId,
                status: 'idle',
                cacheKey: ''
            });
            return undefined;
        }

        if (hintedName || hintedOwnerId) {
            const nextInfo = normalizeAvatarInfoLineState({
                avatarName: hintedName,
                ownerId: hintedOwnerId,
                status: 'ready',
                cacheKey
            });
            avatarInfoLineCache.set(cacheKey, nextInfo);
            setAvatarInfoLineState(setInfo, nextInfo);
            return undefined;
        }

        const cachedInfo = avatarInfoLineCache.get(cacheKey);
        if (cachedInfo) {
            setAvatarInfoLineState(setInfo, cachedInfo);
            return undefined;
        }

        let active = true;
        setInfo((current) => {
            if (current.cacheKey === cacheKey && current.status === 'ready') {
                return current;
            }
            const nextInfo = normalizeAvatarInfoLineState({
                status: 'loading',
                cacheKey
            });
            return isSameAvatarInfoLineState(current, nextInfo)
                ? current
                : nextInfo;
        });

        avatarProfileRepository
            .getAvatarNameFromImageUrl(imageUrl, { endpoint: currentEndpoint })
            .then((nextInfo) => {
                if (!active) {
                    return;
                }

                const resolvedInfo = normalizeAvatarInfoLineState({
                    avatarName:
                        typeof nextInfo?.avatarName === 'string'
                            ? nextInfo.avatarName.trim()
                            : '',
                    ownerId: normalizeId(nextInfo?.ownerId),
                    status: 'ready',
                    cacheKey
                });
                avatarInfoLineCache.set(cacheKey, resolvedInfo);
                setAvatarInfoLineState(setInfo, resolvedInfo);
            })
            .catch(() => {
                if (!active) {
                    return;
                }
                setAvatarInfoLineState(setInfo, {
                    avatarName: hintedName,
                    ownerId: hintedOwnerId,
                    status: 'error',
                    cacheKey
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

        if (
            normalizedUserId &&
            normalizeId(currentUserSnapshot?.id) === normalizedUserId &&
            currentUserSnapshot?.currentAvatar
        ) {
            openAvatarDialog({
                avatarId: currentUserSnapshot.currentAvatar,
                title:
                    currentUserSnapshot.currentAvatarName ||
                    currentUserSnapshot.avatarName ||
                    info.avatarName ||
                    undefined
            });
            return;
        }

        let nextOwnerId = normalizedOwnerId;
        let nextAvatarName = info.avatarName;
        if (!nextOwnerId) {
            try {
                const nextInfo =
                    await avatarProfileRepository.getAvatarNameFromImageUrl(
                        imageUrl,
                        { endpoint: currentEndpoint }
                    );
                nextOwnerId = normalizeId(nextInfo?.ownerId);
                nextAvatarName = nextInfo?.avatarName || nextAvatarName;
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : appI18n.t('view.feed.generated_toast.failed_to_resolve_avatar_author')
                );
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
            toast.warning(t('view.feed.generated.avatar_author_unavailable'));
            return;
        }

        if (nextOwnerId === normalizedUserId) {
            toast.warning(t('view.feed.generated.avatar_is_private_or_not_found'));
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
                variant="ghost"
                className="hover:text-primary h-auto w-fit justify-start p-0 text-left font-normal"
                disabled={!imageUrl}
                onClick={() => void openAvatarAuthorTarget()}
            >
                {label}
                {avatarType === 'own' ? (
                    <LockIcon data-icon="inline-end" />
                ) : null}
            </Button>
            {Array.isArray(avatarTags) && avatarTags.length ? (
                <div className="text-muted-foreground truncate text-xs">
                    {avatarTags
                        .map((tag) => String(tag).replace('content_', ''))
                        .join(', ')}
                </div>
            ) : null}
        </div>
    );
}, areAvatarInfoLinePropsEqual);

function areAvatarInfoLinePropsEqual(previousProps, nextProps) {
    return (
        previousProps.avatarName === nextProps.avatarName &&
        previousProps.imageUrl === nextProps.imageUrl &&
        previousProps.ownerId === nextProps.ownerId &&
        previousProps.userId === nextProps.userId &&
        avatarTagsEqual(previousProps.avatarTags, nextProps.avatarTags)
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
                previousInstancesDisabled={
                    !worldTarget || loadingHistoryKey === normalizedLocation
                }
                onShowPreviousInstances={
                    onOpenPreviousInstances
                        ? (payload) =>
                              onOpenPreviousInstances({
                                  ...payload,
                                  location:
                                      normalizedLocation || payload.location,
                                  worldId: worldTarget || payload.worldId,
                                  worldName: worldName || payload.worldName,
                                  groupName: groupName || payload.groupName
                              })
                        : undefined
                }
                onNewInstance={
                    onNewInstance
                        ? (payload) =>
                              onNewInstance({
                                  ...payload,
                                  location:
                                      normalizedLocation || payload.location,
                                  worldId: worldTarget || payload.worldId,
                                  worldName: worldName || payload.worldName
                              })
                        : undefined
                }
                className={cn(
                    'text-muted-foreground max-w-full text-sm',
                    className
                )}
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
    const displayName = resolveFeedUserDisplayName(
        row,
        friend,
        cachedDisplayName
    );
    const [resolvedDisplayName, setResolvedDisplayName] = useState(displayName);
    const location = resolvePresenceLocation(friend);
    const parsedLocation = parseLocation(location);
    const worldTarget = parsedLocation.worldId || '';
    const worldDialogTarget =
        parsedLocation.isRealInstance && parsedLocation.tag
            ? parsedLocation.tag
            : worldTarget;
    const groupTarget = parsedLocation.groupId || '';
    const isCurrentUser = Boolean(
        userId && userId === normalizeId(currentUserId)
    );
    const canRequestInvite = canRequestInviteFromFeedFriend(
        friend,
        currentUserSnapshot
    );
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
                const nextName = resolveDisplayNameCandidate(
                    profile?.displayName || profile?.username || profile?.name,
                    userId
                );
                setResolvedDisplayName(
                    nextName || UNKNOWN_FEED_USER_DISPLAY_NAME
                );
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

    const userLabel =
        resolvedDisplayName || displayName || UNKNOWN_FEED_USER_DISPLAY_NAME;

    const trigger = (
        <div className="flex min-w-0 flex-col gap-0.5">
            <Button
                type="button"
                variant="ghost"
                className="hover:text-primary h-auto max-w-full self-start justify-start text-left font-medium"
                disabled={!userId}
                onClick={() =>
                    openUserDialog({
                        userId,
                        title: userLabel
                    })
                }
            >
                <span className="max-w-full truncate">{userLabel}</span>
            </Button>
        </div>
    );

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <span className="block min-w-0">{trigger}</span>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={!userId}
                        onSelect={() =>
                            openUserDialog({
                                userId,
                                title: userLabel
                            })
                        }
                    >
                        <UserIcon />
                        {appI18n.t('view.feed.generated.open_user')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!worldTarget}
                        onSelect={() =>
                            openWorldDialog({
                                worldId: worldDialogTarget,
                                title: friend?.worldName || worldTarget
                            })
                        }
                    >
                        <GlobeIcon />
                        {appI18n.t('view.feed.generated.open_current_location')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!groupTarget}
                        onSelect={() =>
                            openGroupDialog({
                                groupId: groupTarget,
                                title: undefined
                            })
                        }
                    >
                        <UsersIcon />
                        {appI18n.t('view.feed.generated.open_group')}
                    </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={!canUseFriendLocation}
                        onSelect={() => void actions?.launchLocation(location)}
                    >
                        <ExternalLinkIcon />
                        {appI18n.t('view.feed.generated.launch_in_vrchat')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!canUseFriendLocation}
                        onSelect={() =>
                            void actions?.selfInviteLocation(location)
                        }
                    >
                        <ExternalLinkIcon />
                        {appI18n.t('view.feed.generated.self_invite')}
                    </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={isCurrentUser || !canSendInvite}
                        onSelect={() => void actions?.sendInvite(friend || row)}
                    >
                        <ExternalLinkIcon />
                        {appI18n.t('view.feed.generated.send_invite')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={isCurrentUser || !canRequestInvite}
                        onSelect={() =>
                            void actions?.requestInvite(friend || row)
                        }
                    >
                        <ExternalLinkIcon />
                        {appI18n.t('view.feed.generated.request_invite')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={isCurrentUser || !canBoop}
                        onSelect={() => void actions?.sendBoop(friend || row)}
                    >
                        <ExternalLinkIcon />
                        {appI18n.t('view.feed.generated.send_boop')}
                    </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={!userId}
                        onSelect={() => void copyFeedText(userId, 'User ID')}
                    >
                        <CopyIcon />
                        {appI18n.t('view.feed.generated.copy_user_id')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!displayName}
                        onSelect={() =>
                            void copyFeedText(displayName, 'Display name')
                        }
                    >
                        <CopyIcon />
                        {appI18n.t('view.feed.generated.copy_display_name')}
                    </ContextMenuItem>
                </ContextMenuGroup>
            </ContextMenuContent>
        </ContextMenu>
    );
}

function FeedDetailCell({
    row,
    loadingHistoryKey,
    endpoint = '',
    onOpenPreviousInstances,
    onNewInstance
}) {
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
                    <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" />
                    <FeedStatusBadge status={row?.status} />
                </div>
            );
        }

        return (
            <div className="flex min-w-0 items-center gap-2">
                <FeedStatusBadge status={row?.status} />
                <span className="block w-full min-w-0 truncate">
                    {row?.statusDescription || ''}
                </span>
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
        return (
            <span className="block w-full min-w-0 truncate">
                {row?.bio || ''}
            </span>
        );
    }

    return row?.message ? (
        <span className="block w-full min-w-0 truncate">{row.message}</span>
    ) : null;
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
                <FeedStatusBadge
                    status={row.previousStatus}
                    label={row.previousStatusDescription || ''}
                />
                <span className="mx-2 inline-flex">
                    <ArrowRightIcon className="size-4" />
                </span>
                <FeedStatusBadge
                    status={row.status}
                    label={row.statusDescription || ''}
                />
            </div>
        );
    }

    if (row?.type === 'Bio') {
        return (
            <div className="pl-5 text-sm">
                <pre
                    className="font-inherit text-xs leading-5 whitespace-pre-wrap"
                    dangerouslySetInnerHTML={{
                        __html: formatDifferenceHtml(row.previousBio, row.bio)
                    }}
                />
            </div>
        );
    }

    if (row?.type === 'Avatar') {
        const previousImage =
            row.previousCurrentAvatarThumbnailImageUrl ||
            row.previousCurrentAvatarImageUrl ||
            '';
        const currentImage =
            row.currentAvatarThumbnailImageUrl ||
            row.currentAvatarImageUrl ||
            '';

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
                                    aria-label={"Preview previous avatar"}
                                    onClick={() =>
                                        onPreviewImage?.({
                                            url:
                                                row.previousCurrentAvatarImageUrl ||
                                                previousImage,
                                            title:
                                                row.previousAvatarName ||
                                                'Previous avatar'
                                        })
                                    }
                                >
                                    <img
                                        src={previousImage}
                                        alt={appI18n.t('view.feed.generated.previous_avatar')}
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
                                    aria-label={"Preview current avatar"}
                                    onClick={() =>
                                        onPreviewImage?.({
                                            url:
                                                row.currentAvatarImageUrl ||
                                                currentImage,
                                            title:
                                                row.avatarName ||
                                                'Current avatar'
                                        })
                                    }
                                >
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
export {
    FeedDetailCell,
    FeedExpandedRow,
    FeedUserLink,
    SortButton,
    formatTimestamp,
    formatTimestampLong
};
