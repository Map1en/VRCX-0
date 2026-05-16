// @ts-nocheck
import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { LoadingState } from '@/components/layout/PageScaffold';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { cn } from '@/lib/utils.js';
import {
    avatarProfileRepository,
    configRepository,
    mediaRepository,
    myAvatarRepository
} from '@/repositories/index.js';
import {
    getTablePageSizePreference,
    getTablePageSizesPreference
} from '@/services/preferencesService.js';
import {
    IMAGE_UPLOAD_ACCEPT,
    readFileAsBase64,
    validateImageUploadFile,
    withUploadTimeout
} from '@/shared/utils/imageUpload.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Input } from '@/ui/shadcn/input';

import { buildMyAvatarsColumns } from './components/MyAvatarsColumns';
import { MyAvatarsDialogs } from './components/MyAvatarsDialogs';
import { MyAvatarsGridView } from './components/MyAvatarsGridView';
import { MyAvatarsTableView } from './components/MyAvatarsTableView';
import { MyAvatarsToolbar } from './components/MyAvatarsToolbar';
import {
    MyAvatarsEmptyState,
    openAvatarDetails
} from './components/MyAvatarsViewParts';
import { collectMyAvatarTags, filterMyAvatars } from './myAvatarsFilters.js';
import {
    MY_AVATARS_DEFAULT_CARD_SCALE,
    MY_AVATARS_DEFAULT_COLUMN_VISIBILITY,
    MY_AVATARS_GRID_DENSITY_CONFIG_KEY,
    MY_AVATARS_LEGACY_GRID_DENSITY_CONFIG_KEY,
    MY_AVATARS_DEFAULT_PAGE_SIZES,
    MY_AVATARS_VIEW_MODES,
    readPersistedMyAvatarsState,
    resolveMyAvatarsColumnVisibility,
    resolveMyAvatarsGridDensity,
    resolveMyAvatarsPageSize,
    sanitizeMyAvatarsColumnOrder,
    sanitizeMyAvatarsColumnSizing,
    sanitizeMyAvatarsColumnVisibility,
    sanitizeMyAvatarsGridDensity,
    sanitizeMyAvatarsPageSizes,
    sanitizeMyAvatarsSorting,
    writePersistedMyAvatarsState
} from './myAvatarsState.js';
import { useMyAvatarsGridVirtualization } from './useMyAvatarsGridVirtualization.js';
import { useMyAvatarsPageActions } from './useMyAvatarsPageActions.js';
function isRuntimeAuthTarget(authTarget) {
    const runtimeAuth = useRuntimeStore.getState().auth;
    return (
        runtimeAuth.currentUserId === authTarget.currentUserId &&
        runtimeAuth.currentUserEndpoint === authTarget.currentEndpoint
    );
}

function resolveTableColumnOrder(columnOrder) {
    const ordered = sanitizeMyAvatarsColumnOrder(columnOrder);
    return [...ordered.filter((columnId) => columnId !== 'actions'), 'actions'];
}
export function useMyAvatarsPageController({ embedded = false } = {}) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const confirm = useModalStore((state) => state.confirm);
    const currentAvatarId = currentUserSnapshot?.currentAvatar || '';
    const previousAvatarSwapTime =
        Number(currentUserSnapshot?.$previousAvatarSwapTime) || 0;
    const [persistedState] = useState(() => readPersistedMyAvatarsState());
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenPageSizeRef = useRef(false);
    const hasWrittenTableStateRef = useRef(false);
    const requestIdRef = useRef(0);
    const imageUploadInputRef = useRef(null);
    const imageUploadAvatarRef = useRef(null);
    const imageUploadAuthTargetRef = useRef(null);
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const tablePageSizesPreference = usePreferencesStore(
        (state) => state.tablePageSizes
    );
    const [avatars, setAvatars] = useState([]);
    const [loadStatus, setLoadStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [viewMode, setViewMode] = useState('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const [releaseStatusFilter, setReleaseStatusFilter] = useState('all');
    const [platformFilter, setPlatformFilter] = useState('all');
    const [tagFilters, setTagFilters] = useState(() => new Set());
    const [gridDensity, setGridDensity] = useState(() =>
        resolveMyAvatarsGridDensity()
    );
    const [pageSizes, setPageSizes] = useState(MY_AVATARS_DEFAULT_PAGE_SIZES);
    const [refreshToken, setRefreshToken] = useState(0);
    const [editDetailsAvatar, setEditDetailsAvatar] = useState(null);
    const [contentTagsAvatar, setContentTagsAvatar] = useState(null);
    const [manageTagsAvatar, setManageTagsAvatar] = useState(null);
    const [imageCropRequest, setImageCropRequest] = useState(null);
    const [savingTagsAvatarId, setSavingTagsAvatarId] = useState('');
    const [updatingAvatarId, setUpdatingAvatarId] = useState('');
    const [uploadingImageAvatarId, setUploadingImageAvatarId] = useState('');
    const [sorting, setSorting] = useState(() =>
        sanitizeMyAvatarsSorting(persistedState.sorting)
    );
    const [columnVisibility, setColumnVisibility] = useState(() =>
        resolveMyAvatarsColumnVisibility(persistedState)
    );
    const [columnOrder, setColumnOrder] = useState(() =>
        sanitizeMyAvatarsColumnOrder(persistedState.columnOrder)
    );
    const [columnSizing, setColumnSizing] = useState(() =>
        sanitizeMyAvatarsColumnSizing(persistedState.columnSizing)
    );
    const [columnOrderLocked, setColumnOrderLocked] = useState(
        () => persistedState.columnOrderLocked === true
    );
    const [pagination, setPagination] = useState(() => ({
        pageIndex: 0,
        pageSize: resolveMyAvatarsPageSize(
            persistedState.pageSize,
            MY_AVATARS_DEFAULT_PAGE_SIZES,
            MY_AVATARS_DEFAULT_PAGE_SIZES[1]
        )
    }));
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const {
        handleSaveAvatarTags,
        applyAvatarUpdate,
        handleAvatarAction,
        onAvatarImageFileChange,
        confirmAvatarImageUpload,
        handleViewModeChange
    } = useMyAvatarsPageActions({
        avatarProfileRepository,
        avatars,
        configRepository,
        confirm,
        currentAvatarId,
        currentEndpoint,
        currentUserId,
        imageCropRequest,
        imageUploadAuthTargetRef,
        imageUploadAvatarRef,
        imageUploadInputRef,
        isRuntimeAuthTarget,
        mediaRepository,
        myAvatarRepository,
        openAvatarDetails,
        readFileAsBase64,
        setAvatars,
        setContentTagsAvatar,
        setDetail,
        setEditDetailsAvatar,
        setImageCropRequest,
        setManageTagsAvatar,
        setSavingTagsAvatarId,
        setUpdatingAvatarId,
        setUploadingImageAvatarId,
        setViewMode,
        t,
        toast,
        validateImageUploadFile,
        withUploadTimeout
    });
    useEffect(() => {
        let active = true;
        Promise.all([
            getTablePageSizesPreference(MY_AVATARS_DEFAULT_PAGE_SIZES),
            getTablePageSizePreference(20),
            configRepository.getString('MyAvatarsViewMode', 'grid'),
            configRepository.getString(MY_AVATARS_GRID_DENSITY_CONFIG_KEY, ''),
            configRepository.getString(
                MY_AVATARS_LEGACY_GRID_DENSITY_CONFIG_KEY,
                ''
            ),
            configRepository.getString(
                'VRCX_MyAvatarsCardScale',
                String(MY_AVATARS_DEFAULT_CARD_SCALE)
            )
        ])
            .then(
                ([
                    nextPageSizes,
                    nextPageSize,
                    nextViewMode,
                    nextGridDensity,
                    nextLegacyGridDensity,
                    nextLegacyCardScale
                ]) => {
                    if (!active) {
                        return;
                    }
                    const resolvedPageSizes =
                        sanitizeMyAvatarsPageSizes(nextPageSizes);
                    const parsedPersistedPageSize = Number.parseInt(
                        persistedState.pageSize,
                        10
                    );
                    const hasPersistedPageSize =
                        Number.isFinite(parsedPersistedPageSize) &&
                        parsedPersistedPageSize > 0;
                    const resolvedConfiguredPageSize = resolveMyAvatarsPageSize(
                        nextPageSize,
                        resolvedPageSizes,
                        MY_AVATARS_DEFAULT_PAGE_SIZES[1]
                    );
                    const resolvedActivePageSize = hasPersistedPageSize
                        ? resolveMyAvatarsPageSize(
                              parsedPersistedPageSize,
                              resolvedPageSizes,
                              resolvedConfiguredPageSize
                          )
                        : resolvedConfiguredPageSize;
                    setPageSizes(resolvedPageSizes);
                    setPagination((current) => ({
                        ...current,
                        pageSize: resolvedActivePageSize
                    }));
                    setViewMode(
                        MY_AVATARS_VIEW_MODES.includes(nextViewMode)
                            ? nextViewMode
                            : 'grid'
                    );
                    setGridDensity(
                        resolveMyAvatarsGridDensity({
                            persistedDensity: nextGridDensity,
                            legacyGridDensity: nextLegacyGridDensity,
                            legacyCardScale: nextLegacyCardScale
                        })
                    );
                }
            )
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [persistedState.pageSize]);
    useEffect(() => {
        if (!preferencesHydrated) {
            return;
        }
        const resolvedPageSizes = sanitizeMyAvatarsPageSizes(
            tablePageSizesPreference
        );
        setPageSizes(resolvedPageSizes);
        setPagination((current) => {
            const pageSize = resolveMyAvatarsPageSize(
                current.pageSize,
                resolvedPageSizes
            );
            return pageSize === current.pageSize
                ? current
                : {
                      ...current,
                      pageSize
                  };
        });
    }, [preferencesHydrated, tablePageSizesPreference]);
    useEffect(() => {
        if (!hasWrittenSortingRef.current) {
            hasWrittenSortingRef.current = true;
            return;
        }
        writePersistedMyAvatarsState({
            sorting: sanitizeMyAvatarsSorting(sorting)
        });
    }, [sorting]);
    useEffect(() => {
        if (!hasWrittenPageSizeRef.current) {
            hasWrittenPageSizeRef.current = true;
            return;
        }
        writePersistedMyAvatarsState({
            pageSize: pagination.pageSize
        });
    }, [pagination.pageSize]);
    useEffect(() => {
        if (!hasWrittenTableStateRef.current) {
            hasWrittenTableStateRef.current = true;
            return;
        }
        writePersistedMyAvatarsState({
            columnVisibility:
                sanitizeMyAvatarsColumnVisibility(columnVisibility),
            columnOrder: sanitizeMyAvatarsColumnOrder(columnOrder),
            columnSizing: sanitizeMyAvatarsColumnSizing(columnSizing),
            columnOrderLocked
        });
    }, [columnOrder, columnOrderLocked, columnSizing, columnVisibility]);
    useEffect(() => {
        setPagination((current) => ({
            ...current,
            pageIndex: 0
        }));
    }, [
        deferredSearchQuery,
        platformFilter,
        releaseStatusFilter,
        tagFilters,
        viewMode
    ]);
    function handleGridDensityChange(value) {
        const nextDensity = sanitizeMyAvatarsGridDensity(value);
        setGridDensity(nextDensity);
        void configRepository.setString(
            MY_AVATARS_GRID_DENSITY_CONFIG_KEY,
            nextDensity
        );
    }
    useEffect(() => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        if (!currentUserId) {
            setAvatars([]);
            setLoadStatus('idle');
            setDetail(
                t(
                    'view.my_avatars.empty.no_authenticated_user_is_available_for_the_avatar_inventory'
                )
            );
            return;
        }
        setLoadStatus('running');
        setDetail('');
        myAvatarRepository
            .getMyAvatars({
                endpoint: currentEndpoint,
                currentUserId,
                currentAvatarId,
                previousAvatarSwapTime
            })
            .then((nextAvatars) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                setAvatars(Array.isArray(nextAvatars) ? nextAvatars : []);
                setLoadStatus('ready');
                setDetail('');
            })
            .catch((error) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }
                console.warn('Avatar inventory failed to load:', error);
                setAvatars([]);
                setLoadStatus('error');
                setDetail(
                    userFacingErrorMessage(
                        error,
                        t(
                            'view.my_avatars.error.avatar_inventory_failed_to_load'
                        )
                    )
                );
            });
    }, [
        currentAvatarId,
        currentEndpoint,
        currentUserId,
        previousAvatarSwapTime,
        refreshToken
    ]);
    const allTags = useMemo(() => collectMyAvatarTags(avatars), [avatars]);
    const filteredAvatars = useMemo(() => {
        return filterMyAvatars({
            avatars,
            searchQuery: deferredSearchQuery,
            platformFilter,
            releaseStatusFilter,
            tagFilters
        });
    }, [
        avatars,
        deferredSearchQuery,
        platformFilter,
        releaseStatusFilter,
        tagFilters
    ]);
    useEffect(() => {
        const maxPageIndex = Math.max(
            0,
            Math.ceil(filteredAvatars.length / pagination.pageSize) - 1
        );
        if (pagination.pageIndex > maxPageIndex) {
            setPagination((current) => ({
                ...current,
                pageIndex: maxPageIndex
            }));
        }
    }, [filteredAvatars.length, pagination.pageIndex, pagination.pageSize]);
    const columns = useMemo(
        () =>
            buildMyAvatarsColumns({
                currentAvatarId,
                onAvatarAction: handleAvatarAction,
                savingTagsAvatarId,
                t,
                updatingAvatarId,
                uploadingImageAvatarId
            }),
        [
            currentAvatarId,
            handleAvatarAction,
            savingTagsAvatarId,
            t,
            updatingAvatarId,
            uploadingImageAvatarId
        ]
    );
    const tableColumnOrder = useMemo(
        () => resolveTableColumnOrder(columnOrder),
        [columnOrder]
    );
    function handleColumnOrderChange(updater) {
        setColumnOrder((current) =>
            resolveTableColumnOrder(
                typeof updater === 'function'
                    ? updater(resolveTableColumnOrder(current))
                    : updater
            )
        );
    }
    const table = useReactTable({
        data: filteredAvatars,
        columns,
        state: {
            sorting,
            pagination,
            columnVisibility,
            columnOrder: tableColumnOrder,
            columnSizing
        },
        onSortingChange: setSorting,
        onPaginationChange: setPagination,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnOrderChange: handleColumnOrderChange,
        onColumnSizingChange: setColumnSizing,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        initialState: {
            columnVisibility: MY_AVATARS_DEFAULT_COLUMN_VISIBILITY
        },
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        meta: {
            columnOrderLocked,
            setColumnOrderLocked
        }
    });
    const {
        densityConfig,
        gridGap,
        gridColumnCount,
        gridMinWidth,
        gridScrollRef,
        gridTotalHeight,
        visibleGridRows
    } = useMyAvatarsGridVirtualization({
        deferredSearchQuery,
        filteredAvatars,
        gridDensity,
        platformFilter,
        releaseStatusFilter,
        tagFilters,
        viewMode
    });
    const isLoading = loadStatus === 'running' && avatars.length === 0;
    const isError = loadStatus === 'error' && avatars.length === 0;
    const hasRows = filteredAvatars.length > 0;
    const activeFilterCount =
        (releaseStatusFilter !== 'all' ? 1 : 0) +
        (platformFilter !== 'all' ? 1 : 0) +
        tagFilters.size;
    return {
        cn,
        embedded,
        Input,
        imageUploadInputRef,
        IMAGE_UPLOAD_ACCEPT,
        onAvatarImageFileChange,
        MyAvatarsToolbar,
        t,
        viewMode,
        activeFilterCount,
        allTags,
        releaseStatusFilter,
        platformFilter,
        tagFilters,
        loadStatus,
        searchQuery,
        gridDensity,
        table,
        currentUserId,
        handleViewModeChange,
        setReleaseStatusFilter,
        setPlatformFilter,
        setTagFilters,
        setSearchQuery,
        handleGridDensityChange,
        setRefreshToken,
        detail,
        userFacingErrorMessage,
        isLoading,
        LoadingState,
        isError,
        MyAvatarsEmptyState,
        hasRows,
        MyAvatarsTableView,
        currentAvatarId,
        savingTagsAvatarId,
        updatingAvatarId,
        uploadingImageAvatarId,
        filteredAvatars,
        pageSizes,
        pagination,
        handleAvatarAction,
        resolveMyAvatarsPageSize,
        setPagination,
        MyAvatarsGridView,
        densityConfig,
        gridScrollRef,
        gridTotalHeight,
        visibleGridRows,
        gridGap,
        gridColumnCount,
        gridMinWidth,
        MyAvatarsDialogs,
        editDetailsAvatar,
        contentTagsAvatar,
        imageCropRequest,
        manageTagsAvatar,
        currentEndpoint,
        setEditDetailsAvatar,
        setContentTagsAvatar,
        setImageCropRequest,
        imageUploadAvatarRef,
        imageUploadAuthTargetRef,
        confirmAvatarImageUpload,
        setManageTagsAvatar,
        handleSaveAvatarTags,
        applyAvatarUpdate,
        setDetail
    };
}
