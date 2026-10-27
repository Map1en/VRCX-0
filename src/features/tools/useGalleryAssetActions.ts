import {
    canUploadGalleryTarget,
    type GalleryAssets,
    type GalleryAssetTab,
    type GalleryUploadTarget
} from './galleryConstants';
import type {
    GalleryAssetActionDeps,
    GalleryAuthTarget,
    GalleryUploadOptions
} from './galleryTypes';
import { buildPrintUploadParams } from './galleryUploadParams';
import {
    buildEmojiUploadParams,
    type EmojiUploadSettings
} from './inventoryHelpers';

export function createGalleryAssetActions({
    FILE_TABS,
    UPLOAD_ASPECT_RATIOS,
    activeTab,
    confirm,
    cropRequest,
    currentEndpoint,
    currentUserId,
    emojiAnimFps,
    emojiAnimFrameCount,
    emojiAnimLoopPingPong,
    emojiAnimType,
    emojiAnimationStyle,
    getLocalTimestampString,
    isRuntimeAuthTarget,
    isVrcPlusSupporter,
    mediaRepository,
    parseEmojiUploadSettings,
    readFileAsBase64,
    setAssets,
    setCropRequest,
    setEmojiAnimFps,
    setEmojiAnimFrameCount,
    setEmojiAnimLoopPingPong,
    setEmojiAnimType,
    setEmojiAnimationStyle,
    setLoadingByTab,
    setMutatingKey,
    setUploadingTab,
    t,
    toast,
    withUploadTimeout
}: GalleryAssetActionDeps) {
    function getAuthTarget() {
        return {
            userId: currentUserId || '',
            endpoint: currentEndpoint || ''
        };
    }
    function setTabLoading(tab: GalleryAssetTab, value: boolean) {
        setLoadingByTab((current) => ({
            ...current,
            [tab]: value
        }));
    }
    function updateAssets<TTab extends GalleryAssetTab>(
        tab: TTab,
        rows: GalleryAssets[TTab]
    ) {
        setAssets((current) => ({ ...current, [tab]: rows }));
    }
    async function refreshFileTab(tab: keyof typeof FILE_TABS) {
        const definition = FILE_TABS[tab];
        if (!definition) {
            return;
        }
        const authTarget = getAuthTarget();
        setTabLoading(tab, true);
        try {
            const { json } = await mediaRepository.getFileList({
                n: 100,
                tag: definition.tag
            });
            if (isRuntimeAuthTarget(authTarget)) {
                updateAssets(
                    tab,
                    Array.isArray(json) ? [...json].reverse() : []
                );
            }
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('view.tools.toast.failed_to_load_value', {
                                  value: tab
                              })
                });
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
            const { json } = await mediaRepository.getPrints({
                userId: currentUserId || '',
                n: 100
            });
            const rows = Array.isArray(json) ? [...json] : [];
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
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('view.tools.toast.failed_to_load_prints')
                });
            }
        } finally {
            if (isRuntimeAuthTarget(authTarget)) {
                setTabLoading('prints', false);
            }
        }
    }
    async function refreshInventory() {
        const authTarget = getAuthTarget();
        setTabLoading('inventory', true);
        try {
            const { items, truncated } =
                await mediaRepository.collectInventoryItems();
            if (truncated) {
                console.warn('Inventory listing truncated at the page limit.');
            }
            if (isRuntimeAuthTarget(authTarget)) {
                updateAssets('inventory', items);
            }
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('view.tools.toast.failed_to_load_inventory')
                });
            }
        } finally {
            if (isRuntimeAuthTarget(authTarget)) {
                setTabLoading('inventory', false);
            }
        }
    }
    async function refreshTab(tab: GalleryAssetTab = activeTab) {
        if (tab === 'gallery' || tab === 'icons') {
            await refreshFileTab(tab);
        } else if (tab === 'prints') {
            await refreshPrints();
        } else if (tab === 'inventory') {
            await refreshInventory();
        }
    }
    async function refreshAll() {
        await Promise.allSettled([
            ...Object.keys(FILE_TABS).map((tab) =>
                refreshFileTab(tab === 'icons' ? 'icons' : 'gallery')
            ),
            refreshPrints()
        ]);
    }
    function uploadAsset(
        tab: GalleryUploadTarget,
        base64Body: string,
        settings: EmojiUploadSettings,
        uploadOptions: GalleryUploadOptions = {}
    ) {
        if (tab === 'emojis') {
            return mediaRepository.uploadAssetImage(base64Body, {
                assetKind: tab,
                params: buildEmojiUploadParams(settings)
            });
        }
        if (tab === 'prints') {
            return mediaRepository.uploadAssetImage(base64Body, {
                assetKind: tab,
                cropWhiteBorder: uploadOptions.cropWhiteBorder ?? true,
                params: buildPrintUploadParams({
                    note: uploadOptions.note,
                    timestamp: getLocalTimestampString()
                })
            });
        }
        if (tab === 'gallery' || tab === 'icons' || tab === 'stickers') {
            return mediaRepository.uploadAssetImage(base64Body, {
                assetKind: tab
            });
        }
        throw new Error(`Unsupported upload target: ${tab}`);
    }
    function openCropRequest(
        file: File,
        tab: GalleryUploadTarget,
        authTarget: GalleryAuthTarget
    ) {
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
    async function confirmCroppedUpload(
        blob: Blob,
        uploadOptions: GalleryUploadOptions = {}
    ) {
        const request = cropRequest;
        if (!request || !blob || !isRuntimeAuthTarget(request.authTarget)) {
            return;
        }
        const { tab, settings, authTarget } = request;
        if (!canUploadGalleryTarget(tab, isVrcPlusSupporter)) {
            toast.add({ type: 'error', title: t('message.vrcplus.required') });
            return;
        }
        setUploadingTab(tab);
        try {
            const base64Body = await readFileAsBase64(blob);
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            const args = await withUploadTimeout(
                uploadAsset(tab, base64Body, settings, uploadOptions)
            );
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            if (
                args?.json &&
                typeof args.json.id === 'string' &&
                (tab === 'gallery' || tab === 'icons' || tab === 'prints')
            ) {
                const uploaded = { ...args.json, id: args.json.id };
                if (tab === 'prints') {
                    setAssets((current) => ({
                        ...current,
                        prints: [
                            uploaded,
                            ...current.prints.filter(
                                (item) => item.id !== uploaded.id
                            )
                        ]
                    }));
                } else {
                    setAssets((current) => ({
                        ...current,
                        [tab]: [
                            uploaded,
                            ...current[tab].filter(
                                (item) => item.id !== uploaded.id
                            )
                        ]
                    }));
                }
            } else {
                if (tab === 'gallery' || tab === 'icons' || tab === 'prints') {
                    await refreshTab(tab);
                }
            }
            toast.add({ type: 'success', title: t('message.upload.success') });
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('message.upload.error')
                });
            }
        } finally {
            setUploadingTab('');
            setCropRequest(null);
        }
    }
    async function deleteFileAsset(
        tab: keyof typeof FILE_TABS,
        fileId: string
    ) {
        const normalizedFileId = fileId.trim();
        if (!normalizedFileId) {
            return;
        }
        const authTarget = getAuthTarget();
        const result = await confirm({
            title: t('view.tools.modal.delete_value_item', {
                value: tab
            }),
            description: normalizedFileId,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
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
            await mediaRepository.deleteFile(normalizedFileId);
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            setAssets((current) => ({
                ...current,
                [tab]: (current[tab] || []).filter(
                    (file) => file.id !== normalizedFileId
                )
            }));
            toast.add({
                type: 'success',
                title: t('view.tools.success.media_item_deleted')
            });
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('view.tools.toast.failed_to_delete_media_item')
                });
            }
        } finally {
            setMutatingKey((current) =>
                current === `${tab}:${normalizedFileId}` ? '' : current
            );
        }
    }
    return {
        getAuthTarget,
        refreshInventory,
        refreshTab,
        refreshAll,
        openCropRequest,
        confirmCroppedUpload,
        deleteFileAsset
    };
}
