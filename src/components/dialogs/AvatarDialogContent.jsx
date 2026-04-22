import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { EmptyState as AppEmptyState } from '@/components/layout/PageScaffold.jsx';
import { ImageCropDialog } from '@/components/media/ImageCropDialog.jsx';
import { getPlatformInfo } from '@/lib/avatarPlatform.js';
import { convertFileUrlToImageUrl } from '@/lib/entityMedia.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { getFileAnalysisForUnityPackages } from '@/lib/fileAnalysis.js';
import { backend } from '@/platform/tauri/index.js';
import {
    avatarProfileRepository,
    memoRepository,
    mediaRepository,
    vrchatAuthRepository
} from '@/repositories/index.js';
import {
    IMAGE_UPLOAD_ACCEPT,
    readFileAsBase64,
    validateImageUploadFile,
    withUploadTimeout
} from '@/shared/utils/imageUpload.js';
import { useDialogStore } from '@/state/dialogStore.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

import {
    avatarGalleryImageUrl,
    defaultAvatarSideData,
    resolveAssetBundleArgs
} from './avatar-dialog/avatarAssets.js';
import { readAvatarCacheInfo } from './avatar-dialog/avatarCacheAdapter.js';
import { AvatarDialogTabbedView } from './AvatarDialogTabbedView.jsx';
import {
    AvatarContentTagsDialog,
    AvatarStylesDialog
} from './AvatarOwnerEditDialogs.jsx';
import { appI18n } from '@/services/i18nService.js';

function normalizeEntityId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function AvatarDialogEmptyState({ title, description, loading = false }) {
    return (
        <AppEmptyState
            className="min-h-56"
            title={title}
            description={description}
            icon={loading ? Spinner : undefined}
        />
    );
}

export function AvatarDialogContent({ avatarId, seedData = null }) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentAvatarId = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot?.currentAvatar || ''
    );
    const setAuthBootstrap = useRuntimeStore((state) => state.setAuthBootstrap);
    const remoteFavoriteAvatarIds = useFavoriteStore(
        (state) => state.favoriteAvatarIds
    );
    const localFavoriteAvatarIds = useFavoriteStore(
        (state) => state.localAvatarFavoritesList
    );
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const closeDialog = useDialogStore((state) => state.closeDialog);
    const updateEntityDialogMetadata = useDialogStore(
        (state) => state.updateEntityDialogMetadata
    );
    const [avatar, setAvatar] = useState(() =>
        seedData ? avatarProfileRepository.normalize(seedData) : null
    );
    const [loadStatus, setLoadStatus] = useState(
        normalizedAvatarId ? 'running' : 'idle'
    );
    const [actionStatus, setActionStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [memo, setMemo] = useState(() =>
        typeof seedData?.$memo === 'string' ? seedData.$memo : ''
    );
    const [avatarBlocked, setAvatarBlocked] = useState(false);
    const [avatarSideData, setAvatarSideData] = useState(() =>
        defaultAvatarSideData()
    );
    const [imageCropRequest, setImageCropRequest] = useState(null);
    const [ownerEditor, setOwnerEditor] = useState(null);
    const actionStatusRef = useRef('idle');
    const memoRevisionRef = useRef(0);
    const moderationRevisionRef = useRef(0);
    const activeAvatarTargetRef = useRef({
        avatarId: normalizedAvatarId,
        endpoint: currentEndpoint
    });
    const imageUploadInputRef = useRef(null);
    const imageUploadAvatarRef = useRef(null);
    const galleryUploadInputRef = useRef(null);

    useEffect(() => {
        activeAvatarTargetRef.current = {
            avatarId: normalizedAvatarId,
            endpoint: currentEndpoint
        };
    }, [currentEndpoint, normalizedAvatarId]);

    useEffect(() => {
        setAvatar(
            seedData ? avatarProfileRepository.normalize(seedData) : null
        );
    }, [seedData]);

    useEffect(() => {
        setMemo(typeof avatar?.$memo === 'string' ? avatar.$memo : '');
    }, [avatar?.$memo]);

    useEffect(() => {
        if (!avatar?.id || !avatar?.name) {
            return;
        }
        updateEntityDialogMetadata({
            kind: 'avatar',
            entityId: avatar.id,
            title: avatar.name
        });
    }, [avatar?.id, avatar?.name, updateEntityDialogMetadata]);

    useEffect(() => {
        if (!avatar?.id) {
            imageUploadAvatarRef.current = null;
            setImageCropRequest(null);
            setAvatarSideData(defaultAvatarSideData());
        }
    }, [avatar?.id]);

    useEffect(() => {
        let active = true;

        if (!avatar?.id) {
            setAvatarSideData(defaultAvatarSideData());
            return () => {
                active = false;
            };
        }

        setAvatarSideData((current) => ({
            ...current,
            galleryRows: [],
            galleryImages: [],
            fileAnalysis: {}
        }));

        Promise.allSettled([
            vrchatAuthRepository.getConfig({ endpoint: currentEndpoint }),
            avatarProfileRepository.getAvatarGallery({
                avatarId: avatar.id,
                endpoint: currentEndpoint
            })
        ]).then(([configResult, galleryResult]) => {
            if (!active) {
                return;
            }
            const sdkUnityVersion = String(
                configResult.status === 'fulfilled'
                    ? configResult.value?.json?.sdkUnityVersion || ''
                    : ''
            );
            const galleryRows =
                galleryResult.status === 'fulfilled' ? galleryResult.value : [];
            return Promise.allSettled([
                readAvatarCacheInfo(avatar, currentEndpoint),
                getFileAnalysisForUnityPackages({
                    unityPackages: avatar.unityPackages,
                    sdkUnityVersion,
                    endpoint: currentEndpoint
                })
            ]).then(([cacheResult, fileAnalysisResult]) => {
                if (!active) {
                    return;
                }
                setAvatarSideData({
                    galleryRows,
                    galleryImages: galleryRows
                        .map(avatarGalleryImageUrl)
                        .filter(Boolean),
                    fileAnalysis:
                        fileAnalysisResult.status === 'fulfilled'
                            ? fileAnalysisResult.value
                            : {},
                    cache:
                        cacheResult.status === 'fulfilled'
                            ? cacheResult.value
                            : defaultAvatarSideData().cache
                });
            });
        });

        return () => {
            active = false;
        };
    }, [avatar?.id, avatar?.updated_at, avatar?.version, currentEndpoint]);

    useEffect(() => {
        let active = true;

        if (!normalizedAvatarId) {
            setAvatarBlocked(false);
            return () => {
                active = false;
            };
        }

        const revision = moderationRevisionRef.current;
        avatarProfileRepository
            .getAvatarModerations({ endpoint: currentEndpoint })
            .then((response) => {
                if (!active || moderationRevisionRef.current !== revision) {
                    return;
                }

                const rows = Array.isArray(response.json) ? response.json : [];
                setAvatarBlocked(
                    rows.some(
                        (row) =>
                            normalizeEntityId(row?.targetAvatarId) ===
                                normalizedAvatarId &&
                            normalizeEntityId(
                                row?.avatarModerationType
                            ).toLowerCase() === 'block'
                    )
                );
            })
            .catch(() => {
                if (active && moderationRevisionRef.current === revision) {
                    setAvatarBlocked(false);
                }
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, normalizedAvatarId]);

    useEffect(() => {
        let active = true;

        if (!normalizedAvatarId) {
            setAvatar(null);
            setLoadStatus('error');
            setDetail('No avatar id was provided for this dialog.');
            return () => {
                active = false;
            };
        }

        setAvatar(
            seedData ? avatarProfileRepository.normalize(seedData) : null
        );
        setMemo(typeof seedData?.$memo === 'string' ? seedData.$memo : '');
        setLoadStatus('running');
        setDetail('');
        const memoRevision = memoRevisionRef.current;

        avatarProfileRepository
            .getAvatarProfile({
                avatarId: normalizedAvatarId,
                endpoint: currentEndpoint
            })
            .then((nextAvatar) => {
                if (!active) {
                    return;
                }

                setAvatar((currentAvatar) =>
                    memoRevisionRef.current === memoRevision
                        ? nextAvatar
                        : {
                              ...nextAvatar,
                              $memo:
                                  currentAvatar?.$memo ?? nextAvatar.$memo ?? ''
                          }
                );
                setLoadStatus('ready');
            })
            .catch((error) => {
                if (!active) {
                    return;
                }

                if (seedData) {
                    const nextAvatar =
                        avatarProfileRepository.normalize(seedData);
                    setAvatar((currentAvatar) =>
                        memoRevisionRef.current === memoRevision
                            ? nextAvatar
                            : {
                                  ...nextAvatar,
                                  $memo:
                                      currentAvatar?.$memo ??
                                      nextAvatar.$memo ??
                                      ''
                              }
                    );
                    setLoadStatus('ready');
                    setDetail(
                        error instanceof Error
                            ? error.message
                            : 'Failed to refresh the remote avatar snapshot.'
                    );
                    return;
                }

                setAvatar(null);
                setLoadStatus('error');
                setDetail(
                    error instanceof Error
                        ? error.message
                        : 'Failed to load the avatar profile.'
                );
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, normalizedAvatarId, seedData]);

    const favoriteAvatarIds = useMemo(() => {
        const ids = new Set();

        for (const favoriteId of remoteFavoriteAvatarIds ?? []) {
            const normalized = normalizeEntityId(favoriteId);
            if (normalized) {
                ids.add(normalized);
            }
        }

        for (const favoriteId of localFavoriteAvatarIds ?? []) {
            const normalized = normalizeEntityId(favoriteId);
            if (normalized) {
                ids.add(normalized);
            }
        }

        return ids;
    }, [localFavoriteAvatarIds, remoteFavoriteAvatarIds]);

    if (loadStatus === 'running' && !avatar) {
        return (
            <AvatarDialogEmptyState
                loading
                title={appI18n.t('dialog.avatar.generated.loading_avatar_profile')}
                description={appI18n.t('dialog.avatar.generated.fetching_the_current_vrchat_avatar_snapshot_for_this_dialog')}
            />
        );
    }

    if (!avatar) {
        return (
            <AvatarDialogEmptyState
                title={appI18n.t('dialog.avatar.generated.avatar_profile_unavailable')}
                description={
                    detail ||
                    appI18n.t(
                        'dialog.avatar.generated.avatar_snapshot_unavailable_description'
                    )
                }
            />
        );
    }

    const imageUrl = convertFileUrlToImageUrl(
        avatar.imageUrl || avatar.thumbnailImageUrl,
        512
    );
    const platformInfo = getPlatformInfo(avatar.unityPackages);
    const isCurrentAvatar =
        normalizeEntityId(currentAvatarId) === normalizeEntityId(avatar.id);
    const isFavorite = favoriteAvatarIds.has(normalizeEntityId(avatar.id));
    const canManageAvatar =
        normalizeEntityId(avatar.authorId) === normalizeEntityId(currentUserId);
    const localTags = Array.isArray(avatar.$tags) ? avatar.$tags : [];
    const remoteTags = Array.isArray(avatar.tags) ? avatar.tags : [];
    const contentTags = remoteTags.filter((tag) => tag.startsWith('content_'));
    const authorTags = remoteTags.filter((tag) =>
        tag.startsWith('author_tag_')
    );
    const otherTags = remoteTags.filter(
        (tag) => !tag.startsWith('content_') && !tag.startsWith('author_tag_')
    );
    const imposterPackage = Array.isArray(avatar.unityPackages)
        ? avatar.unityPackages.find(
              (unityPackage) => unityPackage?.variant === 'impostor'
          )
        : null;
    const hasImposter = Boolean(imposterPackage);
    const imposterVersion = normalizeEntityId(
        imposterPackage?.impostorizerVersion
    );
    const canSelectAvatar =
        !avatarBlocked &&
        !isCurrentAvatar &&
        normalizeEntityId(avatar.id) &&
        (avatar.releaseStatus !== 'private' ||
            normalizeEntityId(avatar.authorId) ===
                normalizeEntityId(currentUserId));
    const canSelectFallbackAvatar = Boolean(
        avatar.id &&
        (platformInfo?.android?.platform || platformInfo?.ios?.platform)
    );
    const avatarForView = {
        ...avatar,
        gallery: avatarSideData.galleryRows,
        galleryImages: avatarSideData.galleryImages,
        fileAnalysis: avatarSideData.fileAnalysis,
        $isCached: avatarSideData.cache.inCache || avatar.$isCached,
        $cacheSize: avatarSideData.cache.cacheSize,
        $cacheLocked: avatarSideData.cache.cacheLocked,
        $cachePath: avatarSideData.cache.cachePath
    };

    async function refreshAvatarProfile() {
        if (actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'refresh';
        setActionStatus('refresh');
        try {
            const nextAvatar = await avatarProfileRepository.getAvatarProfile({
                avatarId: normalizedAvatarId,
                endpoint: currentEndpoint,
                force: true,
                allowLocalFallback: false
            });
            applyCurrentAvatarUpdate(nextAvatar);
            toast.success(appI18n.t('dialog.avatar.generated.avatar_refreshed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.avatar.generated_toast.failed_to_refresh_avatar')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function selectAvatar() {
        if (!canSelectAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'selecting';
        setActionStatus('selecting');

        try {
            await avatarProfileRepository.selectAvatar({
                avatarId: avatar.id,
                endpoint: currentEndpoint
            });
            const currentUserResponse =
                await vrchatAuthRepository.getCurrentUser({
                    endpoint: currentEndpoint
                });
            const nextUser =
                currentUserResponse.json &&
                typeof currentUserResponse.json === 'object'
                    ? currentUserResponse.json
                    : null;
            if (nextUser?.id) {
                setAuthBootstrap({
                    currentUserId: nextUser.id,
                    currentUserDisplayName:
                        nextUser.displayName ||
                        nextUser.username ||
                        nextUser.id,
                    currentUserSnapshot: nextUser
                });
            }
            toast.success(appI18n.t('dialog.avatar.generated.avatar_selected'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.avatar.generated_toast.failed_to_select_avatar')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function refreshCurrentUserSnapshot() {
        const currentUserResponse = await vrchatAuthRepository.getCurrentUser({
            endpoint: currentEndpoint
        });
        const nextUser =
            currentUserResponse.json &&
            typeof currentUserResponse.json === 'object'
                ? currentUserResponse.json
                : null;
        if (nextUser?.id) {
            setAuthBootstrap({
                currentUserId: nextUser.id,
                currentUserDisplayName:
                    nextUser.displayName || nextUser.username || nextUser.id,
                currentUserSnapshot: nextUser
            });
        }
    }

    async function selectFallbackAvatar() {
        if (!canSelectFallbackAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'fallback';
        setActionStatus('fallback');
        const result = await confirm({
            title: appI18n.t('dialog.avatar.generated_modal.select_fallback_avatar'),
            description: appI18n.t('dialog.avatar.generated_dynamic.use_value_as_your_vrchat_fallback_avatar', { value: avatar.name || avatar.id }),
            confirmText: appI18n.t('dialog.avatar.generated_modal.select_fallback'),
            cancelText: appI18n.t('common.actions.cancel')
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            await avatarProfileRepository.selectFallbackAvatar({
                avatarId: avatar.id,
                endpoint: currentEndpoint
            });
            await refreshCurrentUserSnapshot();
            toast.success(appI18n.t('dialog.avatar.generated.fallback_avatar_updated'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.avatar.generated_toast.failed_to_select_fallback_avatar')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateReleaseStatus(nextStatus) {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        const isPublic = nextStatus === 'public';
        actionStatusRef.current = 'release-status';
        setActionStatus('release-status');
        const result = await confirm({
            title: isPublic ? 'Make avatar public?' : 'Make avatar private?',
            description: avatar.name || avatar.id,
            confirmText: isPublic ? 'Make Public' : 'Make Private',
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: !isPublic
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            const response = await avatarProfileRepository.saveAvatar({
                avatarId: avatar.id,
                endpoint: currentEndpoint,
                params: {
                    id: avatar.id,
                    releaseStatus: nextStatus
                }
            });
            applyCurrentAvatarUpdate(
                response.json && typeof response.json === 'object'
                    ? response.json
                    : { ...avatar, releaseStatus: nextStatus }
            );
            toast.success(
                isPublic ? appI18n.t('dialog.avatar.generated_toast.avatar_made_public') : appI18n.t('dialog.avatar.generated_toast.avatar_made_private')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.avatar.generated_toast.failed_to_update_avatar_release_status')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function renameAvatar() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        const result = await prompt({
            title: appI18n.t('dialog.avatar.generated_modal.rename_avatar'),
            description: avatar.name || avatar.id,
            inputValue: avatar.name || '',
            confirmText: appI18n.t('common.actions.save'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        actionStatusRef.current = 'rename';
        setActionStatus('rename');
        try {
            const response = await avatarProfileRepository.saveAvatar({
                avatarId: avatar.id,
                endpoint: currentEndpoint,
                params: {
                    id: avatar.id,
                    name: result.value
                }
            });
            applyCurrentAvatarUpdate(
                response.json && typeof response.json === 'object'
                    ? response.json
                    : { ...avatar, name: result.value }
            );
            toast.success(appI18n.t('dialog.avatar.generated.avatar_renamed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.avatar.generated_toast.failed_to_rename_avatar')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function changeAvatarDescription() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        const result = await prompt({
            title: appI18n.t('dialog.avatar.generated_modal.change_avatar_description'),
            description: avatar.name || avatar.id,
            inputValue: avatar.description || '',
            multiline: true,
            confirmText: appI18n.t('common.actions.save'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        actionStatusRef.current = 'description';
        setActionStatus('description');
        try {
            const response = await avatarProfileRepository.saveAvatar({
                avatarId: avatar.id,
                endpoint: currentEndpoint,
                params: {
                    id: avatar.id,
                    description: result.value
                }
            });
            applyCurrentAvatarUpdate(
                response.json && typeof response.json === 'object'
                    ? response.json
                    : { ...avatar, description: result.value }
            );
            toast.success(appI18n.t('dialog.avatar.generated.avatar_description_updated'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.avatar.generated_toast.failed_to_update_avatar_description')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    function applyCurrentAvatarUpdate(nextAvatar) {
        const targetAvatarId = normalizeEntityId(nextAvatar?.id || avatar?.id);
        if (
            !targetAvatarId ||
            activeAvatarTargetRef.current.avatarId !== targetAvatarId ||
            activeAvatarTargetRef.current.endpoint !== currentEndpoint
        ) {
            return;
        }
        setAvatar((currentAvatar) =>
            normalizeEntityId(currentAvatar?.id) === targetAvatarId
                ? avatarProfileRepository.normalize(nextAvatar, {
                      localTags: currentAvatar.$tags,
                      timeSpent: currentAvatar.$timeSpent,
                      memo: currentAvatar.$memo,
                      cachedAvatar: currentAvatar.$isCached
                  })
                : currentAvatar
        );
    }

    async function changeAvatarContentTags() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }
        setOwnerEditor('content-tags');
    }

    async function changeAvatarStylesAndAuthorTags() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }
        setOwnerEditor('styles');
    }

    async function deleteAvatar() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        const result = await confirm({
            title: appI18n.t('dialog.avatar.generated_modal.delete_avatar'),
            description: avatar.name || avatar.id,
            confirmText: appI18n.t('common.actions.delete'),
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        actionStatusRef.current = 'delete';
        setActionStatus('delete');
        try {
            await avatarProfileRepository.deleteAvatar({
                avatarId: avatar.id,
                endpoint: currentEndpoint
            });
            let refreshFailed = false;
            try {
                await refreshCurrentUserSnapshot();
            } catch {
                refreshFailed = true;
            }
            toast.success(
                refreshFailed
                    ? appI18n.t('dialog.avatar.generated_toast.avatar_deleted_but_current_user_snapshot_refresh')
                    : appI18n.t('dialog.avatar.generated_toast.avatar_deleted')
            );
            const dialogState = useDialogStore.getState();
            if (dialogState.breadcrumbs.length > 1) {
                dialogState.popToBreadcrumb(dialogState.breadcrumbs.length - 2);
            } else {
                closeDialog();
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.avatar.generated_toast.failed_to_delete_avatar')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function refreshAvatarSnapshot({ force = false } = {}) {
        const nextAvatar = await avatarProfileRepository.getAvatarProfile({
            avatarId: avatar.id,
            endpoint: currentEndpoint,
            force,
            allowLocalFallback: false
        });
        applyCurrentAvatarUpdate(nextAvatar);
    }

    function beginAvatarImageUpload() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        imageUploadAvatarRef.current = avatar;
        imageUploadInputRef.current?.click();
    }

    function onFileChangeAvatarImage(event) {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        if (!file) {
            return;
        }

        const validation = validateImageUploadFile(file);
        if (!validation.ok) {
            const message =
                validation.reason === 'too_large'
                    ? 'Selected image is too large.'
                    : 'Selected file is not an image.';
            setDetail(message);
            toast.error(message);
            return;
        }

        const selectedAvatar = imageUploadAvatarRef.current || avatar;
        if (!selectedAvatar?.id) {
            return;
        }

        imageUploadAvatarRef.current = selectedAvatar;
        setImageCropRequest({
            file,
            avatar: selectedAvatar
        });
    }

    async function confirmAvatarImageUpload(blob) {
        const request = imageCropRequest;
        const selectedAvatar =
            request?.avatar || imageUploadAvatarRef.current || avatar;
        const avatarId = normalizeEntityId(selectedAvatar?.id);
        const requestEndpoint = currentEndpoint;
        if (!blob || !avatarId) {
            return;
        }

        actionStatusRef.current = 'image-upload';
        setActionStatus('image-upload');

        try {
            const base64Body = await readFileAsBase64(blob);
            const base64File =
                await mediaRepository.resizeImageToFitLimits(base64Body);
            const result = await withUploadTimeout(
                mediaRepository.uploadAvatarImageLegacy({
                    avatarId,
                    imageUrl:
                        selectedAvatar.imageUrl ||
                        selectedAvatar.thumbnailImageUrl ||
                        '',
                    base64File,
                    blob,
                    endpoint: requestEndpoint
                })
            );
            const activeTarget = activeAvatarTargetRef.current;
            if (
                activeTarget.avatarId !== avatarId ||
                activeTarget.endpoint !== requestEndpoint
            ) {
                return;
            }
            const currentAvatar = avatarProfileRepository.normalize(
                result.avatar,
                {
                    localTags: selectedAvatar.$tags,
                    timeSpent: selectedAvatar.$timeSpent,
                    memo: selectedAvatar.$memo,
                    cachedAvatar: selectedAvatar.$isCached
                }
            );
            setAvatar(currentAvatar);
            setDetail(
                appI18n.t('dialog.avatar.generated_dynamic.avatar_image_updated_for_value', { value: selectedAvatar.name || avatarId })
            );
            toast.success(appI18n.t('dialog.avatar.generated.avatar_image_updated'));
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Failed to upload avatar image.';
            setDetail(message);
            toast.error(message);
        } finally {
            imageUploadAvatarRef.current = null;
            setImageCropRequest(null);
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateAvatarImposter(action) {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        const labels = {
            create: {
                title: appI18n.t(
                    'dialog.avatar.generated_modal.create_impostor_title'
                ),
                confirmText: appI18n.t(
                    'dialog.avatar.generated_modal.create'
                ),
                success: appI18n.t(
                    'dialog.avatar.generated_toast.impostor_queued_for_creation'
                ),
                error: appI18n.t(
                    'dialog.avatar.generated_toast.failed_to_create_impostor'
                )
            },
            delete: {
                title: appI18n.t(
                    'dialog.avatar.generated_modal.delete_impostor_title'
                ),
                confirmText: appI18n.t('common.actions.delete'),
                success: appI18n.t(
                    'dialog.avatar.generated_toast.impostor_deleted'
                ),
                error: appI18n.t(
                    'dialog.avatar.generated_toast.failed_to_delete_impostor'
                ),
                destructive: true
            },
            regenerate: {
                title: appI18n.t(
                    'dialog.avatar.generated_modal.regenerate_impostor_title'
                ),
                confirmText: appI18n.t(
                    'dialog.avatar.generated_modal.regenerate'
                ),
                success: appI18n.t(
                    'dialog.avatar.generated_toast.impostor_queued_for_regeneration'
                ),
                error: appI18n.t(
                    'dialog.avatar.generated_toast.failed_to_regenerate_impostor'
                ),
                destructive: true
            }
        };
        const label = labels[action];
        if (!label) {
            return;
        }

        const result = await confirm({
            title: label.title,
            description: avatar.name || avatar.id,
            confirmText: label.confirmText,
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: Boolean(label.destructive)
        });
        if (!result.ok) {
            return;
        }

        actionStatusRef.current = 'imposter';
        setActionStatus('imposter');
        try {
            if (action === 'create') {
                await avatarProfileRepository.createImposter({
                    avatarId: avatar.id,
                    endpoint: currentEndpoint
                });
            } else if (action === 'delete') {
                await avatarProfileRepository.deleteImposter({
                    avatarId: avatar.id,
                    endpoint: currentEndpoint
                });
            } else {
                await avatarProfileRepository.deleteImposter({
                    avatarId: avatar.id,
                    endpoint: currentEndpoint
                });
                await avatarProfileRepository.createImposter({
                    avatarId: avatar.id,
                    endpoint: currentEndpoint
                });
            }
            let refreshFailed = false;
            try {
                await refreshAvatarSnapshot({ force: true });
            } catch {
                refreshFailed = true;
            }
            toast.success(
                refreshFailed
                    ? appI18n.t('dialog.avatar.generated_toast.value_avatar_state_refresh_failed', { value: label.success })
                    : label.success
            );
        } catch (error) {
            toast.error(userFacingErrorMessage(error, label.error));
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function setAvatarBlock(enabled) {
        if (
            !avatar.id ||
            isCurrentAvatar ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        actionStatusRef.current = 'avatar-block';
        setActionStatus('avatar-block');
        const result = await confirm({
            title: enabled
                ? appI18n.t('dialog.avatar.generated_modal.block_avatar_title')
                : appI18n.t(
                      'dialog.avatar.generated_modal.unblock_avatar_title'
                  ),
            description: avatar.name || avatar.id,
            confirmText: enabled
                ? appI18n.t('dialog.avatar.generated_modal.block')
                : appI18n.t('dialog.avatar.generated_modal.unblock'),
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: enabled
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            if (enabled) {
                await avatarProfileRepository.sendAvatarModeration({
                    avatarId: avatar.id,
                    type: 'block',
                    endpoint: currentEndpoint
                });
            } else {
                await avatarProfileRepository.deleteAvatarModeration({
                    avatarId: avatar.id,
                    type: 'block',
                    endpoint: currentEndpoint
                });
            }
            moderationRevisionRef.current += 1;
            setAvatarBlocked(enabled);
            toast.success(enabled ? appI18n.t('dialog.avatar.generated_toast.avatar_blocked') : appI18n.t('dialog.avatar.generated_toast.avatar_unblocked'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.avatar.generated_toast.failed_to_update_avatar_moderation')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function saveMemo(nextValue) {
        const targetAvatarId = normalizeEntityId(avatar.id);
        memoRevisionRef.current += 1;
        try {
            const nextEntry = await memoRepository.saveAvatarMemo({
                avatarId: targetAvatarId,
                memo: nextValue
            });
            if (
                activeAvatarTargetRef.current.avatarId !== targetAvatarId ||
                activeAvatarTargetRef.current.endpoint !== currentEndpoint
            ) {
                return;
            }
            const nextMemo = nextEntry.memo || '';
            setMemo(nextMemo);
            setAvatar((currentAvatar) =>
                normalizeEntityId(currentAvatar?.id) === targetAvatarId
                    ? { ...currentAvatar, $memo: nextMemo }
                    : currentAvatar
            );
            toast.success(nextMemo ? appI18n.t('dialog.avatar.generated_toast.memo_saved') : appI18n.t('dialog.avatar.generated_toast.memo_cleared'));
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : appI18n.t('dialog.avatar.generated_toast.failed_to_save_memo')
            );
        }
    }

    async function openAvatarCacheFolder() {
        const cachePath = avatarSideData.cache.cachePath;
        if (!cachePath) {
            return;
        }
        try {
            await backend.app.OpenFolderAndSelectItem(cachePath, true);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.avatar.generated_toast.failed_to_open_avatar_cache_folder')
            );
        }
    }

    async function deleteAvatarCache() {
        if (actionStatusRef.current !== 'idle') {
            return;
        }
        const configResponse = await vrchatAuthRepository
            .getConfig({ endpoint: currentEndpoint })
            .catch(() => null);
        const args = resolveAssetBundleArgs(
            avatar,
            String(configResponse?.json?.sdkUnityVersion || '')
        );
        if (!args) {
            toast.error(appI18n.t('dialog.avatar.generated.avatar_cache_location_unavailable'));
            return;
        }
        actionStatusRef.current = 'cache';
        setActionStatus('cache');
        try {
            await backend.assetBundle.DeleteCache(
                args.fileId,
                args.fileVersion,
                args.variant,
                args.variantVersion
            );
            const cache = await readAvatarCacheInfo(avatar, currentEndpoint);
            setAvatarSideData((current) => ({ ...current, cache }));
            setAvatar((current) =>
                current ? { ...current, $isCached: cache.inCache } : current
            );
            toast.success(appI18n.t('dialog.avatar.generated.avatar_cache_deleted'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.avatar.generated_toast.failed_to_delete_avatar_cache')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    function beginAvatarGalleryUpload() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }
        galleryUploadInputRef.current?.click();
    }

    async function onFileChangeAvatarGallery(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        const targetAvatarId = normalizeEntityId(avatar?.id);
        const requestEndpoint = currentEndpoint;
        if (!file || !targetAvatarId || actionStatusRef.current !== 'idle') {
            return;
        }
        const validation = validateImageUploadFile(file);
        if (!validation.ok) {
            toast.error(
                validation.reason === 'too_large'
                    ? appI18n.t('dialog.avatar.generated_toast.selected_file_is_too_large')
                    : appI18n.t('dialog.avatar.generated_toast.selected_file_is_not_an_image')
            );
            return;
        }
        actionStatusRef.current = 'gallery-upload';
        setActionStatus('gallery-upload');
        try {
            const base64Body = await readFileAsBase64(file);
            await mediaRepository.uploadAvatarGalleryImage(
                base64Body,
                targetAvatarId,
                {
                    endpoint: requestEndpoint
                }
            );
            const galleryRows = await avatarProfileRepository.getAvatarGallery({
                avatarId: targetAvatarId,
                endpoint: requestEndpoint
            });
            if (
                activeAvatarTargetRef.current.avatarId === targetAvatarId &&
                activeAvatarTargetRef.current.endpoint === requestEndpoint
            ) {
                setAvatarSideData((current) => ({
                    ...current,
                    galleryRows,
                    galleryImages: galleryRows
                        .map(avatarGalleryImageUrl)
                        .filter(Boolean)
                }));
                toast.success(appI18n.t('dialog.avatar.generated.avatar_gallery_image_uploaded'));
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.avatar.generated_toast.failed_to_upload_avatar_gallery_image')
            );
        } finally {
            if (actionStatusRef.current === 'gallery-upload') {
                actionStatusRef.current = 'idle';
                setActionStatus('idle');
            }
        }
    }

    async function editMemo() {
        const result = await prompt({
            title: appI18n.t('dialog.avatar.generated_modal.edit_local_memo'),
            description: avatar.name || avatar.id,
            inputValue: memo,
            multiline: true,
            confirmText: appI18n.t('common.actions.save'),
            cancelText: appI18n.t('common.actions.cancel')
        });

        if (!result.ok) {
            return;
        }

        await saveMemo(result.value);
    }

    return (
        <>
            <AvatarDialogTabbedView
                avatar={avatarForView}
                memo={memo}
                detail={detail}
                imageUrl={imageUrl}
                actionStatus={actionStatus}
                avatarBlocked={avatarBlocked}
                isCurrentAvatar={isCurrentAvatar}
                isFavorite={isFavorite}
                canManageAvatar={canManageAvatar}
                canSelectAvatar={canSelectAvatar}
                canSelectFallbackAvatar={canSelectFallbackAvatar}
                platformInfo={platformInfo}
                fileAnalysis={avatarSideData.fileAnalysis}
                localTags={localTags}
                contentTags={contentTags}
                authorTags={authorTags}
                otherTags={otherTags}
                hasImposter={hasImposter}
                imposterVersion={imposterVersion}
                onRefresh={() => void refreshAvatarProfile()}
                onSelect={() => void selectAvatar()}
                onSelectFallback={() => void selectFallbackAvatar()}
                onReleaseStatus={(nextStatus) =>
                    void updateReleaseStatus(nextStatus)
                }
                onAvatarBlock={(enabled) => void setAvatarBlock(enabled)}
                onEditMemo={() => void editMemo()}
                onSaveMemo={(nextMemo) => saveMemo(nextMemo)}
                onOpenCache={() => void openAvatarCacheFolder()}
                onDeleteCache={() => void deleteAvatarCache()}
                onUploadGallery={() => beginAvatarGalleryUpload()}
                onRename={() => void renameAvatar()}
                onChangeDescription={() => void changeAvatarDescription()}
                onChangeContentTags={() => void changeAvatarContentTags()}
                onChangeStylesAndAuthorTags={() =>
                    void changeAvatarStylesAndAuthorTags()
                }
                onChangeImage={() => void beginAvatarImageUpload()}
                onCreateImposter={() => void updateAvatarImposter('create')}
                onDeleteImposter={() => void updateAvatarImposter('delete')}
                onRegenerateImposter={() =>
                    void updateAvatarImposter('regenerate')
                }
                onDelete={() => void deleteAvatar()}
            />
            <AvatarContentTagsDialog
                open={ownerEditor === 'content-tags'}
                avatar={avatar}
                currentUserId={currentUserId}
                endpoint={currentEndpoint}
                onOpenChange={(open) =>
                    setOwnerEditor(open ? 'content-tags' : null)
                }
                onSavedCurrentAvatar={(nextAvatar) =>
                    applyCurrentAvatarUpdate(nextAvatar)
                }
            />
            <AvatarStylesDialog
                open={ownerEditor === 'styles'}
                avatar={avatar}
                endpoint={currentEndpoint}
                onOpenChange={(open) => setOwnerEditor(open ? 'styles' : null)}
                onSavedCurrentAvatar={(nextAvatar) =>
                    applyCurrentAvatarUpdate(nextAvatar)
                }
            />
            <Input
                ref={imageUploadInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={onFileChangeAvatarImage}
            />
            <Input
                ref={galleryUploadInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={onFileChangeAvatarGallery}
            />
            <ImageCropDialog
                open={Boolean(imageCropRequest)}
                file={imageCropRequest?.file || null}
                aspectRatio={4 / 3}
                title={appI18n.t('dialog.avatar.generated.change_avatar_image')}
                onOpenChange={(open) => {
                    if (!open) {
                        setImageCropRequest(null);
                        imageUploadAvatarRef.current = null;
                    }
                }}
                onConfirm={(blob) => confirmAvatarImageUpload(blob)}
            />
        </>
    );
}
