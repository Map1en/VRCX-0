import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getFileAnalysisForUnityPackages } from '@/lib/fileAnalysis';
import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import { getCurrentAvatarLiveWearTime } from '@/services/avatarWearTimeService';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { persistFavoriteAvatarDetails } from '@/services/favoriteAvatarCacheService';
import { getAvailablePlatforms } from '@/shared/utils/avatarPlatform';
import { useDialogStore } from '@/state/dialogStore';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { avatarGalleryImageUrl, defaultAvatarSideData } from './avatarAssets';
import { readAvatarCacheInfo } from './avatarCacheAdapter';
import { createAvatarDialogActions } from './avatarDialogActions';

function normalizeEntityId(value: any) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function useAvatarDialogState({ avatarId, seedData = null }: any) {
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
    const [imageCropRequest, setImageCropRequest] = useState<any>(null);
    const [ownerEditor, setOwnerEditor] = useState<any>(null);
    const actionStatusRef = useRef('idle');
    const memoRevisionRef = useRef(0);
    const moderationRevisionRef = useRef(0);
    const activeAvatarTargetRef = useRef({
        avatarId: normalizedAvatarId,
        endpoint: currentEndpoint
    });
    const imageUploadInputRef = useRef<HTMLInputElement | null>(null);
    const imageUploadAvatarRef = useRef<unknown>(null);
    const galleryUploadInputRef = useRef<HTMLInputElement | null>(null);

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

        setAvatarSideData((current: any) => ({
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
        ]).then(([configResult, galleryResult]: any) => {
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
            ]).then(([cacheResult, fileAnalysisResult]: any) => {
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
            .then((response: any) => {
                if (!active || moderationRevisionRef.current !== revision) {
                    return;
                }

                const rows = Array.isArray(response.json) ? response.json : [];
                setAvatarBlocked(
                    rows.some(
                        (row: any) =>
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
                dialog: true,
                currentUserId
            })
            .then((nextAvatar: any) => {
                if (!active) {
                    return;
                }

                persistFavoriteAvatarDetails(nextAvatar);
                setAvatar((currentAvatar: any) =>
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
            .catch((error: unknown) => {
                if (!active) {
                    return;
                }

                if (seedData) {
                    const nextAvatar =
                        avatarProfileRepository.normalize(seedData);
                    setAvatar((currentAvatar: any) =>
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
    }, [currentEndpoint, currentUserId, normalizedAvatarId, seedData]);

    if (loadStatus === 'running' && !avatar) {
        return {
            status: 'loading',
            emptyState: {
                loading: true,
                title: t('dialog.avatar.loading.loading_avatar_profile'),
                description: t(
                    'dialog.avatar.loading.fetching_the_current_vrchat_avatar_snapshot_for_this_dialog'
                )
            }
        };
    }

    if (!avatar) {
        return {
            status: 'empty',
            emptyState: {
                title: t('dialog.avatar.error.avatar_profile_unavailable'),
                description:
                    detail ||
                    t(
                        'dialog.avatar.description.avatar_snapshot_unavailable_description'
                    )
            }
        };
    }

    const imageUrl = convertFileUrlToImageUrl(
        avatar.imageUrl || avatar.thumbnailImageUrl,
        512
    );
    const isCurrentAvatar =
        normalizeEntityId(currentAvatarId) === normalizeEntityId(avatar.id);
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
        avatar.id && (availablePlatforms.isQuest || availablePlatforms.isIos)
    );
    const avatarForView: any = {
        ...avatar,
        gallery: avatarSideData.galleryRows,
        galleryImages: avatarSideData.galleryImages,
        fileAnalysis: avatarSideData.fileAnalysis,
        $isCached: avatarSideData.cache.inCache || avatar.$isCached,
        $cacheSize: avatarSideData.cache.cacheSize,
        $cacheLocked: avatarSideData.cache.cacheLocked,
        $cachePath: avatarSideData.cache.cachePath,
        $timeSpent: getCurrentAvatarLiveWearTime(avatar.id, avatar.$timeSpent)
    };

    function applyCurrentAvatarUpdate(nextAvatar: any) {
        const targetAvatarId = normalizeEntityId(nextAvatar?.id || avatar?.id);
        if (
            !targetAvatarId ||
            activeAvatarTargetRef.current.avatarId !== targetAvatarId ||
            activeAvatarTargetRef.current.endpoint !== currentEndpoint
        ) {
            return;
        }
        setAvatar((currentAvatar: any) =>
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

    return {
        status: 'ready',
        avatar,
        avatarActions,
        avatarForView,
        currentEndpoint,
        currentUserId,
        imageCropRequest,
        imageUrl,
        refs: {
            galleryUploadInputRef,
            imageUploadAvatarRef,
            imageUploadInputRef
        },
        setImageCropRequest,
        setOwnerEditor,
        viewState: {
            actionStatus,
            avatarBlocked,
            canManageAvatar,
            canSelectAvatar,
            canSelectFallbackAvatar,
            detail,
            fileAnalysis: avatarSideData.fileAnalysis,
            isCurrentAvatar,
            memo
        },
        ownerEditor,
        labels: {
            cropTitle: t('dialog.avatar.action.change_avatar_image')
        },
        applyCurrentAvatarUpdate
    };
}
