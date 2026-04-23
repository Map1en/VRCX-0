import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { ImageCropDialog } from '@/components/media/ImageCropDialog.jsx';
import { openExternalLink } from '@/lib/entityMedia.js';
import { mediaRepository, vrchatAuthRepository } from '@/repositories/index.js';
import userProfileRepository from '@/repositories/userProfileRepository.js';
import { emojiAnimationStyleList } from '@/shared/constants/emoji.js';
import {
    readFileAsBase64,
    validateImageUploadFile,
    withUploadTimeout
} from '@/shared/utils/imageUpload.js';
import { normalizeVrchatEndpointDomain } from '@/shared/vrchatEndpoint.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { appI18n } from '@/services/i18nService.js';
import { GalleryHeader } from './components/GalleryHeader.jsx';
import { GalleryPreviewDialog } from './components/GalleryPreviewDialog.jsx';
import { GalleryTabs } from './components/GalleryTabs.jsx';
import {
    EMPTY_ASSETS,
    FILE_TABS,
    UPLOAD_ASPECT_RATIOS
} from './galleryConstants.js';
const MAX_IMAGE_UPLOAD_BYTES = 20_000_000;

function buildProfilePicOverride(endpoint, fileId) {
    if (!fileId) {
        return '';
    }

    const base = normalizeVrchatEndpointDomain(endpoint);
    return `${base}/file/${fileId}/1`;
}

function getLocalTimestampString() {
    const date = new Date();
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 19);
}

function getRuntimeAuthTarget() {
    const runtimeAuth = useRuntimeStore.getState().auth;
    return {
        userId: runtimeAuth.currentUserId || '',
        endpoint: runtimeAuth.currentUserEndpoint || ''
    };
}

function isRuntimeAuthTarget(authTarget) {
    const runtimeAuth = getRuntimeAuthTarget();
    return (
        runtimeAuth.userId === authTarget.userId &&
        runtimeAuth.endpoint === authTarget.endpoint
    );
}

function resolveEmojiStyleName(rawValue) {
    const normalizedValue = String(rawValue || '').toLowerCase();
    const match = Object.keys(emojiAnimationStyleList).find(
        (styleName) => styleName.toLowerCase() === normalizedValue
    );
    return match || 'Stop';
}

function parseEmojiUploadSettings(fileName, currentSettings = {}) {
    const next = {
        isAnimated: Boolean(currentSettings.isAnimated),
        animationStyle: currentSettings.animationStyle || 'Stop',
        fps: Number(currentSettings.fps) || 15,
        frames: Number(currentSettings.frames) || 4,
        loopPingPong: Boolean(currentSettings.loopPingPong)
    };

    for (const value of String(fileName || '')
        .replace(/\.[^/.]+$/, '')
        .split('_')) {
        if (value.endsWith('animationStyle')) {
            next.isAnimated = false;
            next.animationStyle = resolveEmojiStyleName(
                value.replace('animationStyle', '')
            );
        } else if (value.endsWith('frames')) {
            const frames = Number.parseInt(value.replace('frames', ''), 10);
            if (Number.isFinite(frames)) {
                next.isAnimated = true;
                next.frames = Math.min(64, Math.max(2, frames));
            }
        } else if (value.endsWith('fps')) {
            const fps = Number.parseInt(value.replace('fps', ''), 10);
            if (Number.isFinite(fps)) {
                next.fps = Math.min(64, Math.max(1, fps));
            }
        } else if (value.endsWith('loopStyle')) {
            next.loopPingPong =
                value.replace('loopStyle', '').toLowerCase() === 'pingpong';
        }
    }

    return next;
}

function validateImageFile(file, t) {
    const validation = validateImageUploadFile(file, {
        maxSize: MAX_IMAGE_UPLOAD_BYTES
    });
    if (!validation.ok) {
        toast.error(
            validation.reason === 'too_large'
                ? t('message.file.too_large')
                : t('message.file.not_image')
        );
        return false;
    }

    return true;
}

export function GalleryPage() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const uploadInputRef = useRef(null);
    const uploadTargetRef = useRef('gallery');
    const uploadAuthTargetRef = useRef(null);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const [activeTab, setActiveTab] = useState('gallery');
    const [assets, setAssets] = useState(EMPTY_ASSETS);
    const [loadingByTab, setLoadingByTab] = useState({});
    const [uploadingTab, setUploadingTab] = useState('');
    const [mutatingKey, setMutatingKey] = useState('');
    const [preview, setPreview] = useState(null);
    const [cropRequest, setCropRequest] = useState(null);
    const [printUploadNote, setPrintUploadNote] = useState('');
    const [printCropBorder, setPrintCropBorder] = useState(true);
    const [emojiAnimFps, setEmojiAnimFps] = useState(15);
    const [emojiAnimFrameCount, setEmojiAnimFrameCount] = useState(4);
    const [emojiAnimType, setEmojiAnimType] = useState(false);
    const [emojiAnimationStyle, setEmojiAnimationStyle] = useState('Stop');
    const [emojiAnimLoopPingPong, setEmojiAnimLoopPingPong] = useState(false);
    const [galleryLimits, setGalleryLimits] = useState({
        maxUserEmoji: null,
        maxUserStickers: null
    });
    const profilePicOverride = currentUserSnapshot?.profilePicOverride || '';
    const userIcon = currentUserSnapshot?.userIcon || '';
    const isVrcPlusSupporter = Boolean(
        currentUserSnapshot?.$isVRCPlus ||
        currentUserSnapshot?.tags?.includes?.('system_supporter') ||
        globalThis?.$debug?.debugVrcPlus
    );

    const tabCounts = useMemo(
        () => ({
            gallery: `${assets.gallery.length}/64`,
            icons: `${assets.icons.length}/64`,
            emojis: `${assets.emojis.length}/${galleryLimits.maxUserEmoji ?? '-'}`,
            stickers: `${assets.stickers.length}/${galleryLimits.maxUserStickers ?? '-'}`,
            prints: `${assets.prints.length}/64`,
            inventory: String(assets.inventory.length)
        }),
        [assets, galleryLimits.maxUserEmoji, galleryLimits.maxUserStickers]
    );

    useEffect(() => {
        if (!currentUserId) {
            setAssets(EMPTY_ASSETS);
            setLoadingByTab({});
            setGalleryLimits({
                maxUserEmoji: null,
                maxUserStickers: null
            });
            return;
        }
        void refreshAll();
    }, [currentEndpoint, currentUserId]);

    useEffect(() => {
        if (!currentUserId) {
            return undefined;
        }
        let active = true;
        vrchatAuthRepository
            .getConfig({ endpoint: currentEndpoint || '' })
            .then((response) => {
                if (!active) {
                    return;
                }
                const config =
                    response?.json && typeof response.json === 'object'
                        ? response.json
                        : {};
                setGalleryLimits({
                    maxUserEmoji: Number.isFinite(Number(config.maxUserEmoji))
                        ? Number(config.maxUserEmoji)
                        : null,
                    maxUserStickers: Number.isFinite(
                        Number(config.maxUserStickers)
                    )
                        ? Number(config.maxUserStickers)
                        : null
                });
            })
            .catch(() => {
                if (active) {
                    setGalleryLimits({
                        maxUserEmoji: null,
                        maxUserStickers: null
                    });
                }
            });
        return () => {
            active = false;
        };
    }, [currentEndpoint, currentUserId]);

    function getAuthTarget() {
        return {
            userId: currentUserId || '',
            endpoint: currentEndpoint || ''
        };
    }

    function setTabLoading(tab, value) {
        setLoadingByTab((current) => ({ ...current, [tab]: Boolean(value) }));
    }

    function updateAssets(tab, rows) {
        setAssets((current) => ({
            ...current,
            [tab]: Array.isArray(rows) ? rows : []
        }));
    }

    async function refreshFileTab(tab) {
        const definition = FILE_TABS[tab];
        const authTarget = getAuthTarget();
        setTabLoading(tab, true);
        try {
            const { json } = await mediaRepository.getFileList(
                { n: 100, tag: definition.tag },
                { endpoint: currentEndpoint }
            );
            if (isRuntimeAuthTarget(authTarget)) {
                updateAssets(
                    tab,
                    Array.isArray(json) ? [...json].reverse() : []
                );
            }
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : appI18n.t('view.tools.generated_toast.failed_to_load_value', { value: tab })
                );
            }
        } finally {
            if (isRuntimeAuthTarget(authTarget)) {
                setTabLoading(tab, false);
            }
        }
    }

    async function refreshPrints() {
        const authTarget = getAuthTarget();
        setTabLoading('prints', true);
        try {
            const { json } = await mediaRepository.getPrints(
                { userId: currentUserId, n: 100 },
                { endpoint: currentEndpoint }
            );
            const rows = Array.isArray(json) ? json : [];
            rows.sort(
                (left, right) =>
                    new Date(
                        right?.timestamp || right?.createdAt || 0
                    ).getTime() -
                    new Date(left?.timestamp || left?.createdAt || 0).getTime()
            );
            if (isRuntimeAuthTarget(authTarget)) {
                updateAssets('prints', rows);
            }
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : appI18n.t('view.tools.generated_toast.failed_to_load_prints')
                );
            }
        } finally {
            if (isRuntimeAuthTarget(authTarget)) {
                setTabLoading('prints', false);
            }
        }
    }

    async function refreshInventory() {
        const authTarget = getAuthTarget();
        const nextItems = [];
        setTabLoading('inventory', true);
        try {
            for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
                const { json } = await mediaRepository.getInventoryItems(
                    { n: 100, offset: pageIndex * 100, order: 'newest' },
                    { endpoint: currentEndpoint }
                );
                const pageRows = Array.isArray(json?.data) ? json.data : [];
                nextItems.push(...pageRows);
                if (pageRows.length === 0) {
                    break;
                }
            }
            if (isRuntimeAuthTarget(authTarget)) {
                updateAssets('inventory', nextItems);
            }
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : appI18n.t('view.tools.generated_toast.failed_to_load_inventory')
                );
            }
        } finally {
            if (isRuntimeAuthTarget(authTarget)) {
                setTabLoading('inventory', false);
            }
        }
    }

    async function refreshTab(tab = activeTab) {
        if (FILE_TABS[tab]) {
            await refreshFileTab(tab);
        } else if (tab === 'prints') {
            await refreshPrints();
        } else if (tab === 'inventory') {
            await refreshInventory();
        }
    }

    async function refreshAll() {
        await Promise.allSettled([
            refreshFileTab('gallery'),
            refreshFileTab('icons'),
            refreshFileTab('emojis'),
            refreshFileTab('stickers'),
            refreshPrints(),
            refreshInventory()
        ]);
    }

    function beginUpload(tab) {
        if (!isVrcPlusSupporter) {
            toast.error(t('message.vrcplus.required'));
            return;
        }
        uploadTargetRef.current = tab;
        uploadAuthTargetRef.current = getAuthTarget();
        uploadInputRef.current?.click();
    }

    function getEmojiUploadParams(settings) {
        const params = {
            tag: settings.isAnimated ? 'emojianimated' : 'emoji',
            animationStyle: String(
                settings.animationStyle || 'Stop'
            ).toLowerCase(),
            maskTag: 'square'
        };
        if (settings.isAnimated) {
            params.frames = Math.min(
                64,
                Math.max(2, Number(settings.frames) || 4)
            );
            params.framesOverTime = Math.min(
                64,
                Math.max(1, Number(settings.fps) || 15)
            );
        }
        if (settings.loopPingPong) {
            params.loopStyle = 'pingpong';
        }
        return params;
    }

    function uploadAsset(tab, base64Body, settings) {
        if (tab === 'gallery') {
            return mediaRepository.uploadGalleryImage(base64Body, {
                endpoint: currentEndpoint
            });
        }
        if (tab === 'icons') {
            return mediaRepository.uploadVrcPlusIcon(base64Body, {
                endpoint: currentEndpoint
            });
        }
        if (tab === 'emojis') {
            return mediaRepository.uploadEmoji(
                base64Body,
                getEmojiUploadParams(settings),
                { endpoint: currentEndpoint }
            );
        }
        if (tab === 'stickers') {
            return mediaRepository.uploadSticker(base64Body, {
                endpoint: currentEndpoint
            });
        }
        if (tab === 'prints') {
            return mediaRepository.uploadPrint(base64Body, {
                endpoint: currentEndpoint,
                cropWhiteBorder: printCropBorder,
                params: {
                    note: printUploadNote,
                    timestamp: getLocalTimestampString()
                }
            });
        }
        throw new Error(`Unsupported upload target: ${tab}`);
    }

    async function uploadSelectedFile(event) {
        const file = event.target.files?.[0] || null;
        event.target.value = '';

        if (!file) {
            return;
        }

        if (!isVrcPlusSupporter) {
            toast.error(t('message.vrcplus.required'));
            return;
        }
        if (!validateImageFile(file, t)) {
            return;
        }

        const tab = uploadTargetRef.current || activeTab;
        const authTarget = uploadAuthTargetRef.current || getAuthTarget();
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }
        const settings =
            tab === 'emojis'
                ? parseEmojiUploadSettings(file.name, {
                      isAnimated: emojiAnimType,
                      animationStyle: emojiAnimationStyle,
                      fps: emojiAnimFps,
                      frames: emojiAnimFrameCount,
                      loopPingPong: emojiAnimLoopPingPong
                  })
                : {
                      isAnimated: emojiAnimType,
                      animationStyle: emojiAnimationStyle,
                      fps: emojiAnimFps,
                      frames: emojiAnimFrameCount,
                      loopPingPong: emojiAnimLoopPingPong
                  };
        if (tab === 'emojis') {
            setEmojiAnimType(settings.isAnimated);
            setEmojiAnimationStyle(settings.animationStyle);
            setEmojiAnimFps(settings.fps);
            setEmojiAnimFrameCount(settings.frames);
            setEmojiAnimLoopPingPong(settings.loopPingPong);
        }

        setCropRequest({
            tab,
            file,
            settings,
            authTarget,
            aspectRatio: UPLOAD_ASPECT_RATIOS[tab] || 1
        });
    }

    async function confirmCroppedUpload(blob) {
        const request = cropRequest;
        if (!request || !blob || !isRuntimeAuthTarget(request.authTarget)) {
            return;
        }

        const { tab, settings, authTarget } = request;
        setUploadingTab(tab);
        try {
            const base64Body = await readFileAsBase64(blob);
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }

            const args = await withUploadTimeout(
                uploadAsset(tab, base64Body, settings)
            );
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            if (args?.json) {
                setAssets((current) => ({
                    ...current,
                    [tab]: [
                        args.json,
                        ...(current[tab] || []).filter(
                            (item) => item.id !== args.json.id
                        )
                    ]
                }));
            } else {
                await refreshTab(tab);
            }
            toast.success(t('message.upload.success'));
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('message.upload.error')
                );
            }
        } finally {
            setUploadingTab('');
            uploadAuthTargetRef.current = null;
            setCropRequest(null);
        }
    }

    async function deleteFileAsset(tab, fileId) {
        const normalizedFileId =
            typeof fileId === 'string'
                ? fileId.trim()
                : String(fileId ?? '').trim();
        if (!normalizedFileId) {
            return;
        }

        const authTarget = getAuthTarget();
        const result = await confirm({
            title: appI18n.t('view.tools.generated_modal.delete_value_item', { value: tab }),
            description: normalizedFileId,
            confirmText: appI18n.t('common.actions.delete'),
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }

        setMutatingKey(`${tab}:${normalizedFileId}`);

        try {
            await mediaRepository.deleteFile(normalizedFileId, {
                endpoint: currentEndpoint
            });
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            setAssets((current) => ({
                ...current,
                [tab]: (current[tab] || []).filter(
                    (file) => file.id !== normalizedFileId
                )
            }));
            toast.success(t('view.tools.generated.media_item_deleted'));
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : appI18n.t('view.tools.generated_toast.failed_to_delete_media_item')
                );
            }
        } finally {
            setMutatingKey((current) =>
                current === `${tab}:${normalizedFileId}` ? '' : current
            );
        }
    }

    async function deletePrint(printId) {
        const normalizedPrintId =
            typeof printId === 'string'
                ? printId.trim()
                : String(printId ?? '').trim();
        if (!normalizedPrintId) {
            return;
        }

        const authTarget = getAuthTarget();
        const result = await confirm({
            title: appI18n.t('view.tools.generated_modal.delete_print'),
            description: normalizedPrintId,
            confirmText: appI18n.t('common.actions.delete'),
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }

        setMutatingKey(`prints:${normalizedPrintId}`);
        try {
            await mediaRepository.deletePrint(normalizedPrintId, {
                endpoint: currentEndpoint
            });
            if (isRuntimeAuthTarget(authTarget)) {
                setAssets((current) => ({
                    ...current,
                    prints: current.prints.filter(
                        (print) => print.id !== normalizedPrintId
                    )
                }));
                toast.success(t('view.tools.generated.print_deleted'));
            }
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : appI18n.t('view.tools.generated_toast.failed_to_delete_print')
                );
            }
        } finally {
            setMutatingKey((current) =>
                current === `prints:${normalizedPrintId}` ? '' : current
            );
        }
    }

    async function setProfileField(fieldName, fileId) {
        if (!isVrcPlusSupporter) {
            toast.error(t('message.vrcplus.required'));
            return;
        }
        if (!currentUserId) {
            toast.error(t('view.tools.generated.no_current_user_is_available'));
            return;
        }

        const normalizedFileId =
            typeof fileId === 'string'
                ? fileId.trim()
                : String(fileId ?? '').trim();
        const nextValue = buildProfilePicOverride(
            currentEndpoint,
            normalizedFileId
        );
        if (nextValue === currentUserSnapshot?.[fieldName]) {
            return;
        }

        const authTarget = getAuthTarget();
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }

        setMutatingKey(`${fieldName}:${normalizedFileId || 'clear'}`);

        try {
            const nextUser = await userProfileRepository.updateCurrentUser({
                userId: currentUserId,
                endpoint: currentEndpoint,
                params: {
                    [fieldName]: nextValue
                }
            });
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }

            useRuntimeStore.getState().setAuthBootstrap({
                currentUserSnapshot: nextUser,
                currentUserDisplayName:
                    nextUser.displayName ||
                    nextUser.username ||
                    nextUser.id ||
                    currentUserId
            });
            toast.success(
                fieldName === 'userIcon'
                    ? t('message.gallery.profile_icon_changed')
                    : t('message.gallery.profile_pic_changed')
            );
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : appI18n.t('view.tools.generated_toast.failed_to_update_profile_media')
                );
            }
        } finally {
            setMutatingKey((current) =>
                current === `${fieldName}:${normalizedFileId || 'clear'}`
                    ? ''
                    : current
            );
        }
    }

    async function consumeInventoryBundle(inventoryId) {
        const normalizedInventoryId =
            typeof inventoryId === 'string'
                ? inventoryId.trim()
                : String(inventoryId ?? '').trim();
        if (!normalizedInventoryId) {
            return;
        }

        const authTarget = getAuthTarget();
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }
        setMutatingKey(`inventory:${normalizedInventoryId}`);
        try {
            await mediaRepository.consumeInventoryBundle(
                normalizedInventoryId,
                { endpoint: currentEndpoint }
            );
            if (isRuntimeAuthTarget(authTarget)) {
                setAssets((current) => ({
                    ...current,
                    inventory: current.inventory.filter(
                        (item) => item.id !== normalizedInventoryId
                    )
                }));
                await refreshInventory();
                toast.success(t('view.tools.generated.inventory_bundle_consumed'));
            }
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : appI18n.t('view.tools.generated_toast.failed_to_consume_inventory_bundle')
                );
            }
        } finally {
            setMutatingKey((current) =>
                current === `inventory:${normalizedInventoryId}` ? '' : current
            );
        }
    }

    async function redeemReward() {
        const authTarget = getAuthTarget();
        const result = await prompt({
            title: t('prompt.redeem.header'),
            description: t('prompt.redeem.description'),
            confirmText: t('prompt.redeem.redeem'),
            cancelText: t('prompt.redeem.cancel')
        });
        if (!result.ok || !String(result.value || '').trim()) {
            return;
        }
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }

        setMutatingKey('inventory:redeem');
        try {
            await mediaRepository.redeemReward(result.value, {
                endpoint: currentEndpoint
            });
            if (isRuntimeAuthTarget(authTarget)) {
                toast.success(t('prompt.redeem.success'));
                await refreshInventory();
            }
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : appI18n.t('view.tools.generated_toast.failed_to_redeem_reward')
                );
            }
        } finally {
            setMutatingKey((current) =>
                current === 'inventory:redeem' ? '' : current
            );
        }
    }

    return (
        <div className="gallery-page x-container flex min-h-0 flex-1 flex-col p-6">
            <GalleryHeader
                t={t}
                uploadInputRef={uploadInputRef}
                uploadingTab={uploadingTab}
                onUploadChange={(event) => void uploadSelectedFile(event)}
                onBack={() => navigate('/tools')}
                onRefreshAll={() => void refreshAll()}
            />

            <GalleryTabs
                t={t}
                activeTab={activeTab}
                onActiveTabChange={setActiveTab}
                tabCounts={tabCounts}
                fileTab={{
                    assets,
                    loadingByTab,
                    uploadingTab,
                    mutatingKey,
                    isVrcPlusSupporter,
                    currentUserId,
                    profilePicOverride,
                    userIcon,
                    emojiAnimType,
                    emojiAnimationStyle,
                    emojiAnimFps,
                    emojiAnimFrameCount,
                    emojiAnimLoopPingPong,
                    onRefresh: (tab) => void refreshTab(tab),
                    onBeginUpload: beginUpload,
                    onClearProfileField: (fieldName, fileId) =>
                        void setProfileField(fieldName, fileId),
                    onEmojiAnimTypeChange: setEmojiAnimType,
                    onEmojiAnimationStyleChange: setEmojiAnimationStyle,
                    onEmojiAnimFpsChange: setEmojiAnimFps,
                    onEmojiAnimFrameCountChange: setEmojiAnimFrameCount,
                    onEmojiAnimLoopPingPongChange: setEmojiAnimLoopPingPong,
                    onCreateAnimatedEmoji: () =>
                        void openExternalLink('https://vrcemoji.com'),
                    onPreview: setPreview,
                    onSetProfileField: (fieldName, fileId) =>
                        void setProfileField(fieldName, fileId),
                    onDeleteFile: (tab, fileId) =>
                        void deleteFileAsset(tab, fileId)
                }}
                printsTab={{
                    prints: assets.prints,
                    loading: loadingByTab.prints,
                    uploadingTab,
                    mutatingKey,
                    isVrcPlusSupporter,
                    printUploadNote,
                    printCropBorder,
                    onRefresh: (tab) => void refreshTab(tab),
                    onBeginUpload: beginUpload,
                    onPrintUploadNoteChange: setPrintUploadNote,
                    onPrintCropBorderChange: setPrintCropBorder,
                    onPreview: setPreview,
                    onDeletePrint: (printId) => void deletePrint(printId)
                }}
                inventoryTab={{
                    items: assets.inventory,
                    loading: loadingByTab.inventory,
                    mutatingKey,
                    onRefresh: (tab) => void refreshTab(tab),
                    onRedeem: () => void redeemReward(),
                    onPreview: setPreview,
                    onConsumeBundle: (inventoryId) =>
                        void consumeInventoryBundle(inventoryId)
                }}
            />

            <ImageCropDialog
                open={Boolean(cropRequest)}
                file={cropRequest?.file || null}
                aspectRatio={cropRequest?.aspectRatio || 1}
                title={t('dialog.change_content_image.upload')}
                onOpenChange={(open) => {
                    if (!open) {
                        setCropRequest(null);
                        uploadAuthTargetRef.current = null;
                    }
                }}
                onConfirm={(blob) => confirmCroppedUpload(blob)}
            />

            <GalleryPreviewDialog
                t={t}
                preview={preview}
                onClose={() => setPreview(null)}
            />
        </div>
    );
}
