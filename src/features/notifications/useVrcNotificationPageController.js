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
import { useVrcNotificationPageActions } from './useVrcNotificationPageActions.js';
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
    const {
        openNotificationLink,
        openNotificationTypeTarget,
        notificationTypeIsClickable,
        openNotificationImagePreview,
        markSeen,
        deleteNotification,
        acceptFriendRequest,
        hideNotification,
        acceptRequestInvite,
        sendInviteResponseWithMessage,
        sendInviteResponseSlot,
        sendBoopReply,
        sendNotificationResponse
    } = useVrcNotificationPageActions({
        canInviteFromCurrentLocation,
        convertFileUrlToImageUrl,
        currentInviteLocation,
        currentUserId,
        endpoint,
        modalStore,
        normalizeWorldTarget,
        notificationRepository,
        openAvatarDialog,
        openExternalLink,
        openGroupDialog,
        openUserDialog,
        openWorldDialog,
        parseLocation,
        setBoopReplyRequest,
        setInviteResponseRequest,
        setReloadToken,
        t,
        toast,
        vrchatSearchRepository,
        withUploadTimeout
    });
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
