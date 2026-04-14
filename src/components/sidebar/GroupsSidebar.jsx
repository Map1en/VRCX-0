import { useEffect, useMemo, useState } from 'react';
import { ChevronDownIcon, UsersIcon } from 'lucide-react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { Location } from '@/components/Location.jsx';
import { useVirtualSidebarRows } from '@/components/sidebar/virtualSidebarRows.js';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/ui/shadcn/context-menu.jsx';
import { convertFileUrlToImageUrl } from '@/lib/entityMedia.js';
import { openGroupDialog } from '@/services/dialogService.js';
import { tryOpenLaunchLocation } from '@/services/directAccessService.js';
import { selfInviteToInstance } from '@/services/launchService.js';
import { checkCanInviteSelf } from '@/shared/utils/invite.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

const GROUP_HEADER_ROW_SIZE = 38;
const GROUP_INSTANCE_ROW_SIZE = 49;
const GROUP_MESSAGE_ROW_SIZE = 64;
const GROUP_FOOTER_ROW_SIZE = 16;

function estimateGroupSidebarRowSize(row) {
    switch (row?.type) {
        case 'group-header':
            return GROUP_HEADER_ROW_SIZE;
        case 'message':
            return GROUP_MESSAGE_ROW_SIZE;
        case 'footer':
            return GROUP_FOOTER_ROW_SIZE;
        default:
            return GROUP_INSTANCE_ROW_SIZE;
    }
}

function normalizeGroupId(instance) {
    const nestedId =
        instance?.group?.groupId ||
        instance?.group?.id ||
        instance?.instance?.group?.groupId ||
        instance?.instance?.group?.id;
    if (typeof nestedId === 'string' && nestedId.startsWith('grp_')) {
        return nestedId;
    }
    return '';
}

function resolveGroupName(instance, groupId) {
    return instance?.group?.name || instance?.instance?.group?.name || instance?.groupName || instance?.name || groupId || 'Group';
}

function resolveLocation(instance) {
    return instance?.location || instance?.instance?.location || instance?.instanceId || '';
}

function resolveGroupIconUrl(instance) {
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
    return candidates.find((value) => typeof value === 'string' && value.trim()) || '';
}

function isAgeGatedInstance(instance) {
    return Boolean(
        instance?.ageGate ||
        instance?.instance?.ageGate ||
        instance?.location?.includes?.('~ageGate') ||
        instance?.instance?.location?.includes?.('~ageGate') ||
        resolveLocation(instance).includes('~ageGate')
    );
}

function groupInstances(instances, groupOrder = []) {
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
        return leftName.localeCompare(rightName) || left[0].localeCompare(right[0]);
    });
}

function GroupInstanceRow({ instance, currentUserId, friendsMap }) {
    const { t } = useI18n();
    const groupId = normalizeGroupId(instance);
    const name = resolveGroupName(instance, groupId);
    const iconUrl = convertFileUrlToImageUrl(resolveGroupIconUrl(instance), 128);
    const location = resolveLocation(instance);
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const userCount = instance?.userCount ?? instance?.n_users ?? instance?.instance?.userCount ?? '';
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
            const opened = await tryOpenLaunchLocation(location, parsedLocation.shortName, endpoint);
            if (opened) {
                toast.success('VRChat launch request sent.');
                return;
            }
            toast.error('Unable to open this instance in VRChat.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to launch instance.');
        }
    }

    async function sendSelfInvite() {
        if (!canUseInstanceAction) {
            return;
        }
        try {
            await selfInviteToInstance(location, parsedLocation.shortName, endpoint);
            toast.success(t('message.invite.self_sent'));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to send self invite.');
        }
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div className="flex w-full items-center rounded-lg hover:bg-muted/50">
                    <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 p-1.5 text-left text-[13px]"
                        onClick={() => openGroupDialog({ groupId, title: name, seedData: instance?.group || instance })}>
                            <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                                {iconUrl ? (
                                    <img src={iconUrl} alt="" className="size-full object-cover" />
                                ) : (
                                    <UsersIcon className="size-4 text-muted-foreground" />
                                )}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium leading-[18px]">
                                    {name}
                                    {userCount !== '' || capacity !== '' ? (
                                        <span className="ml-1 font-normal">
                                            ({userCount || '?'}/{capacity || '?'})
                                        </span>
                                    ) : null}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                    {location ? (
                                        <Location
                                            location={location}
                                            hint={worldHint}
                                            grouphint={name}
                                            link={false}
                                            stopPropagation
                                            asButton={false}
                                        />
                                    ) : (
                                        groupId
                                    )}
                                </span>
                            </span>
                    </button>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-52">
                <ContextMenuItem
                    disabled={!canUseInstanceAction}
                    onSelect={() => {
                        void launchInstance();
                    }}>
                    {t('dialog.user.info.launch_invite_tooltip')}
                </ContextMenuItem>
                <ContextMenuItem
                    disabled={!canUseInstanceAction}
                    onSelect={() => {
                        void sendSelfInvite();
                    }}>
                    {t('dialog.user.info.self_invite_tooltip')}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}

export function GroupsSidebar() {
    const groupInstancesState = useRuntimeStore((state) => state.groupInstances);
    const groupOrder = useRuntimeStore((state) => state.groupInstances.groupOrder);
    const status = useRuntimeStore((state) => state.groupInstances.status);
    const error = useRuntimeStore((state) => state.groupInstances.error);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const instances = groupInstancesState.endpoint === currentEndpoint ? groupInstancesState.instances : [];
    const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
    const preferencesHydrated = usePreferencesStore((state) => state.preferencesHydrated);
    const showAgeGatedInstancesPreference = usePreferencesStore((state) => state.isAgeGatedInstancesVisible);
    const showAgeGatedInstances = preferencesHydrated && showAgeGatedInstancesPreference;
    const friendsMap = useMemo(
        () => new Map(Object.entries(friendsById || {})),
        [friendsById]
    );
    const visibleInstances = useMemo(
        () => (showAgeGatedInstances ? instances : (instances || []).filter((instance) => !isAgeGatedInstance(instance))),
        [instances, showAgeGatedInstances]
    );
    const groups = useMemo(() => groupInstances(visibleInstances, groupOrder || []), [groupOrder, visibleInstances]);

    function toggleGroup(groupId) {
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
        const nextRows = [];

        groups.forEach(([groupId, groupRows], index) => {
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

        if (!groups.length) {
            nextRows.push({
                type: 'message',
                key: 'message:empty',
                text: status === 'error' ? error || 'Failed to load group instances.' : 'No group instances snapshot.'
            });
        }

        nextRows.push({ type: 'footer', key: 'footer' });
        return nextRows;
    }, [collapsedGroups, error, groups, status]);

    const {
        viewportRef,
        virtualItems,
        totalSize
    } = useVirtualSidebarRows(virtualRows, estimateGroupSidebarRowSize);

    function renderVirtualRow(row) {
        switch (row?.type) {
            case 'group-header':
                return (
                    <button
                        type="button"
                        className={`flex w-full items-center py-1.5 text-left text-xs ${row.first ? 'pt-0' : 'pt-4'}`}
                        onClick={() => toggleGroup(row.groupId)}>
                        <ChevronDownIcon className={`size-4 transition-transform ${row.isCollapsed ? '-rotate-90' : ''}`} />
                        <span className="ml-1.5">
                            {row.name} - {row.count}
                        </span>
                    </button>
                );
            case 'message':
                return (
                    <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                        {row.text}
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
