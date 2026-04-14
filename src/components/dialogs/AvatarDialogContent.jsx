import { useEffect, useMemo, useRef, useState } from 'react';
import {
    AppleIcon,
    BanIcon,
    Clock3Icon,
    HeartIcon,
    ImageIcon,
    LoaderCircleIcon,
    MonitorIcon,
    RefreshCwIcon,
    SmartphoneIcon,
    UserIcon
} from 'lucide-react';
import { toast } from 'sonner';

import { getPlatformInfo } from '@/lib/avatarPlatform.js';
import { formatDateFilter, timeToText } from '@/lib/dateTime.js';
import { convertFileUrlToImageUrl } from '@/lib/entityMedia.js';
import { getFileAnalysisForUnityPackages } from '@/lib/fileAnalysis.js';
import { compareUnityVersion } from '@/shared/utils/avatar.js';
import { backend } from '@/platform/tauri/index.js';
import { AvatarDialogTabbedView } from './AvatarDialogTabbedView.jsx';
import { AvatarContentTagsDialog, AvatarStylesDialog } from './AvatarOwnerEditDialogs.jsx';
import { ImageCropDialog } from '@/components/media/ImageCropDialog.jsx';
import { FavoriteActionMenu } from '@/components/favorites/FavoriteActionMenu.jsx';
import {
    avatarProfileRepository,
    memoRepository,
    mediaRepository,
    vrchatAuthRepository
} from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import {
    IMAGE_UPLOAD_ACCEPT,
    readFileAsBase64,
    validateImageUploadFile,
    withUploadTimeout
} from '@/shared/utils/imageUpload.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useDialogStore } from '@/state/dialogStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { extractFileId, extractFileVersion, extractVariantVersion } from '@/shared/utils/fileUtils.js';
import { Badge } from '@/ui/shadcn/badge.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import { Separator } from '@/ui/shadcn/separator.jsx';

function normalizeEntityId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function Section({ label, value, mono = false, children }) {
    return (
        <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {label}
            </div>
            {children ? (
                children
            ) : (
                <div className={mono ? 'break-all font-mono text-sm' : 'text-sm'}>
                    {value || '—'}
                </div>
            )}
        </div>
    );
}

function AvatarDialogEmptyState({ title, description, loading = false }) {
    return (
        <div className="flex min-h-56 items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6 text-center">
            <div className="max-w-sm space-y-2">
                {loading ? (
                    <div className="flex justify-center">
                        <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
                    </div>
                ) : null}
                <div className="text-sm font-medium">{title}</div>
                <div className="text-sm text-muted-foreground">{description}</div>
            </div>
        </div>
    );
}

function PlatformBadge({ label, rating, icon: Icon }) {
    return (
        <Badge variant="outline">
            {Icon ? <Icon className="mr-1 size-3.5" /> : null}
            {label}
            {rating ? <span className="ml-1 border-l pl-1">{rating}</span> : null}
        </Badge>
    );
}

function defaultAvatarSideData() {
    return {
        galleryRows: [],
        galleryImages: [],
        fileAnalysis: {},
        cache: {
            inCache: false,
            cacheSize: '',
            cacheLocked: false,
            cachePath: ''
        }
    };
}

function avatarGalleryImageUrl(file) {
    const versions = Array.isArray(file?.versions) ? file.versions : [];
    const latestVersion = versions[versions.length - 1];
    return latestVersion?.file?.url || file?.url || file?.fileUrl || file?.imageUrl || '';
}

function isCacheCandidatePackage(unityPackage, sdkUnityVersion = '') {
    if (!unityPackage || unityPackage.platform !== 'standalonewindows') {
        return false;
    }
    if (unityPackage.variant && unityPackage.variant !== 'standard' && unityPackage.variant !== 'security') {
        return false;
    }
    if (sdkUnityVersion && unityPackage.unitySortNumber && !compareUnityVersion(unityPackage.unitySortNumber, sdkUnityVersion)) {
        return false;
    }
    return true;
}

function resolveAssetBundleArgs(avatar, sdkUnityVersion = '') {
    const unityPackages = Array.isArray(avatar?.unityPackages) ? avatar.unityPackages : [];
    let selectedPackage = null;
    for (let index = unityPackages.length - 1; index >= 0; index -= 1) {
        const unityPackage = unityPackages[index];
        if (isCacheCandidatePackage(unityPackage, sdkUnityVersion)) {
            selectedPackage = unityPackage;
            break;
        }
    }
    if (!selectedPackage && sdkUnityVersion) {
        return resolveAssetBundleArgs(avatar, '');
    }
    const assetUrl = selectedPackage?.assetUrl || avatar?.assetUrl || '';
    const fileId = extractFileId(assetUrl);
    const fileVersion = Number.parseInt(extractFileVersion(assetUrl), 10);
    const variant = !selectedPackage?.variant || selectedPackage.variant === 'standard'
        ? 'security'
        : selectedPackage.variant;
    const variantVersion = Number.parseInt(extractVariantVersion(assetUrl), 10) || 0;
    if (!fileId || !Number.isFinite(fileVersion)) {
        return null;
    }
    return {
        fileId,
        fileVersion,
        variant,
        variantVersion
    };
}

async function readAvatarCacheInfo(avatar, endpoint = '') {
    const configResponse = await vrchatAuthRepository.getConfig({ endpoint }).catch(() => null);
    const sdkUnityVersion = String(configResponse?.json?.sdkUnityVersion || '');
    const args = resolveAssetBundleArgs(avatar, sdkUnityVersion);
    if (!args) {
        return defaultAvatarSideData().cache;
    }
    const cacheInfo = await backend.assetBundle.CheckVRChatCache(
        args.fileId,
        args.fileVersion,
        args.variant,
        args.variantVersion
    );
    const size = Number(cacheInfo?.Item1 ?? cacheInfo?.item1 ?? 0);
    const cacheLocked = Boolean(cacheInfo?.Item2 ?? cacheInfo?.item2);
    const cachePath = String(cacheInfo?.Item3 ?? cacheInfo?.item3 ?? '');
    return {
        inCache: size > 0,
        cacheSize: size > 0 ? `${(size / 1048576).toFixed(2)} MB` : '',
        cacheLocked,
        cachePath
    };
}

export function AvatarDialogContent({ avatarId, seedData = null }) {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentAvatarId = useRuntimeStore((state) => state.auth.currentUserSnapshot?.currentAvatar || '');
    const setAuthBootstrap = useRuntimeStore((state) => state.setAuthBootstrap);
    const remoteFavoriteAvatarIds = useFavoriteStore((state) => state.favoriteAvatarIds);
    const localFavoriteAvatarIds = useFavoriteStore((state) => state.localAvatarFavoritesList);
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const closeDialog = useDialogStore((state) => state.closeDialog);
    const updateEntityDialogMetadata = useDialogStore((state) => state.updateEntityDialogMetadata);
    const [avatar, setAvatar] = useState(() =>
        seedData ? avatarProfileRepository.normalize(seedData) : null
    );
    const [loadStatus, setLoadStatus] = useState(normalizedAvatarId ? 'running' : 'idle');
    const [actionStatus, setActionStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [memo, setMemo] = useState(() =>
        typeof seedData?.$memo === 'string' ? seedData.$memo : ''
    );
    const [avatarBlocked, setAvatarBlocked] = useState(false);
    const [avatarSideData, setAvatarSideData] = useState(() => defaultAvatarSideData());
    const [imageCropRequest, setImageCropRequest] = useState(null);
    const [ownerEditor, setOwnerEditor] = useState(null);
    const actionStatusRef = useRef('idle');
    const memoRevisionRef = useRef(0);
    const moderationRevisionRef = useRef(0);
    const activeAvatarTargetRef = useRef({ avatarId: normalizedAvatarId, endpoint: currentEndpoint });
    const imageUploadInputRef = useRef(null);
    const imageUploadAvatarRef = useRef(null);
    const galleryUploadInputRef = useRef(null);

    useEffect(() => {
        activeAvatarTargetRef.current = { avatarId: normalizedAvatarId, endpoint: currentEndpoint };
    }, [currentEndpoint, normalizedAvatarId]);

    useEffect(() => {
        setAvatar(seedData ? avatarProfileRepository.normalize(seedData) : null);
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
            const sdkUnityVersion = String(configResult.status === 'fulfilled' ? configResult.value?.json?.sdkUnityVersion || '' : '');
            const galleryRows = galleryResult.status === 'fulfilled' ? galleryResult.value : [];
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
                    galleryImages: galleryRows.map(avatarGalleryImageUrl).filter(Boolean),
                    fileAnalysis: fileAnalysisResult.status === 'fulfilled' ? fileAnalysisResult.value : {},
                    cache: cacheResult.status === 'fulfilled' ? cacheResult.value : defaultAvatarSideData().cache
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
                setAvatarBlocked(rows.some((row) =>
                    normalizeEntityId(row?.targetAvatarId) === normalizedAvatarId &&
                    normalizeEntityId(row?.avatarModerationType).toLowerCase() === 'block'
                ));
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

        setAvatar(seedData ? avatarProfileRepository.normalize(seedData) : null);
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
                        : { ...nextAvatar, $memo: currentAvatar?.$memo ?? nextAvatar.$memo ?? '' }
                );
                setLoadStatus('ready');
            })
            .catch((error) => {
                if (!active) {
                    return;
                }

                if (seedData) {
                    const nextAvatar = avatarProfileRepository.normalize(seedData);
                    setAvatar((currentAvatar) =>
                        memoRevisionRef.current === memoRevision
                            ? nextAvatar
                            : { ...nextAvatar, $memo: currentAvatar?.$memo ?? nextAvatar.$memo ?? '' }
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
                    error instanceof Error ? error.message : 'Failed to load the avatar profile.'
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
                title="Loading avatar profile"
                description="Fetching the current VRChat avatar snapshot for this dialog."
            />
        );
    }

    if (!avatar) {
        return (
            <AvatarDialogEmptyState
                title="Avatar profile unavailable"
                description={detail || 'VRCX could not resolve an avatar snapshot for this dialog.'}
            />
        );
    }

    const imageUrl = convertFileUrlToImageUrl(
        avatar.imageUrl || avatar.thumbnailImageUrl,
        512
    );
    const platformInfo = getPlatformInfo(avatar.unityPackages);
    const isCurrentAvatar = normalizeEntityId(currentAvatarId) === normalizeEntityId(avatar.id);
    const isFavorite = favoriteAvatarIds.has(normalizeEntityId(avatar.id));
    const canManageAvatar =
        normalizeEntityId(avatar.authorId) === normalizeEntityId(currentUserId);
    const localTags = Array.isArray(avatar.$tags) ? avatar.$tags : [];
    const remoteTags = Array.isArray(avatar.tags) ? avatar.tags : [];
    const contentTags = remoteTags.filter((tag) => tag.startsWith('content_'));
    const authorTags = remoteTags.filter((tag) => tag.startsWith('author_tag_'));
    const otherTags = remoteTags.filter(
        (tag) => !tag.startsWith('content_') && !tag.startsWith('author_tag_')
    );
    const imposterPackage = Array.isArray(avatar.unityPackages)
        ? avatar.unityPackages.find((unityPackage) => unityPackage?.variant === 'impostor')
        : null;
    const hasImposter = Boolean(imposterPackage);
    const imposterVersion = normalizeEntityId(imposterPackage?.impostorizerVersion);
    const canSelectAvatar =
        !avatarBlocked &&
        !isCurrentAvatar &&
        normalizeEntityId(avatar.id) &&
        (avatar.releaseStatus !== 'private' ||
            normalizeEntityId(avatar.authorId) === normalizeEntityId(currentUserId));
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
            toast.success('Avatar refreshed.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to refresh avatar.');
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
            const currentUserResponse = await vrchatAuthRepository.getCurrentUser({
                endpoint: currentEndpoint
            });
            const nextUser =
                currentUserResponse.json && typeof currentUserResponse.json === 'object'
                    ? currentUserResponse.json
                    : null;
            if (nextUser?.id) {
                setAuthBootstrap({
                    currentUserId: nextUser.id,
                    currentUserDisplayName: nextUser.displayName || nextUser.username || nextUser.id,
                    currentUserSnapshot: nextUser
                });
            }
            toast.success('Avatar selected.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to select avatar.');
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
            currentUserResponse.json && typeof currentUserResponse.json === 'object'
                ? currentUserResponse.json
                : null;
        if (nextUser?.id) {
            setAuthBootstrap({
                currentUserId: nextUser.id,
                currentUserDisplayName: nextUser.displayName || nextUser.username || nextUser.id,
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
            title: 'Select fallback avatar?',
            description: `Use ${avatar.name || avatar.id} as your VRChat fallback avatar?`,
            confirmText: 'Select Fallback',
            cancelText: 'Cancel'
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
            toast.success('Fallback avatar updated.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to select fallback avatar.');
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
            cancelText: 'Cancel',
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
            toast.success(isPublic ? 'Avatar made public.' : 'Avatar made private.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update avatar release status.');
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
            title: 'Rename avatar',
            description: avatar.name || avatar.id,
            inputValue: avatar.name || '',
            confirmText: 'Save',
            cancelText: 'Cancel'
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
            toast.success('Avatar renamed.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to rename avatar.');
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
            title: 'Change avatar description',
            description: avatar.name || avatar.id,
            inputValue: avatar.description || '',
            multiline: true,
            confirmText: 'Save',
            cancelText: 'Cancel'
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
            toast.success('Avatar description updated.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update avatar description.');
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
            title: 'Delete avatar?',
            description: avatar.name || avatar.id,
            confirmText: 'Delete',
            cancelText: 'Cancel',
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
                    ? 'Avatar deleted, but current user snapshot refresh failed.'
                    : 'Avatar deleted.'
            );
            const dialogState = useDialogStore.getState();
            if (dialogState.breadcrumbs.length > 1) {
                dialogState.popToBreadcrumb(dialogState.breadcrumbs.length - 2);
            } else {
                closeDialog();
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to delete avatar.');
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
        const selectedAvatar = request?.avatar || imageUploadAvatarRef.current || avatar;
        const avatarId = normalizeEntityId(selectedAvatar?.id);
        const requestEndpoint = currentEndpoint;
        if (!blob || !avatarId) {
            return;
        }

        actionStatusRef.current = 'image-upload';
        setActionStatus('image-upload');

        try {
            const base64Body = await readFileAsBase64(blob);
            const base64File = await mediaRepository.resizeImageToFitLimits(base64Body);
            const result = await withUploadTimeout(
                mediaRepository.uploadAvatarImageLegacy({
                    avatarId,
                    imageUrl: selectedAvatar.imageUrl || selectedAvatar.thumbnailImageUrl || '',
                    base64File,
                    blob,
                    endpoint: requestEndpoint
                })
            );
            const activeTarget = activeAvatarTargetRef.current;
            if (activeTarget.avatarId !== avatarId || activeTarget.endpoint !== requestEndpoint) {
                return;
            }
            const currentAvatar = avatarProfileRepository.normalize(result.avatar, {
                localTags: selectedAvatar.$tags,
                timeSpent: selectedAvatar.$timeSpent,
                memo: selectedAvatar.$memo,
                cachedAvatar: selectedAvatar.$isCached
            });
            setAvatar(currentAvatar);
            setDetail(`Avatar image updated for ${selectedAvatar.name || avatarId}.`);
            toast.success('Avatar image updated.');
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Failed to upload avatar image.';
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
                title: 'Create impostor?',
                confirmText: 'Create',
                success: 'Impostor queued for creation.',
                error: 'Failed to create impostor.'
            },
            delete: {
                title: 'Delete impostor?',
                confirmText: 'Delete',
                success: 'Impostor deleted.',
                error: 'Failed to delete impostor.',
                destructive: true
            },
            regenerate: {
                title: 'Regenerate impostor?',
                confirmText: 'Regenerate',
                success: 'Impostor queued for regeneration.',
                error: 'Failed to regenerate impostor.',
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
            cancelText: 'Cancel',
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
                    ? `${label.success} Avatar state refresh failed.`
                    : label.success
            );
        } catch (error) {
            toast.error(error instanceof Error ? error.message : label.error);
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function setAvatarBlock(enabled) {
        if (!avatar.id || isCurrentAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'avatar-block';
        setActionStatus('avatar-block');
        const result = await confirm({
            title: enabled ? 'Block avatar?' : 'Unblock avatar?',
            description: avatar.name || avatar.id,
            confirmText: enabled ? 'Block' : 'Unblock',
            cancelText: 'Cancel',
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
            toast.success(enabled ? 'Avatar blocked.' : 'Avatar unblocked.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update avatar moderation.');
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
            toast.success(nextMemo ? 'Memo saved.' : 'Memo cleared.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to save memo.');
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
            toast.error(error instanceof Error ? error.message : 'Failed to open avatar cache folder.');
        }
    }

    async function deleteAvatarCache() {
        if (actionStatusRef.current !== 'idle') {
            return;
        }
        const configResponse = await vrchatAuthRepository.getConfig({ endpoint: currentEndpoint }).catch(() => null);
        const args = resolveAssetBundleArgs(
            avatar,
            String(configResponse?.json?.sdkUnityVersion || '')
        );
        if (!args) {
            toast.error('Avatar cache location unavailable.');
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
            toast.success('Avatar cache deleted.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to delete avatar cache.');
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
            toast.error(validation.reason === 'too_large' ? 'Selected file is too large.' : 'Selected file is not an image.');
            return;
        }
        actionStatusRef.current = 'gallery-upload';
        setActionStatus('gallery-upload');
        try {
            const base64Body = await readFileAsBase64(file);
            await mediaRepository.uploadAvatarGalleryImage(base64Body, targetAvatarId, {
                endpoint: requestEndpoint
            });
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
                    galleryImages: galleryRows.map(avatarGalleryImageUrl).filter(Boolean)
                }));
                toast.success('Avatar gallery image uploaded.');
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to upload avatar gallery image.');
        } finally {
            if (actionStatusRef.current === 'gallery-upload') {
                actionStatusRef.current = 'idle';
                setActionStatus('idle');
            }
        }
    }

    async function editMemo() {
        const result = await prompt({
            title: 'Edit local memo',
            description: avatar.name || avatar.id,
            inputValue: memo,
            multiline: true,
            confirmText: 'Save',
            cancelText: 'Cancel'
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
                onReleaseStatus={(nextStatus) => void updateReleaseStatus(nextStatus)}
                onAvatarBlock={(enabled) => void setAvatarBlock(enabled)}
                onEditMemo={() => void editMemo()}
                onSaveMemo={(nextMemo) => saveMemo(nextMemo)}
                onOpenCache={() => void openAvatarCacheFolder()}
                onDeleteCache={() => void deleteAvatarCache()}
                onUploadGallery={() => beginAvatarGalleryUpload()}
                onRename={() => void renameAvatar()}
                onChangeDescription={() => void changeAvatarDescription()}
                onChangeContentTags={() => void changeAvatarContentTags()}
                onChangeStylesAndAuthorTags={() => void changeAvatarStylesAndAuthorTags()}
                onChangeImage={() => void beginAvatarImageUpload()}
                onCreateImposter={() => void updateAvatarImposter('create')}
                onDeleteImposter={() => void updateAvatarImposter('delete')}
                onRegenerateImposter={() => void updateAvatarImposter('regenerate')}
                onDelete={() => void deleteAvatar()}
            />
            <AvatarContentTagsDialog
                open={ownerEditor === 'content-tags'}
                avatar={avatar}
                currentUserId={currentUserId}
                endpoint={currentEndpoint}
                onOpenChange={(open) => setOwnerEditor(open ? 'content-tags' : null)}
                onSavedCurrentAvatar={(nextAvatar) => applyCurrentAvatarUpdate(nextAvatar)}
            />
            <AvatarStylesDialog
                open={ownerEditor === 'styles'}
                avatar={avatar}
                endpoint={currentEndpoint}
                onOpenChange={(open) => setOwnerEditor(open ? 'styles' : null)}
                onSavedCurrentAvatar={(nextAvatar) => applyCurrentAvatarUpdate(nextAvatar)}
            />
            <input
                ref={imageUploadInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={onFileChangeAvatarImage}
            />
            <input
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
                title="Change avatar image"
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
