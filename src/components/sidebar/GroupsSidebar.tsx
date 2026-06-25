import { ChevronDownIcon, UsersIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Location } from '@/components/Location';
import { useVirtualSidebarRows } from '@/components/sidebar/useVirtualSidebarRows';
import { cn } from '@/lib/utils';
import { openGroupDialog } from '@/services/dialogService';
import { tryOpenLaunchLocation } from '@/services/directAccessService';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { selfInviteToInstance } from '@/services/launchService';
import { checkCanInviteSelf } from '@/shared/utils/invite';
import { parseLocation } from '@/shared/utils/location';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { Collapsible, CollapsibleTrigger } from '@/ui/shadcn/collapsible';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import { Skeleton } from '@/ui/shadcn/skeleton';

const GROUP_HEADER_ROW_SIZE = 38;
const GROUP_INSTANCE_ROW_SIZE = 49;
const GROUP_MESSAGE_ROW_SIZE = 64;
const GROUP_FOOTER_ROW_SIZE = 16;
const EMPTY_GROUP_ORDER: any[] = [];

function estimateGroupSidebarRowSize(row: any) {
    switch (row?.type) {
        case 'group-header':
            return GROUP_HEADER_ROW_SIZE;
        case 'message':
        case 'skeleton':
            return GROUP_MESSAGE_ROW_SIZE;
        case 'footer':
            return GROUP_FOOTER_ROW_SIZE;
        default:
            return GROUP_INSTANCE_ROW_SIZE;
    }
}

function GroupHeaderRow({ row, onToggleGroup }: any) {
    const isOpen = !row.isCollapsed;

    return (
        <Collapsible
            open={isOpen}
            onOpenChange={(nextOpen: any) => {
                if (nextOpen !== isOpen) {
                    onToggleGroup(row.groupId);
                }
            }}
        >
            <CollapsibleTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-between aria-expanded:bg-transparent aria-expanded:text-inherit dark:aria-expanded:bg-transparent"
                >
                    <span className="min-w-0 flex-1 truncate text-left">
                        {row.name} - {row.count}
                    </span>
                    <ChevronDownIcon
                        data-icon="inline-end"
                        className={cn(
                            'transition-transform',
                            !isOpen && '-rotate-90'
                        )}
                    />
                </Button>
            </CollapsibleTrigger>
        </Collapsible>
    );
}

function firstGroupId(...values: any[]) {
    for (const value of values) {
        const text =
            typeof value === 'string'
                ? value.trim()
                : String(value ?? '').trim();
        if (text.startsWith('grp_')) {
            return text;
        }
    }
    return '';
}

function normalizeGroupId(instance: any) {
    const location = resolveLocation(instance);
    const parsedLocation = parseLocation(location);
    return firstGroupId(
        instance?.group?.groupId ||
            instance?.group?.id ||
            instance?.instance?.group?.groupId ||
            instance?.instance?.group?.id,
        instance?.groupId,
        instance?.group_id,
        instance?.instance?.groupId,
        instance?.instance?.group_id,
        instance?.ownerId,
        instance?.owner_id,
        instance?.instance?.ownerId,
        instance?.instance?.owner_id,
        parsedLocation.groupId
    );
}

function resolveGroupName(instance: any, groupId: any) {
    return (
        instance?.group?.name ||
        instance?.instance?.group?.name ||
        instance?.groupName ||
        instance?.name ||
        groupId ||
        'Group'
    );
}

function resolveLocation(instance: any) {
    return (
        instance?.location ||
        instance?.instance?.location ||
        instance?.instanceId ||
        ''
    );
}

function resolveGroupIconUrl(instance: any) {
    const group = instance?.group || instance?.instance?.group || {};
    const candidates = [
        group.iconUrl,
        group.icon,
        group.thumbnailUrl,
        group.thumbnailImageUrl,
        group.imageUrl,
        group.image_url,
        group.bannerUrl,
        group.bannerImageUrl,
        instance?.groupIconUrl,
        instance?.groupIcon,
        instance?.groupThumbnailUrl,
        instance?.groupThumbnailImageUrl,
        instance?.iconUrl,
        instance?.icon,
        instance?.thumbnailUrl,
        instance?.thumbnailImageUrl,
        instance?.imageUrl,
        instance?.instance?.groupIconUrl,
        instance?.instance?.groupIcon,
        instance?.instance?.groupThumbnailUrl,
        instance?.instance?.groupThumbnailImageUrl,
        instance?.instance?.iconUrl,
        instance?.instance?.thumbnailUrl,
        instance?.instance?.thumbnailImageUrl,
        instance?.instance?.imageUrl
    ];
    return (
        candidates.find(
            (value: any) => typeof value === 'string' && value.trim()
        ) || ''
    );
}

function isAgeGatedInstance(instance: any) {
    return Boolean(
        instance?.ageGate ||
        instance?.instance?.ageGate ||
        instance?.location?.includes?.('~ageGate') ||
        instance?.instance?.location?.includes?.('~ageGate') ||
        resolveLocation(instance).includes('~ageGate')
    );
}

function groupInstances(instances: any, groupOrder: any[] = []) {
    const groups = new Map();
    for (const instance of instances || []) {
        const groupId = normalizeGroupId(instance);
        if (!groupId) {
            continue;
        }
        if (!groups.has(groupId)) {
            groups.set(groupId, []);
        }
        groups.get(groupId).push(instance);
    }
    return Array.from(groups.entries()).sort((left: any, right: any) => {
        const leftOrder = groupOrder.indexOf(left[0]);
        const rightOrder = groupOrder.indexOf(right[0]);
        if (leftOrder >= 0 && rightOrder >= 0) {
            return leftOrder - rightOrder;
        }
        if (leftOrder >= 0) {
            return -1;
        }
        if (rightOrder >= 0) {
            return 1;
        }
        const leftName = resolveGroupName(left[1]?.[0], left[0]);
        const rightName = resolveGroupName(right[1]?.[0], right[0]);
        return (
            leftName.localeCompare(rightName) || left[0].localeCompare(right[0])
        );
    });
}

function GroupInstanceRow({ instance, currentUserId, friendsMap }: any) {
    const { t } = useTranslation();
    const groupId = normalizeGroupId(instance);
    const name = resolveGroupName(instance, groupId);
    const iconUrl = convertFileUrlToImageUrl(
        resolveGroupIconUrl(instance),
        128
    );
    const location = resolveLocation(instance);
    const endpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const userCount =
        instance?.userCount ??
        instance?.n_users ??
        instance?.instance?.userCount ??
        '';
    const capacity = instance?.capacity ?? instance?.instance?.capacity ?? '';
    const worldHint = instance?.world?.name || instance?.worldName || '';
    const parsedLocation = parseLocation(location);
    const instanceRef = instance?.instance || instance;
    const canUseInstanceAction = Boolean(
        parsedLocation.isRealInstance &&
        parsedLocation.worldId &&
        parsedLocation.instanceId &&
        !instanceRef?.closedAt &&
        checkCanInviteSelf(location, {
            currentUserId,
            cachedInstances: new Map([[location, instanceRef]]),
            friends: friendsMap
        })
    );

    async function launchInstance() {
        if (!canUseInstanceAction) {
            return;
        }
        try {
            const opened = await tryOpenLaunchLocation(
                location,
                parsedLocation.shortName,
                endpoint
            );
            if (opened) {
                toast.success(
                    t('side_panel.success.vrchat_launch_request_sent')
                );
                return;
            }
            toast.error(
                t('side_panel.error.unable_to_open_this_instance_in_vrchat')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.groups_sidebar.toast.failed_to_launch_instance'
                      )
            );
        }
    }

    async function sendSelfInvite() {
        if (!canUseInstanceAction) {
            return;
        }
        try {
            await selfInviteToInstance(
                location,
                parsedLocation.shortName,
                endpoint
            );
            toast.success(t('message.invite.self_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.groups_sidebar.toast.failed_to_send_self_invite'
                      )
            );
        }
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div className="hover:bg-muted/50 flex w-full items-center rounded-lg">
                    <Button
                        type="button"
                        variant="ghost"
                        className="h-auto min-w-0 flex-1 justify-start gap-2 p-1.5 text-left font-normal"
                        onClick={() =>
                            openGroupDialog({
                                groupId,
                                title: name,
                                seedData: instance?.group || instance
                            })
                        }
                    >
                        <span className="bg-muted flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border">
                            {iconUrl ? (
                                <img
                                    src={iconUrl}
                                    alt=""
                                    className="size-full object-cover"
                                />
                            ) : (
                                <UsersIcon
                                    data-icon="inline-start"
                                    className="text-muted-foreground"
                                />
                            )}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate leading-5 font-medium">
                                {name}
                                {userCount !== '' || capacity !== '' ? (
                                    <span className="ml-1 font-normal">
                                        ({userCount || '?'}/{capacity || '?'})
                                    </span>
                                ) : null}
                            </span>
                            <span className="text-muted-foreground block truncate text-xs">
                                {location ? (
                                    <Location
                                        location={location}
                                        hint={worldHint}
                                        grouphint={name}
                                        link={false}
                                        asButton={false}
                                        showGroupLink={false}
                                    />
                                ) : (
                                    groupId
                                )}
                            </span>
                        </span>
                    </Button>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-52">
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={!canUseInstanceAction}
                        onSelect={() => {
                            launchInstance();
                        }}
                    >
                        {t('dialog.user.info.launch_invite_tooltip')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!canUseInstanceAction}
                        onSelect={() => {
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

export function GroupsSidebar() {
    const groupInstancesState = useRuntimeStore(
        (state: any) => state.groupInstances
    );
    const groupOrder = useRuntimeStore((state: any) =>
        state.groupInstances.userId === state.auth.currentUserId &&
        state.groupInstances.endpoint === state.auth.currentUserEndpoint
            ? state.groupInstances.groupOrder
            : EMPTY_GROUP_ORDER
    );
    const status = useRuntimeStore((state: any) => state.groupInstances.status);
    const error = useRuntimeStore((state: any) => state.groupInstances.error);
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const friendsById = useFriendRosterStore((state: any) => state.friendsById);
    const instances =
        groupInstancesState.userId === currentUserId &&
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.instances
            : [];
    const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
    const preferencesHydrated = usePreferencesStore(
        (state: any) => state.preferencesHydrated
    );
    const showAgeGatedInstancesPreference = usePreferencesStore(
        (state: any) => state.isAgeGatedInstancesVisible
    );
    const showAgeGatedInstances =
        preferencesHydrated && showAgeGatedInstancesPreference;
    const friendsMap = useMemo(
        () => new Map(Object.entries(friendsById || {})),
        [friendsById]
    );
    const visibleInstances = useMemo(
        () =>
            showAgeGatedInstances
                ? instances
                : (instances || []).filter(
                      (instance: any) => !isAgeGatedInstance(instance)
                  ),
        [instances, showAgeGatedInstances]
    );
    const groups = useMemo(
        () => groupInstances(visibleInstances, groupOrder || []),
        [groupOrder, visibleInstances]
    );

    function toggleGroup(groupId: any) {
        setCollapsedGroups((current: any) => {
            const next = new Set(current);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                next.add(groupId);
            }
            return next;
        });
    }

    const virtualRows = useMemo(() => {
        const nextRows = [];

        groups.forEach(([groupId, groupRows]: any, index: any) => {
            const name = resolveGroupName(groupRows[0], groupId);
            const isCollapsed = collapsedGroups.has(groupId);
            nextRows.push({
                type: 'group-header',
                key: `group:${groupId}`,
                groupId,
                name,
                count: groupRows.length,
                isCollapsed,
                first: index === 0
            });
            if (!isCollapsed) {
                groupRows.forEach((instance: any, instanceIndex: any) => {
                    nextRows.push({
                        type: 'group-instance',
                        key: `group:${groupId}:${resolveLocation(instance)}:${instanceIndex}`,
                        instance
                    });
                });
            }
        });

        if (!groups.length) {
            if (status === 'error') {
                nextRows.push({
                    type: 'message',
                    key: 'message:empty',
                    text: error || 'Failed to load group instances.'
                });
            } else if (status === 'ready') {
                nextRows.push({
                    type: 'message',
                    key: 'message:empty-ready',
                    text: 'No active group instances.'
                });
            } else {
                for (let index = 0; index < 4; index += 1) {
                    nextRows.push({
                        type: 'skeleton',
                        key: `skeleton:group-instances:${index}`
                    });
                }
            }
        }

        nextRows.push({ type: 'footer', key: 'footer' });
        return nextRows;
    }, [collapsedGroups, error, groups, status]);

    const { getRowRef, viewportRef, virtualItems, totalSize } =
        useVirtualSidebarRows(virtualRows, estimateGroupSidebarRowSize);

    function renderVirtualRow(row: any) {
        switch (row?.type) {
            case 'group-header':
                return <GroupHeaderRow row={row} onToggleGroup={toggleGroup} />;
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
            case 'group-instance':
            default:
                return (
                    <GroupInstanceRow
                        instance={row.instance}
                        currentUserId={currentUserId}
                        friendsMap={friendsMap}
                    />
                );
        }
    }

    return (
        <div
            ref={viewportRef}
            className="relative h-full overflow-auto overflow-x-hidden"
        >
            <div className="px-1.5 pb-2.5">
                <div
                    className="relative w-full"
                    style={{ height: `${totalSize}px` }}
                >
                    {virtualItems.map((item: any) => (
                        <div
                            key={item.key}
                            ref={getRowRef(item.key)}
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
