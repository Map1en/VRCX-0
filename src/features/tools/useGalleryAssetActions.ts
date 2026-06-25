import {
    buildPrintUploadParams,
    resolvePrintCropWhiteBorder
} from './galleryUploadParams';

export function useGalleryAssetActions({
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
    uploadAuthTargetRef,
    uploadInputRef,
    uploadTargetRef,
    validateImageFile,
    withUploadTimeout
}: any) {
    function getAuthTarget() {
        return {
            userId: currentUserId || '',
            endpoint: currentEndpoint || ''
        };
    }
    function setTabLoading(tab: any, value: any) {
        setLoadingByTab((current: any) => ({
            ...current,
            [tab]: Boolean(value)
        }));
    }
    function updateAssets(tab: any, rows: any) {
        setAssets((current: any) => ({
            ...current,
            [tab]: Array.isArray(rows) ? rows : []
        }));
    }
    async function refreshFileTab(tab: any) {
        const definition = FILE_TABS[tab];
        const authTarget = getAuthTarget();
        setTabLoading(tab, true);
        try {
            const { json } = await mediaRepository.getFileList(
                {
                    n: 100,
                    tag: definition.tag
                },
                {
                    endpoint: currentEndpoint
                }
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
                        : t('view.tools.toast.failed_to_load_value', {
                              value: tab
                          })
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
                {
                    userId: currentUserId,
                    n: 100
                },
                {
                    endpoint: currentEndpoint
                }
            );
            const rows = Array.isArray(json) ? [...json] : [];
            rows.sort(
                (left: any, right: any) =>
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
                        : t('view.tools.toast.failed_to_load_prints')
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
                    {
                        n: 100,
                        offset: pageIndex * 100,
                        order: 'newest'
                    },
                    {
                        endpoint: currentEndpoint
                    }
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
                        : t('view.tools.toast.failed_to_load_inventory')
                );
            }
        } finally {
            if (isRuntimeAuthTarget(authTarget)) {
                setTabLoading('inventory', false);
            }
        }
    }
    async function refreshTab(tab: any = activeTab) {
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
            ...Object.keys(FILE_TABS).map((tab: any) => refreshFileTab(tab)),
            refreshPrints()
        ]);
    }
    function beginUpload(tab: any) {
        if (!isVrcPlusSupporter) {
            toast.error(t('message.vrcplus.required'));
            return;
        }
        uploadTargetRef.current = tab;
        uploadAuthTargetRef.current = getAuthTarget();
        uploadInputRef.current?.click();
    }
    function getEmojiUploadParams(settings: any) {
        const params: any = {
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
    function uploadAsset(
        tab: any,
        base64Body: any,
        settings: any,
        uploadOptions: any = {}
    ) {
        const endpoint = currentEndpoint;
        if (tab === 'emojis') {
            return mediaRepository.uploadAssetImage(base64Body, {
                endpoint,
                assetKind: tab,
                params: getEmojiUploadParams(settings)
            });
        }
        if (tab === 'prints') {
            return mediaRepository.uploadAssetImage(base64Body, {
                endpoint,
                assetKind: tab,
                cropWhiteBorder: resolvePrintCropWhiteBorder(
                    uploadOptions.cropWhiteBorder
                ),
                params: buildPrintUploadParams({
                    note: uploadOptions.note,
                    timestamp: getLocalTimestampString()
                })
            });
        }
        if (tab === 'gallery' || tab === 'icons' || tab === 'stickers') {
            return mediaRepository.uploadAssetImage(base64Body, {
                endpoint,
                assetKind: tab
            });
        }
        throw new Error(`Unsupported upload target: ${tab}`);
    }
    async function uploadSelectedFile(event: any) {
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
    async function confirmCroppedUpload(blob: any, uploadOptions: any = {}) {
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
                uploadAsset(tab, base64Body, settings, uploadOptions)
            );
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            if (args?.json) {
                setAssets((current: any) => ({
                    ...current,
                    [tab]: [
                        args.json,
                        ...(current[tab] || []).filter(
                            (item: any) => item.id !== args.json.id
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
    async function deleteFileAsset(tab: any, fileId: any) {
        const normalizedFileId =
            typeof fileId === 'string'
                ? fileId.trim()
                : String(fileId ?? '').trim();
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
            await mediaRepository.deleteFile(normalizedFileId, {
                endpoint: currentEndpoint
            });
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            setAssets((current: any) => ({
                ...current,
                [tab]: (current[tab] || []).filter(
                    (file: any) => file.id !== normalizedFileId
                )
            }));
            toast.success(t('view.tools.success.media_item_deleted'));
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.tools.toast.failed_to_delete_media_item')
                );
            }
        } finally {
            setMutatingKey((current: any) =>
                current === `${tab}:${normalizedFileId}` ? '' : current
            );
        }
    }
    return {
        getAuthTarget,
        refreshInventory,
        refreshTab,
        refreshAll,
        beginUpload,
        uploadSelectedFile,
        confirmCroppedUpload,
        deleteFileAsset
    };
}
