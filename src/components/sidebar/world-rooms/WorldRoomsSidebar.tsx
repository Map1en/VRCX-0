import { useQuery } from '@tanstack/react-query';
import { ExternalLinkIcon, UserIcon, UsersRoundIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { CurrentInstanceBadge } from '@/components/instances/CurrentInstanceBadge';
import { InstanceVisitedBadge } from '@/components/instances/InstanceVisitedBadge';
import { LaunchModeContextMenuGroup } from '@/components/launch/LaunchModeContextMenuGroup';
import { RegionCodeBadge } from '@/components/location/RegionCodeBadge';
import { useInstancePopulation } from '@/components/location/useInstancePopulation';
import { FadeInImage } from '@/components/media/FadeInImage';
import { normalizeSidebarFilterQuery } from '@/components/sidebar/friends-sidebar/friendsSidebarModel';
import { handleSidebarRowArrowNavigation } from '@/components/sidebar/sidebarRowArrowNavigation';
import { useVirtualSidebarRows } from '@/components/sidebar/useVirtualSidebarRows';
import type { FriendRecord } from '@/domain/friends/types';
import { groupProfileQueryOptions } from '@/lib/groupProfileQuery';
import { openGroupDialog, openWorldDialog } from '@/services/dialogService';
import {
    convertFileUrlToImageUrl,
    userImage
} from '@/services/entityMediaService';
import { selfInviteToInstance } from '@/services/launchService';
import { toast } from '@/services/toastService';
import { accessTypeLocaleKeyMap } from '@/shared/constants/accessType';
import { checkCanInviteSelf } from '@/shared/utils/invite';
import { parseLocation, translateAccessType } from '@/shared/utils/location';
import type { SidebarWorldRoomsTabLayoutItem } from '@/shared/utils/sidebarTabLayout';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { useWorldRooms } from './useWorldRooms';
import { WorldRoomsCover } from './WorldRoomsCover';
import { filterWorldRoomRows, type WorldRoomRow } from './worldRoomsModel';

type WorldRoomsSidebarRow =
    | { type: 'room'; key: string; room: WorldRoomRow }
    | { type: 'message'; key: string; text: string }
    | { type: 'skeleton'; key: string }
    | { type: 'footer'; key: string };

function estimateWorldRoomsRowSize(row: WorldRoomsSidebarRow) {
    switch (row?.type) {
        case 'message':
        case 'skeleton':
            return 64;
        case 'footer':
            return 16;
        default:
            return 50;
    }
}

function RoomFriends({ friends }: { friends: FriendRecord[] }) {
    if (!friends.length) {
        return null;
    }
    const names = friends.map((friend) => friend.displayName).join(', ');
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <span
                        role="group"
                        aria-label={names}
                        className="ml-auto flex shrink-0 items-center pl-2"
                    />
                }
            >
                <span className="flex -space-x-1.5">
                    {friends.slice(0, 3).map((friend) => {
                        const avatarUrl = userImage(friend);
                        return (
                            <Avatar
                                key={friend.id}
                                className="ring-background size-4 ring-2 after:hidden"
                            >
                                {avatarUrl ? (
                                    <AvatarImage
                                        src={avatarUrl}
                                        alt=""
                                        loading="lazy"
                                    />
                                ) : null}
                                <AvatarFallback>
                                    <UserIcon
                                        aria-hidden="true"
                                        className="size-2.5"
                                    />
                                </AvatarFallback>
                            </Avatar>
                        );
                    })}
                </span>
                {friends.length > 3 ? (
                    <span className="ml-1 text-[11px] tabular-nums">
                        +{friends.length - 3}
                    </span>
                ) : null}
            </TooltipTrigger>
            <TooltipContent>{names}</TooltipContent>
        </Tooltip>
    );
}

function WorldRoomItem({
    room,
    worldName,
    worldCapacity,
    worldSettled,
    refreshKey,
    currentUserId,
    friendsMap
}: {
    room: WorldRoomRow;
    worldName: string;
    worldCapacity: number | null;
    worldSettled: boolean;
    refreshKey: number;
    currentUserId: string | null;
    friendsMap: Map<string, FriendRecord>;
}) {
    const { t } = useTranslation();
    const parsedLocation = parseLocation(room.location);
    const { ref, population } = useInstancePopulation({
        worldId: parsedLocation.worldId,
        instanceId: parsedLocation.instanceId,
        enabled: worldSettled && room.occupants === null,
        refreshKey: `${refreshKey}|${room.friends.length}`
    });
    const groupId = parsedLocation.groupId || '';
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const group = useQuery(groupProfileQueryOptions(groupId, endpoint)).data;
    const groupName = group?.name || '';
    const groupIconUrl = convertFileUrlToImageUrl(group?.iconUrl, 128);
    const showGroupName = Boolean(groupId && groupName);
    const groupIconFallback = (
        <UsersRoundIcon
            aria-hidden="true"
            className="text-muted-foreground size-4"
        />
    );
    const userCount = room.occupants ?? population?.nUsers ?? null;
    const capacity =
        room.occupants === null
            ? population?.capacity || worldCapacity
            : worldCapacity;
    const accessTypeLabel = translateAccessType(
        parsedLocation.accessTypeName,
        t,
        accessTypeLocaleKeyMap
    );
    const canUseInstanceAction = checkCanInviteSelf(room.location, {
        currentUserId: currentUserId || '',
        friends: friendsMap
    });

    function openWorld() {
        openWorldDialog({ worldId: room.location, title: worldName });
    }

    async function sendSelfInvite() {
        if (!canUseInstanceAction) {
            return;
        }
        try {
            await selfInviteToInstance(room.location, parsedLocation.shortName);
            toast.add({
                type: 'success',
                title: t('message.invite.self_sent')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.world_rooms_sidebar.toast.failed_to_send_self_invite'
                          )
            });
        }
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger
                render={
                    <div
                        ref={ref}
                        role="button"
                        tabIndex={0}
                        aria-label={`${showGroupName ? groupName : accessTypeLabel} #${parsedLocation.instanceName}`}
                        className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg p-1.5 hover:bg-(--state-hover-surface)"
                        onClick={openWorld}
                        onKeyDown={(event) => {
                            if (
                                event.target === event.currentTarget &&
                                (event.key === 'Enter' || event.key === ' ')
                            ) {
                                event.preventDefault();
                                openWorld();
                            }
                        }}
                    />
                }
            >
                {groupId ? (
                    <span className="bg-muted flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border">
                        {groupIconUrl ? (
                            <FadeInImage
                                src={groupIconUrl}
                                alt=""
                                loading="lazy"
                                className="size-full object-cover"
                                fallback={groupIconFallback}
                            />
                        ) : (
                            groupIconFallback
                        )}
                    </span>
                ) : (
                    <WorldRoomsCover
                        worldId={parsedLocation.worldId}
                        className="size-9 rounded-md border"
                    />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex min-w-0 items-center gap-1.5 text-sm leading-5">
                        {showGroupName ? (
                            <button
                                type="button"
                                className="hover:text-foreground min-w-0 cursor-pointer truncate text-left font-medium"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    openGroupDialog({
                                        groupId,
                                        title: groupName
                                    });
                                }}
                            >
                                {groupName}
                            </button>
                        ) : (
                            <span className="min-w-0 truncate font-medium">
                                {accessTypeLabel}
                            </span>
                        )}
                        {room.isCurrent ? (
                            <CurrentInstanceBadge className="shrink-0" />
                        ) : (
                            <InstanceVisitedBadge
                                location={room.location}
                                className="shrink-0"
                            />
                        )}
                        <span className="ml-auto shrink-0 pl-2 font-medium tabular-nums">
                            {userCount ?? '?'}/{capacity || '?'}
                        </span>
                    </div>
                    <div className="text-muted-foreground flex min-h-4 min-w-0 items-center text-xs">
                        <RegionCodeBadge region={parsedLocation.region} />
                        {showGroupName ? (
                            <span className="mr-1.5 truncate">
                                {accessTypeLabel}
                            </span>
                        ) : null}
                        <span className="text-muted-foreground/70 shrink-0 tabular-nums">
                            #{parsedLocation.instanceName}
                        </span>
                        <RoomFriends friends={room.friends} />
                    </div>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-max max-w-[calc(100vw-1rem)] min-w-52">
                <ContextMenuGroup>
                    <ContextMenuItem onClick={openWorld}>
                        <ExternalLinkIcon />
                        {t('common.actions.view_details')}
                    </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <LaunchModeContextMenuGroup
                    disabled={!canUseInstanceAction}
                    instanceClosed={false}
                    errorMessage={t(
                        'component.world_rooms_sidebar.toast.failed_to_launch_instance'
                    )}
                    location={room.location}
                    shortName={parsedLocation.shortName}
                />
                <ContextMenuSeparator />
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={!canUseInstanceAction}
                        onClick={() => {
                            sendSelfInvite();
                        }}
                    >
                        {t('dialog.user.info.self_invite_tooltip')}
                    </ContextMenuItem>
                </ContextMenuGroup>
            </ContextMenuContent>
        </ContextMenu>
    );
}

export function WorldRoomsSidebar({
    tab,
    filterQuery = ''
}: {
    tab: SidebarWorldRoomsTabLayoutItem;
    filterQuery?: string;
}) {
    const { t } = useTranslation();
    const filterText = normalizeSidebarFilterQuery(filterQuery);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const { worldQuery, world, rooms, friendsById } = useWorldRooms(
        tab.worldId
    );
    const friendsMap = useMemo(
        () => new Map(Object.entries(friendsById || {})),
        [friendsById]
    );

    const virtualRows = useMemo(() => {
        const visibleRooms = filterWorldRoomRows(rooms, filterText);
        const nextRows: WorldRoomsSidebarRow[] = [];
        for (const room of visibleRooms) {
            nextRows.push({
                type: 'room',
                key: `room:${room.location}`,
                room
            });
        }
        if (!visibleRooms.length) {
            if (filterText) {
                nextRows.push({
                    type: 'message',
                    key: 'message:filter-empty',
                    text: t('side_panel.filter_no_results')
                });
            } else if (worldQuery.isError && !world) {
                nextRows.push({
                    type: 'message',
                    key: 'message:error',
                    text: t('component.world_rooms_sidebar.failed')
                });
            } else if (world) {
                nextRows.push({
                    type: 'message',
                    key: 'message:empty',
                    text: t('component.world_rooms_sidebar.empty')
                });
            } else {
                for (let index = 0; index < 4; index += 1) {
                    nextRows.push({
                        type: 'skeleton',
                        key: `skeleton:${index}`
                    });
                }
            }
        }
        nextRows.push({ type: 'footer', key: 'footer' });
        return nextRows;
    }, [filterText, rooms, t, world, worldQuery.isError]);

    const { getRowRef, viewportRef, virtualItems, totalSize } =
        useVirtualSidebarRows(virtualRows, estimateWorldRoomsRowSize);

    function renderVirtualRow(row: WorldRoomsSidebarRow) {
        switch (row?.type) {
            case 'message':
                return (
                    <div className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
                        {row.text}
                    </div>
                );
            case 'skeleton':
                return (
                    <div className="flex items-center gap-2 rounded-md px-1.5 py-1.5">
                        <Skeleton className="size-8 shrink-0 rounded-md" />
                        <div className="min-w-0 flex-1">
                            <Skeleton className="h-3.5 w-2/3" />
                            <Skeleton className="mt-2 h-3 w-4/5" />
                        </div>
                    </div>
                );
            case 'footer':
                return <div className="h-4" />;
            case 'room':
                return (
                    <WorldRoomItem
                        room={row.room}
                        worldName={world?.name || ''}
                        worldCapacity={world?.capacity || null}
                        worldSettled={!worldQuery.isPending}
                        refreshKey={worldQuery.dataUpdatedAt}
                        currentUserId={currentUserId}
                        friendsMap={friendsMap}
                    />
                );
        }
    }

    return (
        <div
            ref={viewportRef}
            role="presentation"
            className="relative h-full overflow-auto overflow-x-hidden"
            onKeyDown={handleSidebarRowArrowNavigation}
        >
            <div className="px-1.5 pt-1 pb-2.5">
                <div
                    className="relative w-full"
                    style={{ height: `${totalSize}px` }}
                >
                    {virtualItems.map((item) => (
                        <div
                            key={item.key}
                            ref={getRowRef(item.key)}
                            data-sidebar-row=""
                            className="absolute top-0 left-0 w-full"
                            style={{ transform: `translateY(${item.start}px)` }}
                        >
                            {renderVirtualRow(item.row)}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
