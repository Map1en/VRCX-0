import { ChevronDownIcon, UsersIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { LaunchModeContextMenuGroup } from '@/components/launch/LaunchModeContextMenuGroup';
import { Location } from '@/components/Location';
import { FadeInImage } from '@/components/media/FadeInImage';
import { useVirtualSidebarRows } from '@/components/sidebar/useVirtualSidebarRows';
import type {
    GroupInstanceRecord,
    GroupProfileRecord
} from '@/domain/entities/group';
import { cn } from '@/lib/utils';
import {
    commands,
    type SavedGroupFavoritesSnapshot
} from '@/platform/tauri/bindings';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { openGroupDialog } from '@/services/dialogService';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { selfInviteToInstance } from '@/services/launchService';
import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';
import { checkCanInviteSelf } from '@/shared/utils/invite';
import { parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';
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
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import { Skeleton } from '@/ui/shadcn/skeleton';

const GROUP_HEADER_ROW_SIZE = 38;
const GROUP_INSTANCE_ROW_SIZE = 49;
const GROUP_MESSAGE_ROW_SIZE = 64;
const GROUP_FOOTER_ROW_SIZE = 16;
const EMPTY_GROUP_ORDER: string[] = [];
const EMPTY_GROUP_INSTANCES: GroupInstanceRecord[] = [];
const SAVED_GROUP_FAVORITES_CHANGED_EVENT = 'saved-group-favorites-changed';

type GroupSectionSidebarRow = {
    type: 'section';
    key: string;
    title: string;
};
type GroupCollectionSidebarRow = {
    type: 'collection';
    key: string;
    name: string;
    count: number;
};

type GroupHeaderSidebarRow = {
    type: 'group-header';
    key: string;
    groupId: string;
    name: string;
    count: number;
    isCollapsed: boolean;
    first: boolean;
};
type GroupInstanceSidebarRow = {
    type: 'group-instance';
    key: string;
    instance: GroupInstanceRecord;
};
type GroupMessageSidebarRow = {
    type: 'message';
    key: string;
    text: string;
};
type GroupSkeletonSidebarRow = { type: 'skeleton'; key: string };
type GroupFooterSidebarRow = { type: 'footer'; key: string };
type GroupSidebarRow =
    | GroupSectionSidebarRow
    | GroupCollectionSidebarRow
    | GroupHeaderSidebarRow
    | GroupInstanceSidebarRow
    | GroupMessageSidebarRow
    | GroupSkeletonSidebarRow
    | GroupFooterSidebarRow;

function estimateGroupSidebarRowSize(row: GroupSidebarRow) {
    switch (row?.type) {
        case 'section':
            return 34;
        case 'collection':
            return 30;
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

function GroupHeaderRow({
    row,
    onToggleGroup
}: {
    row: GroupHeaderSidebarRow;
    onToggleGroup(groupId: string): void;
}) {
    const isOpen = !row.isCollapsed;

    if (row.count === 0) {
        return (
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() =>
                    openGroupDialog({ groupId: row.groupId, title: row.name })
                }
            >
                <span className="min-w-0 flex-1 truncate text-left">
                    {row.name} - 0
                </span>
            </Button>
        );
    }

    return (
        <Collapsible
            open={isOpen}
            onOpenChange={(nextOpen) => {
                if (nextOpen !== isOpen) {
                    onToggleGroup(row.groupId);
                }
            }}
        >
            <CollapsibleTrigger
                render={
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
                }
            />
        </Collapsible>
    );
}

function firstGroupId(...values: unknown[]) {
    for (const value of values) {
        const text =
            typeof value === 'string'
                ? value.trim()
                : String(value ?? '').trim();
        if (hasGroupIdPrefix(text)) {
            return text;
        }
    }
    return '';
}

function normalizeGroupId(instance: GroupInstanceRecord) {
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

function resolveGroupName(instance: GroupInstanceRecord, groupId: string) {
    return (
        instance?.group?.name ||
        instance?.instance?.group?.name ||
        instance?.groupName ||
        instance?.name ||
        groupId ||
        'Group'
    );
}

function resolveLocation(instance: GroupInstanceRecord) {
    return (
        instance?.location ||
        instance?.instance?.location ||
        instance?.instanceId ||
        ''
    );
}

function resolveGroupIconUrl(instance: GroupInstanceRecord) {
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
            (value): value is string =>
                typeof value === 'string' && Boolean(value.trim())
        ) || ''
    );
}

function isAgeGatedInstance(instance: GroupInstanceRecord) {
    return Boolean(
        instance?.ageGate ||
        instance?.instance?.ageGate ||
        instance?.location?.includes?.('~ageGate') ||
        instance?.instance?.location?.includes?.('~ageGate') ||
        resolveLocation(instance).includes('~ageGate')
    );
}

function groupInstances(
    instances: GroupInstanceRecord[],
    groupOrder: string[] = []
) {
    const groups = new Map<string, GroupInstanceRecord[]>();
    for (const instance of instances) {
        const groupId = normalizeGroupId(instance);
        if (!groupId) {
            continue;
        }
        if (!groups.has(groupId)) {
            groups.set(groupId, []);
        }
        groups.get(groupId)?.push(instance);
    }
    return Array.from(groups.entries()).sort((left, right) => {
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

function GroupInstanceRow({
    instance,
    currentUserId,
    friendsMap
}: {
    instance: GroupInstanceRecord;
    currentUserId: string | null;
    friendsMap: Map<
        string,
        ReturnType<typeof useFriendRosterStore.getState>['friendsById'][string]
    >;
}) {
    const { t } = useTranslation();
    const groupId = normalizeGroupId(instance);
    const name = resolveGroupName(instance, groupId);
    const iconUrl = convertFileUrlToImageUrl(
        resolveGroupIconUrl(instance),
        128
    );
    const location = resolveLocation(instance);
    const userCount =
        instance?.userCount ??
        instance?.n_users ??
        instance?.instance?.userCount ??
        '';
    const capacity = instance?.capacity ?? instance?.instance?.capacity ?? '';
    const worldHint =
        normalizeString(instance?.world?.name) || instance?.worldName || '';
    const parsedLocation = parseLocation(location);
    const instanceRef = instance?.instance || instance;
    const canUseInstanceAction = Boolean(
        parsedLocation.isRealInstance &&
        parsedLocation.worldId &&
        parsedLocation.instanceId &&
        !instanceRef?.closedAt &&
        checkCanInviteSelf(location, {
            currentUserId: currentUserId || '',
            cachedInstances: new Map([[location, instanceRef]]),
            friends: friendsMap
        })
    );

    async function sendSelfInvite() {
        if (!canUseInstanceAction) {
            return;
        }
        try {
            await selfInviteToInstance(location, parsedLocation.shortName);
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
            <ContextMenuTrigger
                render={
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
                                    <FadeInImage
                                        src={iconUrl}
                                        alt=""
                                        className="size-full object-cover"
                                        fallback={
                                            <UsersIcon
                                                data-icon="inline-start"
                                                className="text-muted-foreground"
                                            />
                                        }
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
                                            ({userCount || '?'}/
                                            {capacity || '?'})
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
                }
            />
            <ContextMenuContent className="w-52">
                <LaunchModeContextMenuGroup
                    disabled={!canUseInstanceAction}
                    errorMessage={t(
                        'component.groups_sidebar.toast.failed_to_launch_instance'
                    )}
                    location={location}
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

export function GroupsSidebar() {
    const { t } = useTranslation();
    const groupInstancesState = useRuntimeStore(
        (state) => state.groupInstances
    );
    const groupOrder = useRuntimeStore((state) =>
        state.groupInstances.userId === state.auth.currentUserId &&
        state.groupInstances.endpoint === state.auth.currentUserEndpoint
            ? state.groupInstances.groupOrder
            : EMPTY_GROUP_ORDER
    );
    const status = useRuntimeStore((state) => state.groupInstances.status);
    const error = useRuntimeStore((state) => state.groupInstances.error);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const instances =
        groupInstancesState.userId === currentUserId &&
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.instances
            : EMPTY_GROUP_INSTANCES;
    const [collapsedGroups, setCollapsedGroups] = useState(
        () => new Set<string>()
    );
    const [savedGroups, setSavedGroups] = useState<SavedGroupFavoritesSnapshot>(
        { collections: [] }
    );
    const [savedGroupProfiles, setSavedGroupProfiles] = useState<
        Map<string, GroupProfileRecord>
    >(new Map());
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const showAgeGatedInstancesPreference = usePreferencesStore(
        (state) => state.isAgeGatedInstancesVisible
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
                      (instance) => !isAgeGatedInstance(instance)
                  ),
        [instances, showAgeGatedInstances]
    );
    const groups = useMemo(
        () => groupInstances(visibleInstances, groupOrder || []),
        [groupOrder, visibleInstances]
    );

    const loadSavedGroups = useCallback(async () => {
        if (!currentUserId) {
            setSavedGroups({ collections: [] });
            setSavedGroupProfiles(new Map());
            return;
        }
        const next = await commands.appSavedGroupFavoritesGet();
        setSavedGroups(next);
        const groupIds = Array.from(
            new Set(
                next.collections.flatMap((collection) => collection.groupIds)
            )
        );
        const results = await Promise.allSettled(
            groupIds.map((groupId) =>
                groupProfileRepository.fetchGroupProfile({
                    groupId,
                    includeRoles: false
                })
            )
        );
        setSavedGroupProfiles(
            new Map(
                results.flatMap((result) =>
                    result.status === 'fulfilled'
                        ? [[result.value.id, result.value] as const]
                        : []
                )
            )
        );
    }, [currentUserId]);

    useEffect(() => {
        const refresh = () => {
            void loadSavedGroups().catch((loadError: unknown) =>
                console.warn('Failed to load saved groups:', loadError)
            );
        };
        refresh();
        window.addEventListener(SAVED_GROUP_FAVORITES_CHANGED_EVENT, refresh);
        return () =>
            window.removeEventListener(
                SAVED_GROUP_FAVORITES_CHANGED_EVENT,
                refresh
            );
    }, [loadSavedGroups]);

    function toggleGroup(groupId: string) {
        setCollapsedGroups((current) => {
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
        const nextRows: GroupSidebarRow[] = [];
        const groupsById = new Map(groups);
        const savedGroupIds = new Set(
            savedGroups.collections.flatMap((collection) => collection.groupIds)
        );

        if (savedGroups.collections.length) {
            nextRows.push({
                type: 'section',
                key: 'section:saved',
                title: t('saved_group_favorites.sidebar_saved', {
                    defaultValue: '收藏群组'
                })
            });
            savedGroups.collections.forEach((collection) => {
                nextRows.push({
                    type: 'collection',
                    key: `collection:${collection.id}`,
                    name: collection.name,
                    count: collection.groupIds.length
                });
                collection.groupIds.forEach((groupId) => {
                    const groupRows = groupsById.get(groupId) || [];
                    const profile = savedGroupProfiles.get(groupId);
                    const name =
                        profile?.name ||
                        resolveGroupName(groupRows[0], groupId) ||
                        groupId;
                    const isCollapsed = collapsedGroups.has(groupId);
                    nextRows.push({
                        type: 'group-header',
                        key: `saved-group:${collection.id}:${groupId}`,
                        groupId,
                        name,
                        count: groupRows.length,
                        isCollapsed,
                        first: false
                    });
                    if (!isCollapsed) {
                        groupRows.forEach((instance, instanceIndex) => {
                            nextRows.push({
                                type: 'group-instance',
                                key: `saved-group:${groupId}:${resolveLocation(instance)}:${instanceIndex}`,
                                instance
                            });
                        });
                    }
                });
            });
        }

        nextRows.push({
            type: 'section',
            key: 'section:other',
            title: t('saved_group_favorites.sidebar_other', {
                defaultValue: '其他活动群组'
            })
        });

        const otherGroups = groups.filter(
            ([groupId]) => !savedGroupIds.has(groupId)
        );
        otherGroups.forEach(([groupId, groupRows], index) => {
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
                groupRows.forEach((instance, instanceIndex) => {
                    nextRows.push({
                        type: 'group-instance',
                        key: `group:${groupId}:${resolveLocation(instance)}:${instanceIndex}`,
                        instance
                    });
                });
            }
        });

        if (!otherGroups.length) {
            if (status === 'error') {
                nextRows.push({
                    type: 'message',
                    key: 'message:empty',
                    text:
                        error ||
                        t('saved_group_favorites.sidebar_failed', {
                            defaultValue: '群组房间加载失败'
                        })
                });
            } else if (status === 'ready') {
                nextRows.push({
                    type: 'message',
                    key: 'message:empty-ready',
                    text: t('saved_group_favorites.sidebar_no_active', {
                        defaultValue: '没有其他活动群组房间'
                    })
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
    }, [
        collapsedGroups,
        error,
        groups,
        savedGroupProfiles,
        savedGroups.collections,
        status,
        t
    ]);

    const { getRowRef, viewportRef, virtualItems, totalSize } =
        useVirtualSidebarRows(virtualRows, estimateGroupSidebarRowSize);

    function renderVirtualRow(row: GroupSidebarRow) {
        switch (row?.type) {
            case 'section':
                return (
                    <div className="text-muted-foreground flex h-full items-end px-2 pb-1 text-xs font-semibold uppercase">
                        {row.title}
                    </div>
                );
            case 'collection':
                return (
                    <div className="flex h-full items-center justify-between px-2 text-sm font-medium">
                        <span className="truncate">{row.name}</span>
                        <span className="text-muted-foreground text-xs">
                            {row.count}
                        </span>
                    </div>
                );
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
                    {virtualItems.map((item) => (
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
