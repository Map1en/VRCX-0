import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AvatarProfileRecord } from '@/domain/entities/avatar';
import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import { getCurrentAvatarLiveWearTime } from '@/services/avatarWearTimeService';
import { enrichEntityDialogHistory } from '@/services/dialogService';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { persistFavoriteAvatarDetails } from '@/services/favoriteAvatarCacheService';
import { getAvailablePlatforms } from '@/shared/utils/avatarPlatform';
import { useDialogStore } from '@/state/dialogStore';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useVrchatConfigStore } from '@/state/vrchatConfigStore';

import { createAvatarDialogActions } from './avatarDialogActions';
import type {
    AvatarActionStatus,
    AvatarDialogInput,
    AvatarDialogTab,
    AvatarImageCropRequest,
    AvatarLoadStatus,
    AvatarOwnerEditor,
    AvatarViewRecord
} from './avatarDialogTypes';
import { useAvatarDialogSideData } from './useAvatarDialogSideData';

function normalizeEntityId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function useAvatarDialogState({
    avatarId,
    seedData = null
}: AvatarDialogInput) {
    const { t } = useTranslation();
    const sdkUnityVersion = useVrchatConfigStore((state) =>
        String(state.snapshot?.sdkUnityVersion || '')
    );

    const normalizedAvatarId = avatarId?.trim() ?? '';
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentAvatarId = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot?.currentAvatar || ''
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
    const [loadStatus, setLoadStatus] = useState<AvatarLoadStatus>(
        normalizedAvatarId ? 'running' : 'idle'
    );
    const [actionStatus, setActionStatus] =
        useState<AvatarActionStatus>('idle');
    const [detail, setDetail] = useState('');
    const [memo, setMemo] = useState(() =>
        seedData ? avatarProfileRepository.normalize(seedData).$memo : ''
    );
    const [avatarBlocked, setAvatarBlocked] = useState(false);
    const [activeTabState, setActiveTabState] = useState<{
        avatarId: string;
        endpoint: string;
        tab: AvatarDialogTab;
    }>(() => ({
        avatarId: normalizedAvatarId,
        endpoint: currentEndpoint,
        tab: 'info'
    }));
    const activeTab =
        activeTabState.avatarId === normalizedAvatarId &&
        activeTabState.endpoint === currentEndpoint
            ? activeTabState.tab
            : 'info';
    const {
        avatarSideData,
        fileAnalysisStatus,
        galleryStatus,
        setAvatarSideData
    } = useAvatarDialogSideData({
        avatar,
        currentEndpoint,
        galleryActive: activeTab === 'gallery',
        sdkUnityVersion
    });
    const [imageCropRequest, setImageCropRequest] =
        useState<AvatarImageCropRequest | null>(null);
    const [ownerEditor, setOwnerEditor] = useState<AvatarOwnerEditor>(null);
    const actionStatusRef = useRef<AvatarActionStatus>('idle');
    const memoRevisionRef = useRef(0);
    const moderationRevisionRef = useRef(0);
    const activeAvatarTargetRef = useRef({
        avatarId: normalizedAvatarId,
        endpoint: currentEndpoint
    });
    const imageUploadInputRef = useRef<HTMLInputElement | null>(null);
    const imageUploadAvatarRef = useRef<AvatarProfileRecord | null>(null);
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
        enrichEntityDialogHistory({
            kind: 'avatar',
            entityId: avatar.id,
            title: avatar.name,
            imageUrl: avatar.thumbnailImageUrl || avatar.imageUrl
        });
    }, [
        avatar?.id,
        avatar?.imageUrl,
        avatar?.name,
        avatar?.thumbnailImageUrl,
        updateEntityDialogMetadata
    ]);

    useEffect(() => {
        if (!avatar?.id) {
            imageUploadAvatarRef.current = null;
            setImageCropRequest(null);
        }
    }, [avatar?.id]);

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
            .getAvatarModerations()
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
        setMemo(
            seedData ? avatarProfileRepository.normalize(seedData).$memo : ''
        );
        setLoadStatus('running');
        setDetail('');
        const memoRevision = memoRevisionRef.current;

        avatarProfileRepository
            .getAvatarProfile({
                avatarId: normalizedAvatarId,
                dialog: true,
                currentUserId
            })
            .then((nextAvatar) => {
                if (!active) {
                    return;
                }

                persistFavoriteAvatarDetails(nextAvatar);
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
            .catch((error: unknown) => {
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
    }, [currentEndpoint, currentUserId, normalizedAvatarId, seedData]);

    if (loadStatus === 'running' && !avatar) {
        return {
            status: 'loading' as const,
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
            status: 'empty' as const,
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
    const avatarForView: AvatarViewRecord = {
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

    function applyCurrentAvatarUpdate(nextAvatar: unknown) {
        const normalizedNextAvatar =
            avatarProfileRepository.normalize(nextAvatar);
        const targetAvatarId = normalizeEntityId(
            normalizedNextAvatar.id || avatarForView.id
        );
        if (
            !targetAvatarId ||
            activeAvatarTargetRef.current.avatarId !== targetAvatarId ||
            activeAvatarTargetRef.current.endpoint !== currentEndpoint
        ) {
            return;
        }
        setAvatar((currentAvatar) => {
            if (
                !currentAvatar ||
                normalizeEntityId(currentAvatar.id) !== targetAvatarId
            ) {
                return currentAvatar;
            }
            return avatarProfileRepository.normalize(normalizedNextAvatar, {
                localTags: currentAvatar.$tags,
                timeSpent: currentAvatar.$timeSpent,
                memo: currentAvatar.$memo,
                cachedAvatar: currentAvatar.$isCached
            });
        });
    }

    const avatarActions = createAvatarDialogActions({
        actionStatusRef,
        activeAvatarTargetRef,
        applyCurrentAvatarUpdate,
        avatar,
        avatarSideData,
        canManageAvatar,
        canSelectAvatar: Boolean(canSelectAvatar),
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
        setAvatar,
        setAvatarBlocked,
        setAvatarSideData,
        setDetail,
        setImageCropRequest,
        setMemo,
        setOwnerEditor,
        t
    });

    function setActiveTab(tab: AvatarDialogTab) {
        setActiveTabState({
            avatarId: normalizedAvatarId,
            endpoint: currentEndpoint,
            tab
        });
    }

    return {
        status: 'ready' as const,
        avatar,
        avatarActions,
        avatarForView,
        activeTab,
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
            canSelectAvatar: Boolean(canSelectAvatar),
            canSelectFallbackAvatar,
            detail,
            fileAnalysis: avatarSideData.fileAnalysis,
            fileAnalysisStatus,
            galleryStatus,
            isCurrentAvatar,
            memo
        },
        ownerEditor,
        labels: {
            cropTitle: t('dialog.avatar.action.change_avatar_image')
        },
        setActiveTab,
        applyCurrentAvatarUpdate
    };
}
