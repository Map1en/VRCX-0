import type { ChangeEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import mediaRepository from '@/repositories/mediaRepository';
import {
    IMAGE_UPLOAD_ACCEPT,
    readFileAsBase64,
    withUploadTimeout
} from '@/shared/utils/imageUpload';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    CATEGORY_DEFINITIONS,
    getInventoryGridDensityConfig,
    parseEmojiUploadSettings,
    readGridDensityPreference,
    sanitizeInventoryGridDensity,
    scopeKey,
    validateImageFile,
    writeGridDensityPreference
} from './inventoryHelpers';

export { IMAGE_UPLOAD_ACCEPT };

type InventoryAuthTarget = {
    endpoint: string;
    userId: string;
};

type InventoryRow = Record<string, unknown> & {
    id?: unknown;
};

type InventoryUploadSettings = {
    animationStyle: string;
    fps: number;
    frames: number;
    isAnimated: boolean;
    loopPingPong: boolean;
};

type InventoryCropRequest = {
    aspectRatio: number;
    authTarget: InventoryAuthTarget;
    file: File;
    settings: InventoryUploadSettings;
    target: string | null;
};

export function useInventoryPageState() {
    const { t } = useTranslation();
    const uploadInputRef = useRef<HTMLInputElement | null>(null);
    const uploadTargetRef = useRef<string | null>(null);
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );
    const confirm = useModalStore((state: any) => state.confirm);
    const prompt = useModalStore((state: any) => state.prompt);
    const openImagePreview = useModalStore(
        (state: any) => state.openImagePreview
    );
    const [activeCategory, setActiveCategory] = useState('emojis');
    const [activeSubTabs, setActiveSubTabs] = useState<Record<string, string>>({
        emojis: 'custom',
        stickers: 'custom',
        items: 'all',
        cosmetics: 'drones'
    });
    const [rowsByScope, setRowsByScope] = useState<
        Record<string, InventoryRow[]>
    >({});
    const [loadingByScope, setLoadingByScope] = useState<
        Record<string, boolean>
    >({});
    const [mutatingKey, setMutatingKey] = useState('');
    const [uploadingTarget, setUploadingTarget] = useState('');
    const [cropRequest, setCropRequest] = useState<InventoryCropRequest | null>(
        null
    );
    const [emojiAnimFps, setEmojiAnimFps] = useState(15);
    const [emojiAnimFrameCount, setEmojiAnimFrameCount] = useState(4);
    const [emojiAnimType, setEmojiAnimType] = useState(false);
    const [emojiAnimationStyle, setEmojiAnimationStyle] = useState('Stop');
    const [emojiAnimLoopPingPong, setEmojiAnimLoopPingPong] = useState(false);
    const [gridDensity, setGridDensity] = useState(readGridDensityPreference);
    const gridDensityConfig = useMemo(
        () => getInventoryGridDensityConfig(gridDensity),
        [gridDensity]
    );
    const isVrcPlusSupporter = Boolean(
        currentUserSnapshot?.$isVRCPlus ||
        currentUserSnapshot?.tags?.includes?.('system_supporter') ||
        globalThis.$debug?.debugVrcPlus
    );

    const activeSubTab = activeSubTabs[activeCategory];
    const activeScopeKey = scopeKey(activeCategory, activeSubTab);

    function getAuthTarget() {
        return {
            userId: currentUserId || '',
            endpoint: currentEndpoint || ''
        };
    }

    function isCurrentAuthTarget(authTarget: InventoryAuthTarget) {
        const currentAuth = getAuthTarget();
        return (
            currentAuth.userId === authTarget.userId &&
            currentAuth.endpoint === authTarget.endpoint
        );
    }

    function changeGridDensity(nextValue: any) {
        const nextDensity = sanitizeInventoryGridDensity(nextValue);
        setGridDensity(nextDensity);
        writeGridDensityPreference(nextDensity);
    }

    function setScopeLoading(key: string, value: unknown) {
        setLoadingByScope((current) => ({
            ...current,
            [key]: Boolean(value)
        }));
    }

    function setScopeRows(key: string, rows: unknown) {
        setRowsByScope((current) => ({
            ...current,
            [key]: Array.isArray(rows) ? rows : []
        }));
    }

    async function loadFileRows(definition: any, authTarget: any) {
        const nextRows: InventoryRow[] = [];
        for (const tag of definition.fileTags || []) {
            const { json } = await mediaRepository.getFileList(
                {
                    n: 100,
                    tag
                },
                {
                    endpoint: currentEndpoint
                }
            );
            if (Array.isArray(json)) {
                nextRows.push(...json);
            }
        }
        const seen = new Set();
        return nextRows
            .filter((row) => {
                if (!row?.id || seen.has(row.id)) {
                    return false;
                }
                seen.add(row.id);
                return true;
            })
            .reverse()
            .filter(() => isCurrentAuthTarget(authTarget));
    }

    async function loadInventoryRows(definition: any) {
        if (definition.source === 'empty') {
            return [];
        }
        const nextRows: InventoryRow[] = [];
        for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
            const { json } = await mediaRepository.getInventoryItems(
                {
                    n: 100,
                    offset: pageIndex * 100,
                    order: 'newest',
                    ...(definition.params || {})
                },
                {
                    endpoint: currentEndpoint
                }
            );
            const pageRows = Array.isArray(json?.data) ? json.data : [];
            nextRows.push(...pageRows);
            if (!pageRows.length) {
                break;
            }
        }
        return nextRows;
    }

    async function refreshScope(
        category: any = activeCategory,
        tab: any = activeSubTab
    ) {
        const definition = CATEGORY_DEFINITIONS[category].tabs.find(
            (entry: any) => entry.key === tab
        );
        if (!definition) {
            return;
        }
        const key = scopeKey(category, tab);
        const authTarget = getAuthTarget();
        setScopeLoading(key, true);
        try {
            const rows =
                definition.source === 'file'
                    ? await loadFileRows(definition, authTarget)
                    : await loadInventoryRows(definition);
            if (isCurrentAuthTarget(authTarget)) {
                setScopeRows(key, rows);
            }
        } catch (error) {
            if (isCurrentAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('dialog.inventory.failed_to_load')
                );
            }
        } finally {
            if (isCurrentAuthTarget(authTarget)) {
                setScopeLoading(key, false);
            }
        }
    }

    useEffect(() => {
        if (!currentUserId) {
            setRowsByScope({});
            setLoadingByScope({});
            return;
        }
        refreshScope(activeCategory, activeSubTab);
    }, [currentEndpoint, currentUserId, activeCategory, activeSubTab]);

    function beginUpload(target: any) {
        if (!isVrcPlusSupporter) {
            toast.error(t('message.vrcplus.required'));
            return;
        }
        uploadTargetRef.current = target;
        uploadInputRef.current?.click();
    }

    function getEmojiUploadParams(settings: InventoryUploadSettings) {
        const params: Record<string, string | number> = {
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
        target: unknown,
        base64Body: string,
        settings: InventoryUploadSettings
    ) {
        if (target === 'emojis') {
            return mediaRepository.uploadEmoji(
                base64Body,
                getEmojiUploadParams(settings),
                {
                    endpoint: currentEndpoint
                }
            );
        }
        if (target === 'stickers') {
            return mediaRepository.uploadSticker(base64Body, {
                endpoint: currentEndpoint
            });
        }
        throw new Error(`Unsupported inventory upload target: ${target}`);
    }

    async function uploadSelectedFile(event: ChangeEvent<HTMLInputElement>) {
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
        const target = uploadTargetRef.current;
        const authTarget = getAuthTarget();
        const settings =
            target === 'emojis'
                ? parseEmojiUploadSettings(file.name, {
                      isAnimated: emojiAnimType,
                      animationStyle: emojiAnimationStyle,
                      fps: emojiAnimFps,
                      frames: emojiAnimFrameCount,
                      loopPingPong: emojiAnimLoopPingPong
                  })
                : {
                      isAnimated: false,
                      animationStyle: emojiAnimationStyle,
                      fps: emojiAnimFps,
                      frames: emojiAnimFrameCount,
                      loopPingPong: emojiAnimLoopPingPong
                  };
        if (target === 'emojis') {
            setEmojiAnimType(settings.isAnimated);
            setEmojiAnimationStyle(settings.animationStyle);
            setEmojiAnimFps(settings.fps);
            setEmojiAnimFrameCount(settings.frames);
            setEmojiAnimLoopPingPong(settings.loopPingPong);
        }
        setCropRequest({
            target,
            file,
            settings,
            authTarget,
            aspectRatio: 1
        });
    }

    async function confirmCroppedUpload(blob: Blob) {
        const request = cropRequest;
        if (!request || !blob || !isCurrentAuthTarget(request.authTarget)) {
            return;
        }
        const { target, settings, authTarget } = request;
        setUploadingTarget(target ?? '');
        try {
            const base64Body = await readFileAsBase64(blob);
            if (!isCurrentAuthTarget(authTarget)) {
                return;
            }
            const args = await withUploadTimeout(
                uploadAsset(target, base64Body, settings)
            );
            if (!isCurrentAuthTarget(authTarget)) {
                return;
            }
            const key = scopeKey(target, 'custom');
            if (args?.json) {
                setRowsByScope((current: any) => ({
                    ...current,
                    [key]: [
                        args.json,
                        ...(current[key] || []).filter(
                            (item: any) => item.id !== args.json.id
                        )
                    ]
                }));
            } else {
                await refreshScope(target, 'custom');
            }
            toast.success(t('message.upload.success'));
        } catch (error) {
            if (isCurrentAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('message.upload.error')
                );
            }
        } finally {
            setUploadingTarget('');
            uploadTargetRef.current = null;
            setCropRequest(null);
        }
    }

    async function deleteFileAsset(fileId: any) {
        const normalizedFileId =
            typeof fileId === 'string'
                ? fileId.trim()
                : String(fileId ?? '').trim();
        if (!normalizedFileId) {
            return;
        }
        const result = await confirm({
            title: t('view.tools.modal.delete_value_item', {
                value: activeCategory
            }),
            description: normalizedFileId,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        const authTarget = getAuthTarget();
        setMutatingKey(`file:${normalizedFileId}`);
        try {
            await mediaRepository.deleteFile(normalizedFileId, {
                endpoint: currentEndpoint
            });
            if (isCurrentAuthTarget(authTarget)) {
                setRowsByScope((current: any) => ({
                    ...current,
                    [activeScopeKey]: (current[activeScopeKey] || []).filter(
                        (file: any) => file.id !== normalizedFileId
                    )
                }));
                toast.success(t('view.tools.success.media_item_deleted'));
            }
        } catch (error) {
            if (isCurrentAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.tools.toast.failed_to_delete_media_item')
                );
            }
        } finally {
            setMutatingKey((current: any) =>
                current === `file:${normalizedFileId}` ? '' : current
            );
        }
    }

    async function archiveInventoryItem(inventoryId: any, archived: any) {
        const normalizedInventoryId =
            typeof inventoryId === 'string'
                ? inventoryId.trim()
                : String(inventoryId ?? '').trim();
        if (!normalizedInventoryId) {
            return;
        }
        const authTarget = getAuthTarget();
        setMutatingKey(`inventory:${normalizedInventoryId}`);
        try {
            await mediaRepository.updateInventoryItem(
                normalizedInventoryId,
                { isArchived: Boolean(archived) },
                {
                    endpoint: currentEndpoint
                }
            );
            if (isCurrentAuthTarget(authTarget)) {
                toast.success(
                    archived
                        ? t('dialog.inventory.archived_success')
                        : t('dialog.inventory.unarchived_success')
                );
                await refreshScope(activeCategory, activeSubTab);
            }
        } catch (error) {
            if (isCurrentAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('dialog.inventory.failed_to_archive')
                );
            }
        } finally {
            setMutatingKey((current: any) =>
                current === `inventory:${normalizedInventoryId}` ? '' : current
            );
        }
    }

    async function consumeInventoryBundle(inventoryId: any) {
        const normalizedInventoryId =
            typeof inventoryId === 'string'
                ? inventoryId.trim()
                : String(inventoryId ?? '').trim();
        if (!normalizedInventoryId) {
            return;
        }
        const authTarget = getAuthTarget();
        setMutatingKey(`inventory:${normalizedInventoryId}`);
        try {
            await mediaRepository.consumeInventoryBundle(
                normalizedInventoryId,
                {
                    endpoint: currentEndpoint
                }
            );
            if (isCurrentAuthTarget(authTarget)) {
                toast.success(t('view.tools.label.inventory_bundle_consumed'));
                await refreshScope(activeCategory, activeSubTab);
            }
        } catch (error) {
            if (isCurrentAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.tools.toast.failed_to_consume_inventory_bundle'
                          )
                );
            }
        } finally {
            setMutatingKey((current: any) =>
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
        if (!isCurrentAuthTarget(authTarget)) {
            return;
        }
        setMutatingKey('inventory:redeem');
        try {
            await mediaRepository.redeemReward(result.value, {
                endpoint: currentEndpoint
            });
            if (isCurrentAuthTarget(authTarget)) {
                toast.success(t('prompt.redeem.success'));
                await refreshScope(activeCategory, activeSubTab);
            }
        } catch (error) {
            if (isCurrentAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.tools.toast.failed_to_redeem_reward')
                );
            }
        } finally {
            setMutatingKey((current: any) =>
                current === 'inventory:redeem' ? '' : current
            );
        }
    }

    function closeCropRequest() {
        uploadTargetRef.current = null;
        setCropRequest(null);
    }

    return {
        activeCategory,
        activeSubTab,
        activeSubTabs,
        archiveInventoryItem,
        beginUpload,
        changeGridDensity,
        closeCropRequest,
        confirmCroppedUpload,
        consumeInventoryBundle,
        cropRequest,
        deleteFileAsset,
        emojiAnimFps,
        emojiAnimFrameCount,
        emojiAnimLoopPingPong,
        emojiAnimType,
        emojiAnimationStyle,
        gridDensity,
        gridDensityConfig,
        isVrcPlusSupporter,
        mutatingKey,
        openImagePreview,
        redeemReward,
        refreshScope,
        rowsByScope,
        loadingByScope,
        setActiveCategory,
        setActiveSubTabs,
        setEmojiAnimFps,
        setEmojiAnimFrameCount,
        setEmojiAnimLoopPingPong,
        setEmojiAnimType,
        setEmojiAnimationStyle,
        uploadInputRef,
        uploadingTarget,
        uploadSelectedFile
    };
}
