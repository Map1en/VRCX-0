import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState as AppEmptyState } from '@/components/layout/PageScaffold.jsx';
import { ImageCropDialog } from '@/components/media/ImageCropDialog.jsx';
import { getAvailablePlatforms } from '@/lib/avatarPlatform.js';
import { convertFileUrlToImageUrl } from '@/lib/entityMedia.js';
import { getFileAnalysisForUnityPackages } from '@/lib/fileAnalysis.js';
import {
    avatarProfileRepository,
    vrchatAuthRepository
} from '@/repositories/index.js';
import {
    IMAGE_UPLOAD_ACCEPT
} from '@/shared/utils/imageUpload.js';
import { useDialogStore } from '@/state/dialogStore.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Input } from '@/ui/shadcn/input';

import { Spinner } from '@/ui/shadcn/spinner';
import {
    avatarGalleryImageUrl,
    defaultAvatarSideData
} from './avatar-dialog/avatarAssets.js';
import { readAvatarCacheInfo } from './avatar-dialog/avatarCacheAdapter.js';
import { createAvatarDialogActions } from './avatar-dialog/avatarDialogActions.js';
import { AvatarDialogTabbedView } from './AvatarDialogTabbedView.jsx';
import {
    AvatarContentTagsDialog,
    AvatarStylesDialog
} from './AvatarOwnerEditDialogs.jsx';

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
    const { t } = useTranslation();

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
                endpoint: currentEndpoint,
                dialog: true
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
                title={t('dialog.avatar.generated.loading_avatar_profile')}
                description={t('dialog.avatar.generated.fetching_the_current_vrchat_avatar_snapshot_for_this_dialog')}
            />
        );
    }

    if (!avatar) {
        return (
            <AvatarDialogEmptyState
                title={t('dialog.avatar.generated.avatar_profile_unavailable')}
                description={
                    detail ||
                    t(
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
    const isCurrentAvatar =
        normalizeEntityId(currentAvatarId) === normalizeEntityId(avatar.id);
    const isFavorite = favoriteAvatarIds.has(normalizeEntityId(avatar.id));
    const canManageAvatar =
        normalizeEntityId(avatar.authorId) === normalizeEntityId(currentUserId);
    const availablePlatforms = getAvailablePlatforms(avatar.unityPackages);
    const canSelectAvatar =
        !avatarBlocked &&
        !isCurrentAvatar &&
        normalizeEntityId(avatar.id) &&
        (avatar.releaseStatus !== 'private' ||
            normalizeEntityId(avatar.authorId) ===
                normalizeEntityId(currentUserId));
    const canSelectFallbackAvatar = Boolean(
        avatar.id &&
        (availablePlatforms.isQuest || availablePlatforms.isIos)
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

    const avatarActions = createAvatarDialogActions({
        actionStatusRef,
        activeAvatarTargetRef,
        applyCurrentAvatarUpdate,
        avatar,
        avatarSideData,
        canManageAvatar,
        canSelectAvatar,
        canSelectFallbackAvatar,
        closeDialog,
        confirm,
        currentEndpoint,
        galleryUploadInputRef,
        imageCropRequest,
        imageUploadAvatarRef,
        imageUploadInputRef,
        isCurrentAvatar,
        memo,
        memoRevisionRef,
        moderationRevisionRef,
        normalizedAvatarId,
        prompt,
        setActionStatus,
        setAuthBootstrap,
        setAvatar,
        setAvatarBlocked,
        setAvatarSideData,
        setDetail,
        setImageCropRequest,
        setMemo,
        setOwnerEditor,
        t
    });

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
                fileAnalysis={avatarSideData.fileAnalysis}
                onRefresh={() => void avatarActions.refreshAvatarProfile()}
                onSelect={() => void avatarActions.selectAvatar()}
                onSelectFallback={() => void avatarActions.selectFallbackAvatar()}
                onReleaseStatus={(nextStatus) =>
                    void avatarActions.updateReleaseStatus(nextStatus)
                }
                onAvatarBlock={(enabled) => void avatarActions.setAvatarBlock(enabled)}
                onEditMemo={() => void avatarActions.editMemo()}
                onSaveMemo={(nextMemo) => avatarActions.saveMemo(nextMemo)}
                onOpenCache={() => void avatarActions.openAvatarCacheFolder()}
                onDeleteCache={() => void avatarActions.deleteAvatarCache()}
                onUploadGallery={() => avatarActions.beginAvatarGalleryUpload()}
                onRename={() => void avatarActions.renameAvatar()}
                onChangeDescription={() => void avatarActions.changeAvatarDescription()}
                onChangeContentTags={() => void avatarActions.changeAvatarContentTags()}
                onChangeStylesAndAuthorTags={() =>
                    void avatarActions.changeAvatarStylesAndAuthorTags()
                }
                onChangeImage={() => void avatarActions.beginAvatarImageUpload()}
                onCreateImposter={() => void avatarActions.updateAvatarImposter('create')}
                onDeleteImposter={() => void avatarActions.updateAvatarImposter('delete')}
                onRegenerateImposter={() =>
                    void avatarActions.updateAvatarImposter('regenerate')
                }
                onDelete={() => void avatarActions.deleteAvatar()}
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
                onChange={avatarActions.onFileChangeAvatarImage}
            />
            <Input
                ref={galleryUploadInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={avatarActions.onFileChangeAvatarGallery}
            />
            <ImageCropDialog
                open={Boolean(imageCropRequest)}
                file={imageCropRequest?.file || null}
                aspectRatio={4 / 3}
                title={t('dialog.avatar.generated.change_avatar_image')}
                onOpenChange={(open) => {
                    if (!open) {
                        setImageCropRequest(null);
                        imageUploadAvatarRef.current = null;
                    }
                }}
                onConfirm={(blob) => avatarActions.confirmAvatarImageUpload(blob)}
            />
        </>
    );
}
