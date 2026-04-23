import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import {
    CheckIcon,
    RefreshCcwIcon,
    SendIcon,
    Trash2Icon,
    XIcon
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import {
    DataTableHeader,
    DataTablePagination
} from '@/components/data-table/DataTableView.jsx';
import { ResizableTableCell } from '@/components/data-table/ResizableTableParts.jsx';
import { InviteMessageDialog } from '@/components/dialogs/InviteMessageDialog.jsx';
import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu.jsx';
import { formatDateFilter } from '@/lib/dateTime.js';
import {
    convertFileUrlToImageUrl,
    openExternalLink
} from '@/lib/entityMedia.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { cn } from '@/lib/utils.js';
import {
    configRepository,
    NOTIFICATION_TYPES,
    notificationRepository,
    vrchatSearchRepository
} from '@/repositories/index.js';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';
import { withUploadTimeout } from '@/shared/utils/imageUpload.js';
import { checkCanInvite } from '@/shared/utils/invite.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';
import {
    Table,
    TableBody,
    TableCell,
    TableRow
} from '@/ui/shadcn/table';

import {
    buildCachedInstanceMap,
    canDeclineNotification,
    filterNotificationRows,
    getNotificationCreatedAt,
    getNotificationGroupColumnLabel,
    getNotificationMessage,
    getResponseLabel,
    normalizeWorldTarget,
    resolveCurrentInviteLocation
} from './notificationRows.js';
import {
    NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES as DEFAULT_PAGE_SIZES,
    readPersistedNotificationTableState as readPersistedState,
    resolveNotificationPageSize as resolvePageSize,
    safeJsonParse,
    sanitizeNotificationColumnOrder as sanitizeColumnOrder,
    sanitizeNotificationColumnSizing as sanitizeColumnSizing,
    sanitizeNotificationColumnVisibility as sanitizeColumnVisibility,
    sanitizeNotificationFilters,
    sanitizeNotificationSorting as sanitizeSorting,
    writePersistedNotificationTableState as writePersistedState
} from './notificationTableState.js';
import { appI18n } from '@/services/i18nService.js';
import {
    BoopReplyDialog,
    NotificationLocationLink,
    NotificationTypeFilterDropdown,
    SortButton,
    getNotificationLinkIcon,
    getResponseIcon,
    notificationLinkIsInternal
} from './components/NotificationViewParts.jsx';

export function VrcNotificationPage({ embedded = false } = {}) {
    const { t } = useI18n();
    const runtimeAuth = useRuntimeStore((state) => state.auth);
    const gameState = useRuntimeStore((state) => state.gameState);
    const modalStore = useModalStore();
    const notificationRows = useVrcNotificationStore((state) => state.rows);
    const notificationLoadStatus = useVrcNotificationStore(
        (state) => state.loadStatus
    );
    const notificationDetail = useVrcNotificationStore((state) => state.detail);
    const loadNotificationsForCurrentUser = useVrcNotificationStore(
        (state) => state.loadForCurrentUser
    );
    const groupInstancesState = useRuntimeStore(
        (state) => state.groupInstances
    );
    const currentUserId = runtimeAuth.currentUserId;
    const endpoint = runtimeAuth.currentUserEndpoint;
    const groupInstanceRows =
        groupInstancesState.endpoint === endpoint
            ? groupInstancesState.instances
            : [];
    const currentUserSnapshot = runtimeAuth.currentUserSnapshot;
    const isLocalUserVrcPlusSupporter = Boolean(
        currentUserSnapshot?.$isVRCPlus ||
        currentUserSnapshot?.tags?.includes?.('system_supporter') ||
        globalThis?.$debug?.debugVrcPlus
    );
    const currentInviteLocation = useMemo(
        () => resolveCurrentInviteLocation(gameState, currentUserSnapshot),
        [gameState, currentUserSnapshot]
    );
    const cachedInstances = useMemo(
        () => buildCachedInstanceMap(groupInstanceRows),
        [groupInstanceRows]
    );
    const canInviteFromCurrentLocation = useMemo(
        () =>
            checkCanInvite(currentInviteLocation, {
                currentUserId,
                lastLocationStr: currentInviteLocation,
                cachedInstances
            }),
        [cachedInstances, currentInviteLocation, currentUserId]
    );
    const notificationTypeLabel = useMemo(
        () => (type) => {
            const fallback = type || 'unknown';
            const key = `view.notification.filters.${fallback}`;
            const label = t(key);
            return label && label !== key ? label : fallback;
        },
        [t]
    );
    const persistedState = useMemo(() => readPersistedState(), []);
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenPageSizeRef = useRef(false);
    const hasWrittenColumnVisibilityRef = useRef(false);
    const hasWrittenTableLayoutRef = useRef(false);
    const [rows, setRows] = useState([]);
    const [loadStatus, setLoadStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [activeTypes, setActiveTypes] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [preferencesReady, setPreferencesReady] = useState(false);
    const [sorting, setSorting] = useState(() =>
        sanitizeSorting(persistedState.sorting)
    );
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
        pageSize: resolvePageSize(persistedState.pageSize)
    });
    const [reloadToken, setReloadToken] = useState(0);
    const [inviteResponseRequest, setInviteResponseRequest] = useState(null);
    const [boopReplyRequest, setBoopReplyRequest] = useState(null);
    const [shiftHeld, setShiftHeld] = useState(false);
    const deferredSearchQuery = useDeferredValue(searchQuery);

    useEffect(() => {
        function handleKeyDown(event) {
            if (event.key === 'Shift') {
                setShiftHeld(true);
            }
        }

        function handleKeyUp(event) {
            if (event.key === 'Shift') {
                setShiftHeld(false);
            }
        }

        function handleBlur() {
            setShiftHeld(false);
        }

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', handleBlur);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);
        };
    }, []);

    useEffect(() => {
        let active = true;
        configRepository
            .getString('VRCX_notificationTableFilters', '[]')
            .then((savedFilters) => {
                if (!active) {
                    return;
                }

                setActiveTypes(
                    sanitizeNotificationFilters(
                        safeJsonParse(savedFilters),
                        NOTIFICATION_TYPES
                    )
                );
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
        if (!preferencesReady) {
            return;
        }

        void configRepository.setString(
            'VRCX_notificationTableFilters',
            JSON.stringify(activeTypes)
        );
    }, [activeTypes, preferencesReady]);

    useEffect(() => {
        if (!hasWrittenSortingRef.current) {
            hasWrittenSortingRef.current = true;
            return;
        }

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
        if (!hasWrittenColumnVisibilityRef.current) {
            hasWrittenColumnVisibilityRef.current = true;
            return;
        }

        writePersistedState({
            columnVisibility: sanitizeColumnVisibility(columnVisibility)
        });
    }, [columnVisibility]);

    useEffect(() => {
        if (!hasWrittenTableLayoutRef.current) {
            hasWrittenTableLayoutRef.current = true;
            return;
        }

        writePersistedState({
            columnOrder: sanitizeColumnOrder(columnOrder),
            columnSizing: sanitizeColumnSizing(columnSizing),
            columnOrderLocked
        });
    }, [columnOrder, columnOrderLocked, columnSizing]);

    useEffect(() => {
        let active = true;
        if (!preferencesReady) {
            return () => {
                active = false;
            };
        }
        if (!currentUserId) {
            setRows([]);
            setLoadStatus('idle');
            setDetail('No current user session is available.');
            return () => {
                active = false;
            };
        }

        loadNotificationsForCurrentUser().catch((error) => {
            if (!active) {
                return;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.notifications.generated_toast.failed_to_load_notifications')
            );
        });

        return () => {
            active = false;
        };
    }, [
        currentUserId,
        loadNotificationsForCurrentUser,
        preferencesReady,
        reloadToken
    ]);

    useEffect(() => {
        if (!preferencesReady || !currentUserId) {
            return;
        }

        const nextRows = filterNotificationRows(
            notificationRows,
            activeTypes,
            deferredSearchQuery
        );
        setRows(nextRows);
        setLoadStatus(notificationLoadStatus);
        setDetail(notificationDetail || '');
    }, [
        activeTypes,
        currentUserId,
        deferredSearchQuery,
        notificationDetail,
        notificationLoadStatus,
        notificationRows,
        preferencesReady
    ]);

    useEffect(() => {
        setPagination((current) => ({
            ...current,
            pageIndex: 0
        }));
    }, [activeTypes, deferredSearchQuery]);

    function openNotificationLink(link) {
        const value = String(link || '').trim();
        if (!value) return;
        if (value.startsWith('user:')) {
            const userId = value.slice('user:'.length);
            openUserDialog({ userId });
            return;
        }
        if (value.startsWith('group:')) {
            const groupId = value.slice('group:'.length);
            openGroupDialog({ groupId });
            return;
        }
        if (value.startsWith('event:')) {
            const [groupId] = value.slice('event:'.length).split(',');
            if (groupId) {
                openGroupDialog({ groupId });
                return;
            }
        }
        if (value.startsWith('world:')) {
            const worldId = normalizeWorldTarget(value.slice('world:'.length));
            openWorldDialog({ worldId });
            return;
        }
        if (value.startsWith('avatar:')) {
            const avatarId = value.slice('avatar:'.length);
            openAvatarDialog({ avatarId });
            return;
        }
        void openExternalLink(value);
    }

    function openNotificationTypeTarget(notification) {
        if (
            (notification.type === 'group.queueReady' ||
                notification.type === 'instance.closed') &&
            notification.location
        ) {
            openWorldDialog({
                worldId: notification.location,
                title:
                    notification.worldName ||
                    notification.details?.worldName ||
                    undefined
            });
            return;
        }
        if (notification.link) {
            openNotificationLink(notification.link);
        }
    }

    function notificationTypeIsClickable(notification) {
        return Boolean(
            notification.link ||
            ((notification.type === 'group.queueReady' ||
                notification.type === 'instance.closed') &&
                notification.location)
        );
    }

    function openNotificationImagePreview(notification) {
        const imageUrl =
            notification.details?.imageUrl || notification.imageUrl || '';
        if (!imageUrl || imageUrl.startsWith('default_')) {
            return;
        }
        modalStore.openImagePreview({
            url: convertFileUrlToImageUrl(imageUrl, 1024),
            title:
                notification.title ||
                notification.message ||
                notification.type ||
                'Notification image'
        });
    }

    async function markSeen(notification) {
        try {
            await notificationRepository.markSeen({
                userId: currentUserId,
                id: notification.id,
                version: notification.version,
                endpoint
            });
            setReloadToken((value) => value + 1);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.notifications.generated_toast.failed_to_mark_notification_as_seen')
            );
        }
    }

    async function deleteNotification(
        notification,
        { skipConfirm = false } = {}
    ) {
        try {
            if (!skipConfirm) {
                const result = await modalStore.confirm({
                    title: appI18n.t('view.notifications.generated_modal.delete_notification_log_entry'),
                    description: appI18n.t('view.notifications.generated_modal.delete_the_local_value_log_entry', { value: notification.type || 'notification' }),
                    confirmText: appI18n.t('common.actions.delete'),
                    destructive: true
                });
                if (!result.ok) {
                    return;
                }
            }
            await notificationRepository.deleteNotification({
                userId: currentUserId,
                id: notification.id,
                version: notification.version
            });
            setReloadToken((value) => value + 1);
            toast.success(t('view.notification.generated.notification_log_entry_deleted'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.notifications.generated_toast.failed_to_delete_notification')
            );
        }
    }

    async function expireNotificationLocally(notification) {
        await notificationRepository.expireNotification({
            userId: currentUserId,
            id: notification.id
        });
        setReloadToken((value) => value + 1);
    }

    async function acceptFriendRequest(notification) {
        try {
            const result = await modalStore.confirm({
                title: appI18n.t('view.notifications.generated_modal.accept_friend_request'),
                description: appI18n.t('view.notifications.generated_dynamic.accept_the_friend_request_from_value', { value: notification.senderUsername || 'this user' })
            });
            if (!result.ok) {
                return;
            }
            await notificationRepository.acceptFriendRequest({
                id: notification.id,
                endpoint
            });
            await expireNotificationLocally(notification);
            toast.success(t('view.notification.generated.friend_request_accepted'));
        } catch (error) {
            if (error?.status === 404) {
                await expireNotificationLocally(notification);
                return;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.notifications.generated_toast.failed_to_accept_friend_request')
            );
        }
    }

    async function hideNotification(
        notification,
        { skipConfirm = false } = {}
    ) {
        try {
            if (!skipConfirm) {
                const result = await modalStore.confirm({
                    title: appI18n.t('view.notifications.generated_modal.decline_notification'),
                    description: appI18n.t('view.notifications.generated_dynamic.decline_the_value_notification', { value: notification.type || 'notification' }),
                    confirmText: appI18n.t('view.notifications.generated_modal.decline'),
                    destructive: true
                });
                if (!result.ok) {
                    return;
                }
            }
            await notificationRepository.hideRemoteNotification({
                id: notification.id,
                version: notification.version,
                type: notification.type,
                senderUserId: notification.senderUserId,
                endpoint
            });
            await expireNotificationLocally(notification);
            toast.success(t('view.notification.generated.notification_declined'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.notifications.generated_toast.failed_to_decline_notification')
            );
        }
    }

    async function acceptRequestInvite(notification) {
        try {
            if (!currentInviteLocation) {
                toast.error(
                    t('view.notification.generated.cannot_invite_no_current_vrchat_location_is_available')
                );
                return;
            }
            if (!canInviteFromCurrentLocation) {
                toast.error(t('view.notification.generated.cannot_invite_from_the_current_instance_type'));
                return;
            }
            const parsedLocation = parseLocation(currentInviteLocation);
            if (!parsedLocation.worldId || !parsedLocation.instanceId) {
                toast.error(
                    t('view.notification.generated.cannot_invite_current_location_is_not_a_concrete_instance')
                );
                return;
            }
            const result = await modalStore.confirm({
                title: appI18n.t('view.notifications.generated_modal.send_invite'),
                description: appI18n.t('view.notifications.generated_dynamic.send_an_invite_to_value', { value: notification.senderUsername || 'this user' })
            });
            if (!result.ok) {
                return;
            }

            const worldResponse = await vrchatSearchRepository.getWorlds(
                {},
                parsedLocation.worldId,
                { endpoint }
            );
            await notificationRepository.sendInvite({
                receiverUserId: notification.senderUserId,
                endpoint,
                params: {
                    instanceId: currentInviteLocation,
                    worldId: parsedLocation.worldId,
                    worldName:
                        worldResponse.json?.name || parsedLocation.worldId,
                    rsvp: true
                }
            });
            await notificationRepository.hideRemoteNotification({
                id: notification.id,
                version: notification.version,
                type: notification.type,
                senderUserId: notification.senderUserId,
                endpoint
            });
            await expireNotificationLocally(notification);
            toast.success(t('view.notification.generated.invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.notifications.generated_toast.failed_to_send_invite')
            );
        }
    }

    function sendInviteResponseWithMessage(notification, messageType) {
        if (!currentUserId) {
            toast.error(
                t('view.notification.generated.cannot_send_invite_response_no_current_user_session_is_avail')
            );
            return;
        }
        setInviteResponseRequest({
            notification,
            messageType
        });
    }

    async function sendInviteResponseSlot({
        notification,
        row,
        imageData
    }) {
        if (!currentUserId) {
            throw new Error(
                'Cannot send invite response: no current user session is available.'
            );
        }

        const responseSlot = Number.parseInt(row?.slot, 10);
        if (!Number.isFinite(responseSlot)) {
            throw new Error('Response slot must be a number.');
        }

        if (imageData) {
            await withUploadTimeout(
                notificationRepository.sendInviteResponsePhoto({
                    id: notification.id,
                    responseSlot,
                    imageData,
                    endpoint
                })
            );
        } else {
            await notificationRepository.sendInviteResponse({
                id: notification.id,
                responseSlot,
                endpoint
            });
        }

        await notificationRepository.hideRemoteNotification({
            id: notification.id,
            version: notification.version,
            type: notification.type,
            senderUserId: notification.senderUserId,
            endpoint
        });
        await expireNotificationLocally(notification);
        toast.success(
            imageData ? appI18n.t('view.notifications.generated_toast.invite_response_photo_sent') : appI18n.t('view.notifications.generated_toast.invite_response_sent')
        );
    }

    async function dismissBoopNotifications(senderUserId) {
        if (!currentUserId || !senderUserId) {
            return;
        }
        const matchingRows = await notificationRepository
            .queryNotifications({
                userId: currentUserId,
                filters: ['boop']
            })
            .then((items) =>
                (Array.isArray(items) ? items : []).filter(
                    (item) =>
                        item?.type === 'boop' &&
                        !item.expired &&
                        item.link === `user:${senderUserId}`
                )
            );

        await Promise.allSettled(
            matchingRows.map(async (item) => {
                try {
                    await notificationRepository.hideRemoteNotification({
                        id: item.id,
                        version: item.version,
                        type: item.type,
                        senderUserId: item.senderUserId,
                        endpoint
                    });
                } finally {
                    await notificationRepository.expireNotification({
                        userId: currentUserId,
                        id: item.id
                    });
                }
            })
        );
    }

    async function sendBoopReply(notification, emojiId = '') {
        if (!notification?.senderUserId) {
            throw new Error(
                'Cannot send boop: no sender user id is available.'
            );
        }
        await dismissBoopNotifications(notification.senderUserId);
        await notificationRepository.sendBoop({
            userId: notification.senderUserId,
            emojiId,
            endpoint
        });
        await notificationRepository
            .hideRemoteNotification({
                id: notification.id,
                version: notification.version,
                type: notification.type,
                senderUserId: notification.senderUserId,
                endpoint
            })
            .catch(() => {});
        await expireNotificationLocally(notification);
        toast.success(t('view.notification.generated.boop_sent'));
    }

    async function sendNotificationResponse(notification, response) {
        try {
            const responseType = String(response?.type || '').toLowerCase();
            if (response?.type === 'link') {
                openNotificationLink(response.data);
                return;
            }
            if (
                notification.type === 'boop' &&
                (responseType === 'reply' ||
                    responseType === 'boop' ||
                    response?.icon === 'reply')
            ) {
                setBoopReplyRequest(notification);
                return;
            }
            await notificationRepository.sendNotificationResponse({
                id: notification.id,
                responseType: response?.type,
                responseData: response?.data || '',
                endpoint
            });
            await expireNotificationLocally(notification);
            toast.success(t('view.notification.generated.notification_response_sent'));
        } catch (error) {
            if (notification.version >= 2) {
                await expireNotificationLocally(notification);
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.notifications.generated_toast.failed_to_send_notification_response')
            );
        }
    }

    const columns = useMemo(
        () => [
            {
                id: 'created_at',
                accessorFn: (row) =>
                    new Date(getNotificationCreatedAt(row) || 0).valueOf() || 0,
                meta: { label: t('table.notification.date') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.notification.date')}
                    />
                ),
                cell: ({ row }) => {
                    const createdAt = getNotificationCreatedAt(row.original);
                    const shortText = formatDateFilter(createdAt, 'short');
                    const longText = formatDateFilter(createdAt, 'long');
                    return (
                        <div
                            className="text-muted-foreground min-w-32 text-sm"
                            title={longText}
                        >
                            {shortText}
                        </div>
                    );
                }
            },
            {
                id: 'type',
                accessorFn: (row) => String(row?.type || ''),
                meta: { label: t('table.notification.type') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.notification.type')}
                    />
                ),
                cell: ({ row }) => {
                    const notification = row.original;
                    const label = notificationTypeLabel(notification.type);
                    const badge = (
                        <Badge
                            variant={
                                notification.expired ? 'secondary' : 'outline'
                            }
                        >
                            {label}
                        </Badge>
                    );
                    return notificationTypeIsClickable(notification) ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-auto p-0"
                            onClick={() =>
                                openNotificationTypeTarget(notification)
                            }
                        >
                            {badge}
                        </Button>
                    ) : (
                        badge
                    );
                }
            },
            {
                id: 'senderUsername',
                accessorFn: (row) =>
                    String(row?.senderUsername || row?.senderUserId || ''),
                meta: { label: t('table.notification.user') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.notification.user')}
                    />
                ),
                cell: ({ row }) => {
                    const notification = row.original;
                    if (
                        notification.senderUserId &&
                        !notification.senderUserId.startsWith('grp_')
                    ) {
                        return (
                            <Button
                                type="button"
                                variant="ghost"
                                className="h-auto max-w-48 justify-start p-0 text-left font-normal hover:text-primary"
                                onClick={() =>
                                    openUserDialog({
                                        userId: notification.senderUserId,
                                        title:
                                            notification.senderUsername ||
                                            undefined
                                    })
                                }
                            >
                                <span className="truncate">
                                    {notification.senderUsername || 'User'}
                                </span>
                            </Button>
                        );
                    }
                    if (notification.link?.startsWith('user:')) {
                        const userId = notification.link.slice('user:'.length);
                        return (
                            <Button
                                type="button"
                                variant="ghost"
                                className="h-auto max-w-48 justify-start p-0 text-left font-normal hover:text-primary"
                                onClick={() =>
                                    openUserDialog({
                                        userId,
                                        title:
                                            notification.linkText ||
                                            notification.senderUsername ||
                                            undefined
                                    })
                                }
                            >
                                <span className="truncate">
                                    {notification.linkText ||
                                        notification.senderUsername ||
                                        'User'}
                                </span>
                            </Button>
                        );
                    }
                    if (
                        notification.senderUsername &&
                        !notification.senderUserId?.startsWith('grp_')
                    ) {
                        return (
                            <div className="max-w-48 truncate text-sm">
                                {notification.senderUsername}
                            </div>
                        );
                    }
                    return null;
                }
            },
            {
                id: 'groupName',
                accessorFn: (row) => getNotificationGroupColumnLabel(row),
                meta: { label: t('table.notification.group') },
                header: t('table.notification.group'),
                cell: ({ row }) => {
                    const notification = row.original;
                    const label = getNotificationGroupColumnLabel(notification);
                    const groupId = notification.senderUserId?.startsWith(
                        'grp_'
                    )
                        ? notification.senderUserId
                        : notification.link?.startsWith('group:')
                          ? notification.link.slice('group:'.length)
                          : notification.link?.startsWith('event:')
                            ? notification.link
                                  .slice('event:'.length)
                                  .split(',')[0]
                            : '';
                    if (!label) return null;
                    return groupId ? (
                        <Button
                            type="button"
                            variant="ghost"
                            className="h-auto max-w-48 justify-start p-0 text-left font-normal hover:text-primary"
                            onClick={() =>
                                openGroupDialog({ groupId, title: label })
                            }
                        >
                            <span className="truncate">{label}</span>
                        </Button>
                    ) : (
                        <div className="max-w-48 truncate text-sm">{label}</div>
                    );
                }
            },
            {
                id: 'photo',
                enableSorting: false,
                meta: { label: t('table.notification.photo') },
                header: t('table.notification.photo'),
                cell: ({ row }) => {
                    const imageUrl =
                        row.original.details?.imageUrl ||
                        row.original.imageUrl ||
                        '';
                    if (!imageUrl || imageUrl.startsWith('default_'))
                        return null;
                    const previewLabel =
                        getNotificationMessage(row.original) ||
                        t('table.notification.photo');
                    const previewAriaLabel =
                        getNotificationMessage(row.original) || 'photo';
                    return (
                        <Button
                            type="button"
                            variant="ghost"
                            className="h-auto p-1"
                            aria-label={`Preview notification image: ${previewAriaLabel}`}
                            onClick={() =>
                                openNotificationImagePreview(row.original)
                            }
                        >
                            <img
                                src={convertFileUrlToImageUrl(imageUrl, 64)}
                                alt={previewLabel}
                                width={40}
                                height={40}
                                className="size-10 rounded-md object-cover"
                            />
                        </Button>
                    );
                }
            },
            {
                id: 'message',
                accessorFn: (row) => getNotificationMessage(row),
                enableSorting: false,
                meta: { label: t('table.notification.message') },
                header: t('table.notification.message'),
                cell: ({ row }) => {
                    const notification = row.original;
                    const message = getNotificationMessage(notification);
                    const worldId =
                        notification.details?.worldId ||
                        notification.data?.worldId ||
                        notification.location ||
                        '';
                    const notificationLink = notification.link || '';
                    const internalLink =
                        notificationLinkIsInternal(notificationLink);
                    const LinkIcon = getNotificationLinkIcon(notificationLink);
                    return (
                        <div className="flex min-w-0 flex-col gap-1">
                            {message ? (
                                <div className="max-w-xl truncate text-sm">
                                    {message}
                                </div>
                            ) : null}
                            {worldId ? (
                                <NotificationLocationLink
                                    location={worldId}
                                    worldName={
                                        notification.details?.worldName ||
                                        notification.worldName ||
                                        ''
                                    }
                                    groupName={
                                        notification.details?.groupName ||
                                        notification.groupName ||
                                        notification.data?.groupName ||
                                        ''
                                    }
                                />
                            ) : null}
                            {notificationLink ? (
                                <Button
                                    type="button"
                                    variant={internalLink ? 'ghost' : 'link'}
                                    size="sm"
                                    className={cn(
                                        'h-auto max-w-xl justify-start p-0 text-left font-normal',
                                        internalLink && 'hover:text-primary'
                                    )}
                                    onClick={() =>
                                        openNotificationLink(notificationLink)
                                    }
                                >
                                    <LinkIcon data-icon="inline-start" />
                                    <span className="truncate">
                                        {notification.linkText ||
                                            notificationLink}
                                    </span>
                                </Button>
                            ) : null}
                        </div>
                    );
                }
            },
            {
                id: 'action',
                enableSorting: false,
                meta: { label: t('table.notification.action') },
                header: t('table.notification.action'),
                cell: ({ row }) => {
                    const notification = row.original;
                    const remoteActionsVisible =
                        notification.senderUserId !== currentUserId &&
                        !notification.expired;
                    const responses = Array.isArray(notification.responses)
                        ? notification.responses
                        : [];
                    const localDeleteVisible =
                        notification.type !== 'friendRequest' &&
                        notification.type !== 'ignoredFriendRequest';
                    return (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            {remoteActionsVisible &&
                            notification.type === 'friendRequest' ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={"Accept friend request"}
                                    title={t('view.notification.actions.accept')}
                                    onClick={() =>
                                        void acceptFriendRequest(notification)
                                    }
                                >
                                    <CheckIcon data-icon="inline-start" />
                                </Button>
                            ) : null}
                            {remoteActionsVisible &&
                            notification.type === 'requestInvite' &&
                            canInviteFromCurrentLocation ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={"Send invite"}
                                    title={t('view.notification.generated.invite')}
                                    onClick={() =>
                                        void acceptRequestInvite(notification)
                                    }
                                >
                                    <SendIcon data-icon="inline-start" />
                                </Button>
                            ) : null}
                            {remoteActionsVisible &&
                            notification.type === 'invite' ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={"Decline with message"}
                                    title={t('view.notification.actions.decline_with_message')}
                                    onClick={() =>
                                        void sendInviteResponseWithMessage(
                                            notification,
                                            'response'
                                        )
                                    }
                                >
                                    <SendIcon data-icon="inline-start" />
                                </Button>
                            ) : null}
                            {remoteActionsVisible &&
                            notification.type === 'requestInvite' ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={"Decline with message"}
                                    title={t('view.notification.actions.decline_with_message')}
                                    onClick={() =>
                                        void sendInviteResponseWithMessage(
                                            notification,
                                            'requestResponse'
                                        )
                                    }
                                >
                                    <SendIcon data-icon="inline-start" />
                                </Button>
                            ) : null}
                            {remoteActionsVisible
                                ? responses.map((response) => {
                                      const label = getResponseLabel(response);
                                      const ResponseIcon = getResponseIcon(
                                          response,
                                          notification.type
                                      );
                                      return (
                                          <Button
                                              key={`${notification.id}:${response?.type}:${response?.text || response?.data || ''}`}
                                              type="button"
                                              variant="ghost"
                                              size="icon-xs"
                                              aria-label={label}
                                              title={label}
                                              onClick={() =>
                                                  void sendNotificationResponse(
                                                      notification,
                                                      response
                                                  )
                                              }
                                          >
                                              <ResponseIcon data-icon="inline-start" />
                                          </Button>
                                      );
                                  })
                                : null}
                            {remoteActionsVisible &&
                            canDeclineNotification(notification) ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={"Decline notification"}
                                    title={t('view.notification.actions.decline')}
                                    onClick={(event) =>
                                        void hideNotification(notification, {
                                            skipConfirm:
                                                shiftHeld || event.shiftKey
                                        })
                                    }
                                >
                                    <XIcon
                                        data-icon="inline-start"
                                        className={cn(
                                            shiftHeld && 'text-destructive'
                                        )}
                                    />
                                </Button>
                            ) : null}
                            {notification.version === 2 &&
                            !notification.seen ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={"Mark notification seen"}
                                    title={t('view.notification.generated.seen')}
                                    onClick={() => void markSeen(notification)}
                                >
                                    <CheckIcon data-icon="inline-start" />
                                </Button>
                            ) : null}
                            {localDeleteVisible ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={"Delete notification log"}
                                    title={t('view.notification.actions.delete_log')}
                                    onClick={(event) =>
                                        void deleteNotification(notification, {
                                            skipConfirm:
                                                shiftHeld || event.shiftKey
                                        })
                                    }
                                >
                                    {shiftHeld ? (
                                        <XIcon
                                            data-icon="inline-start"
                                            className="text-destructive"
                                        />
                                    ) : (
                                        <Trash2Icon data-icon="inline-start" />
                                    )}
                                </Button>
                            ) : null}
                        </div>
                    );
                }
            },
            {
                id: 'trailing',
                enableSorting: false,
                enableResizing: false,
                header: () => null,
                cell: () => null,
                size: 5
            }
        ],
        [
            canInviteFromCurrentLocation,
            currentInviteLocation,
            currentUserId,
            endpoint,
            notificationTypeLabel,
            shiftHeld,
            t
        ]
    );

    const table = useReactTable({
        data: rows,
        columns,
        state: {
            columnVisibility,
            columnOrder,
            columnSizing,
            sorting,
            pagination
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnOrderChange: setColumnOrder,
        onColumnSizingChange: setColumnSizing,
        onPaginationChange: setPagination,
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        meta: {
            columnOrderLocked,
            setColumnOrderLocked
        }
    });

    return (
        <>
            <div
                className={cn(
                    'flex h-full min-h-0 flex-col gap-3',
                    embedded
                        ? 'p-3'
                        : 'x-container x-container--auto-height p-4 pb-0'
                )}
            >
                <div className="flex flex-wrap items-center gap-2">
                    <NotificationTypeFilterDropdown
                        value={activeTypes}
                        onChange={setActiveTypes}
                        getTypeLabel={notificationTypeLabel}
                    />
                    <Input
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder={t('common.actions.search')}
                        className="h-9 min-w-36 flex-1 sm:max-w-52"
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={"Refresh notifications"}
                        className="rounded-full"
                        disabled={loadStatus === 'running'}
                        onClick={() => setReloadToken((value) => value + 1)}
                    >
                        {loadStatus === 'running' ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <RefreshCcwIcon data-icon="inline-start" />
                        )}
                    </Button>
                    <TableColumnVisibilityMenu table={table} />
                    {activeTypes.length ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setActiveTypes([])}
                        >
                            {t('common.actions.clear')}
                        </Button>
                    ) : null}
                </div>

                {detail ? (
                    <div className="text-muted-foreground text-sm">
                        {userFacingErrorMessage(
                            detail,
                            'Failed to load notifications.'
                        )}
                    </div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
                    <div className="h-full overflow-auto">
                        <Table className="app-data-table table-fixed">
                            <DataTableHeader table={table} />
                            <TableBody>
                                {table.getRowModel().rows.length > 0 ? (
                                    table.getRowModel().rows.map((row) => (
                                        <TableRow key={row.id}>
                                            {row
                                                .getVisibleCells()
                                                .map((cell) => (
                                                    <ResizableTableCell
                                                        key={cell.id}
                                                        cell={cell}
                                                    />
                                                ))}
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell
                                            colSpan={columns.length}
                                            className="text-muted-foreground h-24 text-center"
                                        >
                                            {loadStatus === 'running'
                                                ? 'Loading notifications...'
                                                : 'No VRChat notifications match the current view.'}
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>

                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="text-muted-foreground text-sm">
                        {rows.length} {t('view.notification.generated.notifications_in_view')}
                    </div>
                    <DataTablePagination
                        table={table}
                        pageIndex={pagination.pageIndex}
                        pageCount={table.getPageCount() || 1}
                        pageSize={pagination.pageSize}
                        pageSizes={DEFAULT_PAGE_SIZES}
                        pageSizeLabel={t('table.pagination.rows_per_page')}
                        previousLabel={t('table.pagination.previous')}
                        nextLabel={t('table.pagination.next')}
                        onPageSizeChange={(value) =>
                            setPagination({
                                pageIndex: 0,
                                pageSize: resolvePageSize(value)
                            })
                        }
                    />
                </div>
            </div>
            <InviteMessageDialog
                open={Boolean(inviteResponseRequest)}
                onOpenChange={(open) => {
                    if (!open) {
                        setInviteResponseRequest(null);
                    }
                }}
                currentUserId={currentUserId}
                endpoint={endpoint}
                messageType={inviteResponseRequest?.messageType || 'response'}
                mode="respond"
                targetLabel={
                    inviteResponseRequest?.notification?.senderUsername ||
                    inviteResponseRequest?.notification?.senderUserId ||
                    'this user'
                }
                allowEdit
                allowImageUpload={isLocalUserVrcPlusSupporter}
                onUse={(payload) =>
                    sendInviteResponseSlot({
                        ...payload,
                        notification: inviteResponseRequest?.notification
                    })
                }
            />
            <BoopReplyDialog
                request={boopReplyRequest}
                endpoint={endpoint}
                isLocalUserVrcPlusSupporter={isLocalUserVrcPlusSupporter}
                onOpenChange={(open) => {
                    if (!open) {
                        setBoopReplyRequest(null);
                    }
                }}
                onSend={sendBoopReply}
            />
        </>
    );
}
