import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InviteMessageDialog } from '@/components/dialogs/InviteMessageDialog.jsx';
import { openExternalLink } from '@/lib/entityMedia.js';
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

import { buildNotificationColumns } from './components/NotificationPageColumns.jsx';
import { NotificationPageTable } from './components/NotificationPageTable.jsx';
import { NotificationPageToolbar } from './components/NotificationPageToolbar.jsx';
import { BoopReplyDialog } from './components/NotificationViewParts.jsx';
import {
    buildCachedInstanceMap,
    filterNotificationRows,
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
export function useVrcNotificationPageController({ embedded = false } = {}) {
    const { t } = useTranslation();
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
                    : t(
                          'view.notifications.generated_toast.failed_to_load_notifications'
                      )
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
            openUserDialog({
                userId
            });
            return;
        }
        if (value.startsWith('group:')) {
            const groupId = value.slice('group:'.length);
            openGroupDialog({
                groupId
            });
            return;
        }
        if (value.startsWith('event:')) {
            const [groupId] = value.slice('event:'.length).split(',');
            if (groupId) {
                openGroupDialog({
                    groupId
                });
                return;
            }
        }
        if (value.startsWith('world:')) {
            const worldId = normalizeWorldTarget(value.slice('world:'.length));
            openWorldDialog({
                worldId
            });
            return;
        }
        if (value.startsWith('avatar:')) {
            const avatarId = value.slice('avatar:'.length);
            openAvatarDialog({
                avatarId
            });
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
                    : t(
                          'view.notifications.generated_toast.failed_to_mark_notification_as_seen'
                      )
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
                    title: t(
                        'view.notifications.generated_modal.delete_notification_log_entry'
                    ),
                    description: t(
                        'view.notifications.generated_modal.delete_the_local_value_log_entry',
                        {
                            value: notification.type || 'notification'
                        }
                    ),
                    confirmText: t('common.actions.delete'),
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
            toast.success(
                t('view.notification.generated.notification_log_entry_deleted')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.notifications.generated_toast.failed_to_delete_notification'
                      )
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
                title: t(
                    'view.notifications.generated_modal.accept_friend_request'
                ),
                description: t(
                    'view.notifications.generated_dynamic.accept_the_friend_request_from_value',
                    {
                        value: notification.senderUsername || 'this user'
                    }
                )
            });
            if (!result.ok) {
                return;
            }
            await notificationRepository.acceptFriendRequest({
                id: notification.id,
                endpoint
            });
            await expireNotificationLocally(notification);
            toast.success(
                t('view.notification.generated.friend_request_accepted')
            );
        } catch (error) {
            if (error?.status === 404) {
                await expireNotificationLocally(notification);
                return;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.notifications.generated_toast.failed_to_accept_friend_request'
                      )
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
                    title: t(
                        'view.notifications.generated_modal.decline_notification'
                    ),
                    description: t(
                        'view.notifications.generated_dynamic.decline_the_value_notification',
                        {
                            value: notification.type || 'notification'
                        }
                    ),
                    confirmText: t(
                        'view.notifications.generated_modal.decline'
                    ),
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
            toast.success(
                t('view.notification.generated.notification_declined')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.notifications.generated_toast.failed_to_decline_notification'
                      )
            );
        }
    }
    async function acceptRequestInvite(notification) {
        try {
            if (!currentInviteLocation) {
                toast.error(
                    t(
                        'view.notification.generated.cannot_invite_no_current_vrchat_location_is_available'
                    )
                );
                return;
            }
            if (!canInviteFromCurrentLocation) {
                toast.error(
                    t(
                        'view.notification.generated.cannot_invite_from_the_current_instance_type'
                    )
                );
                return;
            }
            const parsedLocation = parseLocation(currentInviteLocation);
            if (!parsedLocation.worldId || !parsedLocation.instanceId) {
                toast.error(
                    t(
                        'view.notification.generated.cannot_invite_current_location_is_not_a_concrete_instance'
                    )
                );
                return;
            }
            const result = await modalStore.confirm({
                title: t('view.notifications.generated_modal.send_invite'),
                description: t(
                    'view.notifications.generated_dynamic.send_an_invite_to_value',
                    {
                        value: notification.senderUsername || 'this user'
                    }
                )
            });
            if (!result.ok) {
                return;
            }
            const worldResponse = await vrchatSearchRepository.getWorlds(
                {},
                parsedLocation.worldId,
                {
                    endpoint
                }
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
                    : t(
                          'view.notifications.generated_toast.failed_to_send_invite'
                      )
            );
        }
    }
    function sendInviteResponseWithMessage(notification, messageType) {
        if (!currentUserId) {
            toast.error(
                t(
                    'view.notification.generated.cannot_send_invite_response_no_current_user_session_is_avail'
                )
            );
            return;
        }
        setInviteResponseRequest({
            notification,
            messageType
        });
    }
    async function sendInviteResponseSlot({ notification, row, imageData }) {
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
            imageData
                ? t(
                      'view.notifications.generated_toast.invite_response_photo_sent'
                  )
                : t('view.notifications.generated_toast.invite_response_sent')
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
            toast.success(
                t('view.notification.generated.notification_response_sent')
            );
        } catch (error) {
            if (notification.version >= 2) {
                await expireNotificationLocally(notification);
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.notifications.generated_toast.failed_to_send_notification_response'
                      )
            );
        }
    }
    const columns = useMemo(
        () =>
            buildNotificationColumns({
                t,
                currentUserId,
                canInviteFromCurrentLocation,
                notificationTypeLabel,
                shiftHeld,
                onOpenTypeTarget: openNotificationTypeTarget,
                isTypeClickable: notificationTypeIsClickable,
                onOpenUser: openUserDialog,
                onOpenGroup: openGroupDialog,
                onOpenNotificationLink: openNotificationLink,
                onOpenNotificationImagePreview: openNotificationImagePreview,
                onAcceptFriendRequest: acceptFriendRequest,
                onAcceptRequestInvite: acceptRequestInvite,
                onSendInviteResponseWithMessage: sendInviteResponseWithMessage,
                onSendNotificationResponse: sendNotificationResponse,
                onHideNotification: hideNotification,
                onMarkSeen: markSeen,
                onDeleteNotification: deleteNotification
            }),
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
    return {
        cn,
        embedded,
        NotificationPageToolbar,
        activeTypes,
        searchQuery,
        notificationTypeLabel,
        loadStatus,
        table,
        setActiveTypes,
        setSearchQuery,
        setReloadToken,
        t,
        NotificationPageTable,
        detail,
        rows,
        pagination,
        DEFAULT_PAGE_SIZES,
        setPagination,
        resolvePageSize,
        InviteMessageDialog,
        inviteResponseRequest,
        setInviteResponseRequest,
        currentUserId,
        endpoint,
        isLocalUserVrcPlusSupporter,
        sendInviteResponseSlot,
        BoopReplyDialog,
        boopReplyRequest,
        setBoopReplyRequest,
        sendBoopReply
    };
}
