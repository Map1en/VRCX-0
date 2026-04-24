import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { LoadingState } from '@/components/layout/PageScaffold.jsx';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { cn } from '@/lib/utils.js';
import {
    avatarProfileRepository,
    configRepository,
    mediaRepository,
    myAvatarRepository
} from '@/repositories/index.js';
import { getTablePageSizesPreference } from '@/services/preferencesService.js';
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

import {
    collectMyAvatarTags,
    filterMyAvatars
} from './myAvatarsFilters.js';
import {
    MY_AVATARS_DEFAULT_CARD_SCALE,
    MY_AVATARS_DEFAULT_CARD_SPACING,
    MY_AVATARS_DEFAULT_PAGE_SIZES,
    MY_AVATARS_VIEW_MODES,
    readPersistedMyAvatarsState,
    resolveMyAvatarsPageSize,
    sanitizeMyAvatarsCardScale,
    sanitizeMyAvatarsCardSpacing,
    sanitizeMyAvatarsColumnOrder,
    sanitizeMyAvatarsColumnSizing,
    sanitizeMyAvatarsColumnVisibility,
    sanitizeMyAvatarsPageSizes,
    sanitizeMyAvatarsSorting,
    writePersistedMyAvatarsState
} from './myAvatarsState.js';
import { appI18n } from '@/services/i18nService.js';
import {
    MyAvatarsEmptyState,
    openAvatarDetails
} from './components/MyAvatarsViewParts.jsx';
import { buildMyAvatarsColumns } from './components/MyAvatarsColumns.jsx';
import { MyAvatarsToolbar } from './components/MyAvatarsToolbar.jsx';
import { MyAvatarsTableView } from './components/MyAvatarsTableView.jsx';
import { MyAvatarsGridView } from './components/MyAvatarsGridView.jsx';
import { MyAvatarsDialogs } from './components/MyAvatarsDialogs.jsx';
import { useMyAvatarsGridVirtualization } from './useMyAvatarsGridVirtualization.js';

function isRuntimeAuthTarget(authTarget) {
    const runtimeAuth = useRuntimeStore.getState().auth;
    return (
        runtimeAuth.currentUserId === authTarget.currentUserId &&
        runtimeAuth.currentUserEndpoint === authTarget.currentEndpoint
    );
}

export function MyAvatarsPage({ embedded = false } = {}) {
    const { t } = useI18n();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);

    const currentAvatarId = currentUserSnapshot?.currentAvatar || '';
    const previousAvatarSwapTime =
        Number(currentUserSnapshot?.$previousAvatarSwapTime) || 0;

    const persistedState = useMemo(() => readPersistedMyAvatarsState(), []);
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
    const [cardScale, setCardScale] = useState(MY_AVATARS_DEFAULT_CARD_SCALE);
    const [cardSpacing, setCardSpacing] = useState(
        MY_AVATARS_DEFAULT_CARD_SPACING
    );
    const [pageSizes, setPageSizes] = useState(MY_AVATARS_DEFAULT_PAGE_SIZES);
    const [refreshToken, setRefreshToken] = useState(0);
    const [manageTagsAvatar, setManageTagsAvatar] = useState(null);
    const [stylesAvatar, setStylesAvatar] = useState(null);
    const [imageCropRequest, setImageCropRequest] = useState(null);
    const [savingTagsAvatarId, setSavingTagsAvatarId] = useState('');
    const [updatingAvatarId, setUpdatingAvatarId] = useState('');
    const [uploadingImageAvatarId, setUploadingImageAvatarId] = useState('');
    const [sorting, setSorting] = useState(() =>
        sanitizeMyAvatarsSorting(persistedState.sorting)
    );
    const [columnVisibility, setColumnVisibility] = useState(() =>
        sanitizeMyAvatarsColumnVisibility(persistedState.columnVisibility)
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

    async function handleSaveAvatarTags({ avatarId, tags }) {
        const avatar = avatars.find((entry) => entry.id === avatarId);
        const previousTags = avatar?.$tags || [];

        setSavingTagsAvatarId(avatarId);
        try {
            const nextTags = await myAvatarRepository.updateAvatarTags({
                avatarId,
                previousTags,
                nextTags: tags
            });

            setAvatars((currentAvatars) =>
                currentAvatars.map((entry) =>
                    entry.id === avatarId
                        ? {
                              ...entry,
                              $tags: nextTags
                          }
                        : entry
                )
            );
            setManageTagsAvatar(null);
            setDetail(appI18n.t('view.my_avatars.generated_dynamic.updated_local_tags_for_value', { value: avatar?.name || avatarId }));
        } catch (error) {
            setDetail(
                error instanceof Error
                    ? error.message
                    : t('view.my_avatars.generated_toast.failed_to_update_avatar_tags')
            );
        } finally {
            setSavingTagsAvatarId('');
        }
    }

    function applyAvatarUpdate(nextAvatar) {
        if (!nextAvatar?.id) {
            return;
        }

        setAvatars((currentAvatars) =>
            currentAvatars.map((entry) =>
                entry.id === nextAvatar.id
                    ? {
                          ...entry,
                          ...nextAvatar,
                          $tags: entry.$tags || [],
                          $timeSpent: entry.$timeSpent || 0
                      }
                    : entry
            )
        );
    }

    async function saveAvatarPatch(avatar, params, successMessage) {
        const avatarId = typeof avatar?.id === 'string' ? avatar.id.trim() : '';
        if (!avatarId || !currentUserId) {
            return;
        }

        const authTarget = {
            currentUserId,
            currentEndpoint: currentEndpoint || ''
        };

        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }

        setUpdatingAvatarId(avatarId);

        try {
            const nextAvatar = await myAvatarRepository.saveAvatar({
                avatarId,
                endpoint: currentEndpoint,
                params
            });
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }

            applyAvatarUpdate(nextAvatar);
            setDetail(successMessage);
            toast.success(successMessage);
        } catch (error) {
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }

            const message =
                error instanceof Error
                    ? error.message
                    : t('view.my_avatars.generated_toast.failed_to_update_avatar');
            setDetail(message);
            toast.error(message);
        } finally {
            setUpdatingAvatarId((current) =>
                current === avatarId ? '' : current
            );
        }
    }

    async function renameAvatar(avatar) {
        const result = await prompt({
            title: appI18n.t('view.my_avatars.generated_modal.rename_avatar'),
            description: avatar?.name || avatar?.id || '',
            inputValue: avatar?.name || '',
            confirmText: appI18n.t('view.my_avatars.generated_modal.rename'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        const nextName = String(result.value || '').trim();
        if (!nextName || nextName === avatar?.name) {
            return;
        }

        await saveAvatarPatch(
            avatar,
            { name: nextName },
            t('view.my_avatars.generated.avatar_renamed')
        );
    }

    async function changeAvatarDescription(avatar) {
        const result = await prompt({
            title: appI18n.t('view.my_avatars.generated_modal.change_avatar_description'),
            description: avatar?.name || avatar?.id || '',
            inputValue: avatar?.description || '',
            confirmText: appI18n.t('common.actions.save'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        const nextDescription = String(result.value || '').trim();
        if (nextDescription === (avatar?.description || '')) {
            return;
        }

        await saveAvatarPatch(
            avatar,
            { description: nextDescription },
            t('view.my_avatars.generated.avatar_description_updated')
        );
    }

    async function wearAvatar(avatar) {
        const avatarId = typeof avatar?.id === 'string' ? avatar.id.trim() : '';
        if (!avatarId || !currentUserId || avatarId === currentAvatarId) {
            return;
        }

        const shouldConfirm = await configRepository.getBool(
            'showConfirmationOnSwitchAvatar',
            true
        );
        if (shouldConfirm) {
            const result = await confirm({
                title: appI18n.t('common.actions.confirm'),
                description: appI18n.t('view.my_avatars.generated_modal.select_avatar_value', { value: avatar?.name || avatarId }),
                confirmText: appI18n.t('common.actions.select'),
                cancelText: appI18n.t('common.actions.cancel')
            });
            if (!result.ok) {
                return;
            }
        }

        const authTarget = {
            currentUserId,
            currentEndpoint: currentEndpoint || ''
        };
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }

        setUpdatingAvatarId(avatarId);
        try {
            await avatarProfileRepository.selectAvatar({
                avatarId,
                endpoint: currentEndpoint
            });
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            setDetail(appI18n.t('view.my_avatars.generated_dynamic.selected_avatar_value', { value: avatar?.name || avatarId }));
            toast.success(t('view.my_avatars.generated.avatar_selected'));
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                const message =
                    error instanceof Error
                        ? error.message
                        : t('view.my_avatars.generated_toast.failed_to_select_avatar');
                setDetail(message);
                toast.error(message);
            }
        } finally {
            setUpdatingAvatarId((current) =>
                current === avatarId ? '' : current
            );
        }
    }

    async function toggleAvatarReleaseStatus(avatar) {
        const nextReleaseStatus =
            avatar?.releaseStatus === 'public' ? 'private' : 'public';
        const result = await confirm({
            title:
                nextReleaseStatus === 'public'
                    ? t('view.my_avatars.generated_modal.make_avatar_public')
                    : t('view.my_avatars.generated_modal.make_avatar_private'),
            description: avatar?.name || avatar?.id || '',
            confirmText:
                nextReleaseStatus === 'public'
                    ? t('view.my_avatars.generated.make_public')
                    : t('view.my_avatars.generated.make_private'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        await saveAvatarPatch(
            avatar,
            { releaseStatus: nextReleaseStatus },
            nextReleaseStatus === 'public'
                ? t('view.my_avatars.generated.avatar_made_public')
                : t('view.my_avatars.generated.avatar_made_private')
        );
    }

    function openAvatarContentTags(avatar) {
        openAvatarDetails(avatar);
    }

    function openAvatarStyles(avatar) {
        if (!avatar?.id) {
            return;
        }
        setStylesAvatar(avatar);
    }

    async function createAvatarImpostor(avatar) {
        const avatarId = typeof avatar?.id === 'string' ? avatar.id.trim() : '';
        if (!avatarId || !currentUserId) {
            return;
        }

        const result = await confirm({
            title: appI18n.t('view.my_avatars.generated_modal.create_impostor'),
            description: avatar?.name || avatarId,
            confirmText: appI18n.t('view.my_avatars.generated_modal.create'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        const authTarget = {
            currentUserId,
            currentEndpoint: currentEndpoint || ''
        };

        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }

        setUpdatingAvatarId(avatarId);
        try {
            await myAvatarRepository.createImpostor({
                avatarId,
                endpoint: currentEndpoint
            });
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            setDetail(t('view.my_avatars.generated.impostor_queued_for_creation'));
            toast.success(t('view.my_avatars.generated.impostor_queued_for_creation'));
        } catch (error) {
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            const message =
                error instanceof Error
                    ? error.message
                    : t('view.my_avatars.generated_toast.failed_to_create_impostor');
            setDetail(message);
            toast.error(message);
        } finally {
            setUpdatingAvatarId((current) =>
                current === avatarId ? '' : current
            );
        }
    }

    function beginAvatarImageUpload(avatar) {
        const avatarId = typeof avatar?.id === 'string' ? avatar.id.trim() : '';
        if (!avatarId || !currentUserId) {
            return;
        }

        imageUploadAvatarRef.current = avatar;
        imageUploadAuthTargetRef.current = {
            currentUserId,
            currentEndpoint: currentEndpoint || ''
        };
        imageUploadInputRef.current?.click();
    }

    async function handleAvatarAction(action, avatar) {
        switch (action) {
            case 'details':
                openAvatarDetails(avatar);
                break;
            case 'wear':
                await wearAvatar(avatar);
                break;
            case 'manageTags':
                setManageTagsAvatar(avatar);
                break;
            case 'makePrivate':
            case 'makePublic':
                await toggleAvatarReleaseStatus(avatar);
                break;
            case 'rename':
                await renameAvatar(avatar);
                break;
            case 'changeDescription':
                await changeAvatarDescription(avatar);
                break;
            case 'changeTags':
                openAvatarContentTags(avatar);
                break;
            case 'changeStyles':
                openAvatarStyles(avatar);
                break;
            case 'changeImage':
                beginAvatarImageUpload(avatar);
                break;
            case 'createImpostor':
                await createAvatarImpostor(avatar);
                break;
        }
    }

    function showImageValidationError(validation) {
        if (validation.reason === 'too_large') {
            toast.error(t('view.my_avatars.generated.selected_image_is_too_large'));
        } else if (validation.reason === 'not_image') {
            toast.error(t('view.my_avatars.generated.selected_file_is_not_an_image'));
        }
    }

    async function onAvatarImageFileChange(event) {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        if (!file) {
            return;
        }

        const avatar = imageUploadAvatarRef.current;
        const avatarId = typeof avatar?.id === 'string' ? avatar.id.trim() : '';
        const authTarget = imageUploadAuthTargetRef.current;
        if (!avatarId || !authTarget || !isRuntimeAuthTarget(authTarget)) {
            return;
        }

        const validation = validateImageUploadFile(file);
        if (!validation.ok) {
            showImageValidationError(validation);
            return;
        }

        setImageCropRequest({
            file,
            avatar,
            authTarget
        });
    }

    async function confirmAvatarImageUpload(blob) {
        const request = imageCropRequest;
        const avatar = request?.avatar;
        const avatarId = typeof avatar?.id === 'string' ? avatar.id.trim() : '';
        const authTarget = request?.authTarget;
        if (
            !blob ||
            !avatarId ||
            !authTarget ||
            !isRuntimeAuthTarget(authTarget)
        ) {
            return;
        }

        setUploadingImageAvatarId(avatarId);

        try {
            const base64Body = await readFileAsBase64(blob);
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }

            const base64File =
                await mediaRepository.resizeImageToFitLimits(base64Body);
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }

            const result = await withUploadTimeout(
                mediaRepository.uploadAvatarImageLegacy({
                    avatarId,
                    imageUrl: avatar.imageUrl || avatar.thumbnailImageUrl || '',
                    base64File,
                    blob,
                    endpoint: currentEndpoint
                })
            );
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }

            applyAvatarUpdate(result.avatar);
            setDetail(appI18n.t('view.my_avatars.generated_dynamic.avatar_image_updated_for_value', { value: avatar?.name || avatarId }));
            toast.success(t('view.my_avatars.generated.avatar_image_updated'));
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                const message =
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.my_avatars.generated_toast.failed_to_upload_avatar_image'
                          );
                setDetail(message);
                toast.error(message);
            }
        } finally {
            imageUploadAvatarRef.current = null;
            imageUploadAuthTargetRef.current = null;
            setImageCropRequest(null);
            setUploadingImageAvatarId((current) =>
                current === avatarId ? '' : current
            );
        }
    }

    useEffect(() => {
        let active = true;

        Promise.all([
            getTablePageSizesPreference(MY_AVATARS_DEFAULT_PAGE_SIZES),
            configRepository.getInt(
                'tablePageSize',
                MY_AVATARS_DEFAULT_PAGE_SIZES[1]
            ),
            configRepository.getString('MyAvatarsViewMode', 'grid'),
            configRepository.getString(
                'VRCX_MyAvatarsCardScale',
                String(MY_AVATARS_DEFAULT_CARD_SCALE)
            ),
            configRepository.getString(
                'VRCX_MyAvatarsCardSpacing',
                String(MY_AVATARS_DEFAULT_CARD_SPACING)
            )
        ])
            .then(
                ([
                    nextPageSizes,
                    nextPageSize,
                    nextViewMode,
                    nextCardScale,
                    nextCardSpacing
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

                    setPageSizes((current) =>
                        sanitizeMyAvatarsPageSizes([
                            ...current,
                            ...resolvedPageSizes,
                            resolvedConfiguredPageSize,
                            resolvedActivePageSize
                        ])
                    );

                    setPagination((current) => ({
                        ...current,
                        pageSize: resolvedActivePageSize
                    }));

                    setViewMode(
                        MY_AVATARS_VIEW_MODES.includes(nextViewMode)
                            ? nextViewMode
                            : 'grid'
                    );
                    setCardScale(sanitizeMyAvatarsCardScale(nextCardScale));
                    setCardSpacing(
                        sanitizeMyAvatarsCardSpacing(nextCardSpacing)
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
        setPagination((current) => ({
            ...current,
            pageIndex: 0,
            pageSize: resolveMyAvatarsPageSize(
                current.pageSize,
                resolvedPageSizes
            )
        }));
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

    useEffect(() => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;

        if (!currentUserId) {
            setAvatars([]);
            setLoadStatus('idle');
            setDetail(
                t(
                    'view.my_avatars.generated.no_authenticated_user_is_available_for_the_avatar_inventory'
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
                            'view.my_avatars.generated.avatar_inventory_failed_to_load'
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

    const table = useReactTable({
        data: filteredAvatars,
        columns,
        state: {
            sorting,
            pagination,
            columnVisibility,
            columnOrder,
            columnSizing
        },
        onSortingChange: setSorting,
        onPaginationChange: setPagination,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnOrderChange: setColumnOrder,
        onColumnSizingChange: setColumnSizing,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        meta: {
            columnOrderLocked,
            setColumnOrderLocked
        }
    });

    const {
        gridGap,
        gridColumnCount,
        gridMinWidth,
        gridScrollRef,
        gridTotalHeight,
        visibleGridRows
    } = useMyAvatarsGridVirtualization({
        cardScale,
        cardSpacing,
        deferredSearchQuery,
        filteredAvatars,
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

    function handleViewModeChange(nextViewMode) {
        setViewMode(nextViewMode);
        void configRepository.setString('MyAvatarsViewMode', nextViewMode);
    }

    return (
        <div
            className={cn(
                'flex h-full min-h-0 flex-col p-3',
                !embedded && 'x-container overflow-hidden'
            )}
        >
            <Input
                ref={imageUploadInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={(event) => void onAvatarImageFileChange(event)}
            />
            <div className="flex min-h-0 flex-1 flex-col gap-3">
                <MyAvatarsToolbar
                    t={t}
                    viewMode={viewMode}
                    activeFilterCount={activeFilterCount}
                    allTags={allTags}
                    releaseStatusFilter={releaseStatusFilter}
                    platformFilter={platformFilter}
                    tagFilters={tagFilters}
                    loadStatus={loadStatus}
                    searchQuery={searchQuery}
                    cardScale={cardScale}
                    cardSpacing={cardSpacing}
                    table={table}
                    currentUserId={currentUserId}
                    onViewModeChange={handleViewModeChange}
                    onReleaseStatusChange={setReleaseStatusFilter}
                    onPlatformChange={setPlatformFilter}
                    onTagFiltersChange={setTagFilters}
                    onClearFilters={() => {
                        setReleaseStatusFilter('all');
                        setPlatformFilter('all');
                        setTagFilters(new Set());
                    }}
                    onSearchChange={setSearchQuery}
                    onCardScaleChange={setCardScale}
                    onCardSpacingChange={setCardSpacing}
                    onRefresh={() => setRefreshToken((value) => value + 1)}
                />

                {detail ? (
                    <div className="text-muted-foreground text-sm">
                        {userFacingErrorMessage(
                            detail,
                            t(
                                'view.my_avatars.generated.avatar_inventory_failed_to_load'
                            )
                        )}
                    </div>
                ) : null}

                {isLoading ? (
                    <LoadingState label={t('view.my_avatars.generated.loading_the_avatar_inventory')} />
                ) : isError ? (
                    <MyAvatarsEmptyState
                        title={t('view.my_avatars.generated.avatar_inventory_failed_to_load')}
                        description={
                            detail ||
                            t(
                                'view.my_avatars.generated.avatar_request_did_not_complete'
                            )
                        }
                    />
                ) : hasRows ? (
                    viewMode === 'table' ? (
                        <MyAvatarsTableView
                            t={t}
                            table={table}
                            currentAvatarId={currentAvatarId}
                            savingTagsAvatarId={savingTagsAvatarId}
                            updatingAvatarId={updatingAvatarId}
                            uploadingImageAvatarId={uploadingImageAvatarId}
                            filteredCount={filteredAvatars.length}
                            pageSizes={pageSizes}
                            pagination={pagination}
                            onAvatarAction={handleAvatarAction}
                            onPageSizeChange={(value) => {
                                const nextPageSize =
                                    resolveMyAvatarsPageSize(
                                        value,
                                        pageSizes,
                                        pagination.pageSize
                                    );
                                setPagination({
                                    pageIndex: 0,
                                    pageSize: nextPageSize
                                });
                            }}
                        />
                    ) : (
                        <MyAvatarsGridView
                            gridScrollRef={gridScrollRef}
                            gridTotalHeight={gridTotalHeight}
                            visibleGridRows={visibleGridRows}
                            gridGap={gridGap}
                            gridColumnCount={gridColumnCount}
                            gridMinWidth={gridMinWidth}
                            currentAvatarId={currentAvatarId}
                            cardScale={cardScale}
                            savingTagsAvatarId={savingTagsAvatarId}
                            updatingAvatarId={updatingAvatarId}
                            uploadingImageAvatarId={uploadingImageAvatarId}
                            onAvatarAction={handleAvatarAction}
                        />
                    )
                ) : (
                    <MyAvatarsEmptyState
                        title={t('view.my_avatars.generated.no_avatars_match_the_current_filters')}
                        description={t('view.my_avatars.generated.broaden_the_filters_or_search_query_to_see_more_avatars')}
                    />
                )}
            </div>
            <MyAvatarsDialogs
                t={t}
                imageCropRequest={imageCropRequest}
                manageTagsAvatar={manageTagsAvatar}
                savingTagsAvatarId={savingTagsAvatarId}
                stylesAvatar={stylesAvatar}
                currentUserId={currentUserId}
                currentEndpoint={currentEndpoint}
                onImageCropOpenChange={(open) => {
                    if (!open) {
                        setImageCropRequest(null);
                        imageUploadAvatarRef.current = null;
                        imageUploadAuthTargetRef.current = null;
                    }
                }}
                onImageCropConfirm={(blob) => confirmAvatarImageUpload(blob)}
                onManageTagsOpenChange={(open) => {
                    if (!open && !savingTagsAvatarId) {
                        setManageTagsAvatar(null);
                    }
                }}
                onSaveTags={handleSaveAvatarTags}
                onStylesOpenChange={(open) => {
                    if (!open) {
                        setStylesAvatar(null);
                    }
                }}
                onStylesSaved={(nextAvatar) => {
                    applyAvatarUpdate(nextAvatar);
                    setDetail(
                        t('view.my_avatars.generated.avatar_styles_updated')
                    );
                }}
            />
        </div>
    );
}
