import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFileDropTarget } from '@/components/file-drop/useFileDropTarget';
import { useImagePasteShortcut } from '@/components/keyboard/useImagePasteShortcut';
import { resolveProfileDecorationMutation } from '@/domain/entities/inventory';
import vrchatMediaRepository, {
    type InventoryItemRecord,
    type MediaFileRecord
} from '@/repositories/vrchatMediaRepository';
import { refreshCurrentUser } from '@/services/backgroundMaintenanceSessionService';
import { refreshInventoryBundles } from '@/services/inventoryBundleService';
import { toast } from '@/services/toastService';
import { VRCHAT_API_DEFAULT_PAGE_SIZE } from '@/shared/constants/pagination';
import {
    readFileAsBase64,
    withUploadTimeout
} from '@/shared/utils/imageUpload';
import { useInventoryBundleStore } from '@/state/inventoryBundleStore';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import type { GalleryGridDensity } from './galleryDensity';
import {
    buildEmojiUploadParams,
    CATEGORY_DEFINITIONS,
    INITIAL_INVENTORY_SUB_TABS,
    getInventoryGridDensityConfig,
    parseEmojiUploadSettings,
    readClipboardUploadImage,
    readDroppedUploadImage,
    readGridDensityPreference,
    scopeKey,
    validateImageFile,
    writeGridDensityPreference,
    type InventoryCategory,
    type InventoryTabDefinition,
    type InventoryUploadTarget,
    type EmojiUploadSettings
} from './inventoryHelpers';

type InventoryAuthTarget = {
    endpoint: string;
    userId: string;
    websocket: string;
};

export type InventoryRow = MediaFileRecord & Partial<InventoryItemRecord>;

const EMPTY_ROWS_BY_SCOPE: Record<string, InventoryRow[]> = Object.freeze({});
const EMPTY_LOADING_BY_SCOPE: Record<string, boolean> = Object.freeze({});

type InventoryUploadSettings = EmojiUploadSettings;

type InventoryCropRequest = {
    aspectRatio: number;
    authTarget: InventoryAuthTarget;
    file: File;
    settings: InventoryUploadSettings;
    target: InventoryUploadTarget;
};

function inventoryAuthTargetKey(authTarget: InventoryAuthTarget) {
    return [authTarget.endpoint, authTarget.userId, authTarget.websocket].join(
        '\u0000'
    );
}

function getInventoryAuthTarget(): InventoryAuthTarget {
    const auth = useRuntimeStore.getState().auth;
    return {
        userId: auth.currentUserId || '',
        endpoint: auth.currentUserEndpoint || '',
        websocket: auth.currentUserWebsocket || ''
    };
}

function isCurrentInventoryAuthTarget(authTarget: InventoryAuthTarget) {
    const currentAuth = getInventoryAuthTarget();
    return (
        currentAuth.userId === authTarget.userId &&
        currentAuth.endpoint === authTarget.endpoint &&
        currentAuth.websocket === authTarget.websocket
    );
}

async function loadInventoryFileRows(
    definition: InventoryTabDefinition,
    authTarget: InventoryAuthTarget
) {
    const nextRows: InventoryRow[] = [];
    for (const tag of definition.fileTags || []) {
        const { json } = await vrchatMediaRepository.getFileList({
            n: VRCHAT_API_DEFAULT_PAGE_SIZE,
            tag
        });
        if (Array.isArray(json)) {
            nextRows.push(...json);
        }
    }
    const seen = new Set<string>();
    return nextRows
        .filter((row) => {
            if (!row?.id || seen.has(row.id)) {
                return false;
            }
            seen.add(row.id);
            return true;
        })
        .reverse()
        .filter(() => isCurrentInventoryAuthTarget(authTarget));
}

async function loadInventoryRows(definition: InventoryTabDefinition) {
    if (definition.source === 'empty') {
        return [];
    }
    const { items, truncated } =
        await vrchatMediaRepository.collectInventoryItems({
            ...definition.params
        });
    if (truncated) {
        console.warn('Inventory listing truncated at the page limit.');
    }
    return items;
}

export function useInventoryPageState() {
    const { t } = useTranslation();
    const translateRef = useRef(t);
    useEffect(() => {
        translateRef.current = t;
    }, [t]);
    const uploadInputRef = useRef<HTMLInputElement | null>(null);
    const uploadTargetRef = useRef<InventoryUploadTarget | null>(null);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const bundleIds = useInventoryBundleStore((state) => state.bundleIds);
    useEffect(() => {
        if (bundleIds.length > 0) {
            useInventoryBundleStore.getState().markSeen();
        }
    }, [bundleIds]);
    const currentUserWebsocket = useRuntimeStore(
        (state) => state.auth.currentUserWebsocket
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const [activeCategory, setActiveCategory] =
        useState<InventoryCategory>('emojis');
    const [activeSubTabs, setActiveSubTabs] = useState<
        Record<InventoryCategory, string>
    >({ ...INITIAL_INVENTORY_SUB_TABS });
    const [rowsByScope, setRowsByScope] = useState<
        Record<string, InventoryRow[]>
    >({});
    const [loadingByScope, setLoadingByScope] = useState<
        Record<string, boolean>
    >({});
    const currentAuthTargetKey = inventoryAuthTargetKey({
        userId: currentUserId || '',
        endpoint: currentEndpoint || '',
        websocket: currentUserWebsocket || ''
    });
    const [scopeStateAuthTargetKey, setScopeStateAuthTargetKey] =
        useState(currentAuthTargetKey);
    const [mutatingKey, setMutatingKey] = useState('');
    const profileDecorationMutationPendingRef = useRef(false);
    const [
        profileDecorationMutationPending,
        setProfileDecorationMutationPending
    ] = useState(false);
    const [uploadingTarget, setUploadingTarget] = useState('');
    const clipboardPastingRef = useRef(false);
    const [clipboardPasting, setClipboardPasting] = useState(false);
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
    const activeUploadTarget =
        CATEGORY_DEFINITIONS[activeCategory].tabs.find(
            (entry) => entry.key === activeSubTab
        )?.uploadTarget ?? null;
    const dropOrPasteEnabled =
        Boolean(currentUserId) &&
        Boolean(activeUploadTarget) &&
        !cropRequest &&
        !uploadingTarget &&
        !clipboardPasting;
    const fileDropActive = useFileDropTarget({
        enabled: dropOrPasteEnabled,
        onDrop: async (paths) => {
            if (!activeUploadTarget) {
                return;
            }
            const file = await readDroppedUploadImage(paths, t);
            if (file) {
                requestUpload(file, activeUploadTarget);
            }
        }
    });

    const imagePasteRef = useImagePasteShortcut<HTMLDivElement>({
        enabled: dropOrPasteEnabled,
        onPaste: () => {
            if (activeUploadTarget) {
                return pasteClipboardUpload(activeUploadTarget);
            }
        }
    });

    function changeGridDensity(nextValue: GalleryGridDensity) {
        setGridDensity(nextValue);
        writeGridDensityPreference(nextValue);
    }

    const setScopeLoading = useCallback((key: string, value: boolean) => {
        setLoadingByScope((current) => ({
            ...current,
            [key]: value
        }));
    }, []);

    const setScopeRows = useCallback((key: string, rows: InventoryRow[]) => {
        setRowsByScope((current) => ({
            ...current,
            [key]: rows
        }));
    }, []);

    const refreshScope = useCallback(
        async (
            category: InventoryCategory = activeCategory,
            tab: string = activeSubTab
        ) => {
            const definition = CATEGORY_DEFINITIONS[category].tabs.find(
                (entry) => entry.key === tab
            );
            if (!definition) {
                return;
            }
            const key = scopeKey(category, tab);
            const authTarget = getInventoryAuthTarget();
            setScopeLoading(key, true);
            try {
                const rows =
                    definition.source === 'file'
                        ? await loadInventoryFileRows(definition, authTarget)
                        : await loadInventoryRows(definition);
                if (isCurrentInventoryAuthTarget(authTarget)) {
                    setScopeRows(key, rows);
                }
            } catch (error) {
                if (isCurrentInventoryAuthTarget(authTarget)) {
                    toast.add({
                        type: 'error',
                        title:
                            error instanceof Error
                                ? error.message
                                : translateRef.current(
                                      'dialog.inventory.failed_to_load'
                                  )
                    });
                }
            } finally {
                if (isCurrentInventoryAuthTarget(authTarget)) {
                    setScopeLoading(key, false);
                }
            }
        },
        [activeCategory, activeSubTab, setScopeLoading, setScopeRows]
    );

    useEffect(() => {
        setScopeStateAuthTargetKey(currentAuthTargetKey);
        setRowsByScope({});
        setLoadingByScope({});
        setMutatingKey('');
        profileDecorationMutationPendingRef.current = false;
        setProfileDecorationMutationPending(false);
    }, [currentAuthTargetKey]);

    useEffect(() => {
        if (currentUserId && currentAuthTargetKey) {
            refreshScope(activeCategory, activeSubTab);
        }
    }, [
        currentAuthTargetKey,
        currentUserId,
        activeCategory,
        activeSubTab,
        refreshScope
    ]);

    function beginUpload(target: InventoryUploadTarget) {
        if (!isVrcPlusSupporter) {
            toast.add({ type: 'error', title: t('message.vrcplus.required') });
            return;
        }
        uploadTargetRef.current = target;
        uploadInputRef.current?.click();
    }

    function uploadAsset(
        target: InventoryUploadTarget,
        base64Body: string,
        settings: InventoryUploadSettings
    ) {
        if (target === 'emojis') {
            return vrchatMediaRepository.uploadEmoji(
                base64Body,
                buildEmojiUploadParams(settings)
            );
        }
        if (target === 'stickers') {
            return vrchatMediaRepository.uploadSticker(base64Body);
        }
        throw new Error(`Unsupported inventory upload target: ${target}`);
    }

    function uploadSelectedFile(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        const target = uploadTargetRef.current;
        if (!file || !target) {
            return;
        }
        requestUpload(file, target);
    }

    async function pasteClipboardUpload(target: InventoryUploadTarget) {
        if (clipboardPastingRef.current) {
            return;
        }
        clipboardPastingRef.current = true;
        setClipboardPasting(true);
        const authTarget = getInventoryAuthTarget();
        try {
            const file = await readClipboardUploadImage(t);
            if (file && isCurrentInventoryAuthTarget(authTarget)) {
                requestUpload(file, target);
            }
        } finally {
            clipboardPastingRef.current = false;
            setClipboardPasting(false);
        }
    }

    function requestUpload(file: File, target: InventoryUploadTarget) {
        if (!isVrcPlusSupporter) {
            toast.add({ type: 'error', title: t('message.vrcplus.required') });
            return;
        }
        if (!validateImageFile(file, t)) {
            return;
        }
        const authTarget = getInventoryAuthTarget();
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
        if (
            !request ||
            !blob ||
            !isCurrentInventoryAuthTarget(request.authTarget)
        ) {
            return;
        }
        const { target, settings, authTarget } = request;
        setUploadingTarget(target ?? '');
        try {
            const base64Body = await readFileAsBase64(blob);
            if (!isCurrentInventoryAuthTarget(authTarget)) {
                return;
            }
            const args = await withUploadTimeout(
                uploadAsset(target, base64Body, settings)
            );
            if (!isCurrentInventoryAuthTarget(authTarget)) {
                return;
            }
            const key = scopeKey(target, 'custom');
            if (args?.json && typeof args.json.id === 'string') {
                const uploadedFile: MediaFileRecord = {
                    ...args.json,
                    id: args.json.id
                };
                setRowsByScope((current) => ({
                    ...current,
                    [key]: [
                        uploadedFile,
                        ...(current[key] || []).filter(
                            (item) => item.id !== uploadedFile.id
                        )
                    ]
                }));
            } else {
                await refreshScope(target, 'custom');
            }
            toast.add({ type: 'success', title: t('message.upload.success') });
        } catch (error) {
            if (isCurrentInventoryAuthTarget(authTarget)) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('message.upload.error')
                });
            }
        } finally {
            setUploadingTarget('');
            uploadTargetRef.current = null;
            setCropRequest(null);
        }
    }

    async function deleteFileAsset(fileId: string) {
        const normalizedFileId = fileId.trim();
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
        const authTarget = getInventoryAuthTarget();
        setMutatingKey(`file:${normalizedFileId}`);
        try {
            await vrchatMediaRepository.deleteFile(normalizedFileId);
            if (isCurrentInventoryAuthTarget(authTarget)) {
                setRowsByScope((current) => ({
                    ...current,
                    [activeScopeKey]: (current[activeScopeKey] || []).filter(
                        (file) => file.id !== normalizedFileId
                    )
                }));
                toast.add({
                    type: 'success',
                    title: t('view.tools.success.media_item_deleted')
                });
            }
        } catch (error) {
            if (isCurrentInventoryAuthTarget(authTarget)) {
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
                current === `file:${normalizedFileId}` ? '' : current
            );
        }
    }

    async function archiveInventoryItem(
        inventoryId: string,
        archived: boolean
    ) {
        const normalizedInventoryId = inventoryId.trim();
        if (!normalizedInventoryId) {
            return;
        }
        const authTarget = getInventoryAuthTarget();
        setMutatingKey(`inventory:${normalizedInventoryId}`);
        try {
            await vrchatMediaRepository.updateInventoryItem(
                normalizedInventoryId,
                {
                    isArchived: Boolean(archived)
                }
            );
            if (isCurrentInventoryAuthTarget(authTarget)) {
                toast.add({
                    type: 'success',
                    title: archived
                        ? t('dialog.inventory.archived_success')
                        : t('dialog.inventory.unarchived_success')
                });
                await refreshScope(activeCategory, activeSubTab);
            }
        } catch (error) {
            if (isCurrentInventoryAuthTarget(authTarget)) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('dialog.inventory.failed_to_archive')
                });
            }
        } finally {
            setMutatingKey((current) =>
                current === `inventory:${normalizedInventoryId}` ? '' : current
            );
        }
    }

    async function consumeInventoryBundle(inventoryId: string) {
        const normalizedInventoryId = inventoryId.trim();
        if (!normalizedInventoryId) {
            return;
        }
        const authTarget = getInventoryAuthTarget();
        setMutatingKey(`inventory:${normalizedInventoryId}`);
        try {
            await vrchatMediaRepository.consumeInventoryBundle(
                normalizedInventoryId
            );
            if (isCurrentInventoryAuthTarget(authTarget)) {
                toast.add({
                    type: 'success',
                    title: t('view.tools.label.inventory_bundle_consumed')
                });
                refreshInventoryBundles(currentUserId).catch(() => {});
                await refreshScope(activeCategory, activeSubTab);
            }
        } catch (error) {
            if (isCurrentInventoryAuthTarget(authTarget)) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t(
                                  'view.tools.toast.failed_to_consume_inventory_bundle'
                              )
                });
            }
        } finally {
            setMutatingKey((current) =>
                current === `inventory:${normalizedInventoryId}` ? '' : current
            );
        }
    }

    async function setProfileDecorationEquipped(item: InventoryItemRecord) {
        const authTarget = getInventoryAuthTarget();
        if (inventoryAuthTargetKey(authTarget) !== currentAuthTargetKey) {
            return;
        }
        const mutation = resolveProfileDecorationMutation(
            item,
            authTarget.userId
        );
        if (!mutation) {
            return;
        }
        if (profileDecorationMutationPendingRef.current) {
            return;
        }

        profileDecorationMutationPendingRef.current = true;
        setProfileDecorationMutationPending(true);
        const mutationKey = `inventory:${mutation.inventoryId}`;
        const isUnequip = mutation.action === 'unequip';
        setMutatingKey(mutationKey);
        try {
            try {
                if (isUnequip) {
                    await vrchatMediaRepository.unequipProfileDecoration({
                        expectedUserId: authTarget.userId,
                        equipSlot: mutation.equipSlot
                    });
                } else {
                    await vrchatMediaRepository.equipProfileDecoration({
                        expectedUserId: authTarget.userId,
                        inventoryId: mutation.inventoryId,
                        equipSlot: mutation.equipSlot
                    });
                }
            } catch (error) {
                if (isCurrentInventoryAuthTarget(authTarget)) {
                    toast.add({
                        type: 'error',
                        title:
                            error instanceof Error
                                ? error.message
                                : t(
                                      'dialog.inventory.failed_to_update_profile_decoration'
                                  )
                    });
                }
                return;
            }
            if (!isCurrentInventoryAuthTarget(authTarget)) {
                return;
            }

            toast.add({
                type: 'success',
                title: t(
                    isUnequip
                        ? 'dialog.inventory.unequipped_success'
                        : 'dialog.inventory.equipped_success'
                )
            });
            await Promise.allSettled([
                refreshScope('cosmetics', 'profile-decorations'),
                refreshCurrentUser({
                    expectedUserId: authTarget.userId,
                    expectedEndpoint: authTarget.endpoint,
                    expectedWebsocket: authTarget.websocket
                })
            ]);
        } finally {
            if (isCurrentInventoryAuthTarget(authTarget)) {
                profileDecorationMutationPendingRef.current = false;
                setProfileDecorationMutationPending(false);
                setMutatingKey((current) =>
                    current === mutationKey ? '' : current
                );
            }
        }
    }

    async function redeemReward() {
        const authTarget = getInventoryAuthTarget();
        const result = await prompt({
            title: t('prompt.redeem.header'),
            description: t('prompt.redeem.description'),
            confirmText: t('prompt.redeem.redeem'),
            cancelText: t('prompt.redeem.cancel')
        });
        const code = result.value?.trim();
        if (!result.ok || !code) {
            return;
        }
        if (!isCurrentInventoryAuthTarget(authTarget)) {
            return;
        }
        setMutatingKey('inventory:redeem');
        try {
            await vrchatMediaRepository.redeemReward(code);
            if (isCurrentInventoryAuthTarget(authTarget)) {
                toast.add({
                    type: 'success',
                    title: t('prompt.redeem.success')
                });
                await refreshScope(activeCategory, activeSubTab);
            }
        } catch (error) {
            if (isCurrentInventoryAuthTarget(authTarget)) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('view.tools.toast.failed_to_redeem_reward')
                });
            }
        } finally {
            setMutatingKey((current) =>
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
        currentUserId,
        cropRequest,
        deleteFileAsset,
        emojiAnimFps,
        emojiAnimFrameCount,
        emojiAnimLoopPingPong,
        emojiAnimType,
        emojiAnimationStyle,
        clipboardPasting,
        fileDropActive,
        imagePasteRef,
        gridDensity,
        gridDensityConfig,
        isVrcPlusSupporter,
        mutatingKey,
        openImagePreview,
        pasteClipboardUpload,
        profileDecorationMutationPending,
        redeemReward,
        refreshScope,
        rowsByScope:
            scopeStateAuthTargetKey === currentAuthTargetKey
                ? rowsByScope
                : EMPTY_ROWS_BY_SCOPE,
        loadingByScope:
            scopeStateAuthTargetKey === currentAuthTargetKey
                ? loadingByScope
                : EMPTY_LOADING_BY_SCOPE,
        setActiveCategory,
        setActiveSubTabs,
        setEmojiAnimFps,
        setEmojiAnimFrameCount,
        setEmojiAnimLoopPingPong,
        setEmojiAnimType,
        setEmojiAnimationStyle,
        setProfileDecorationEquipped,
        uploadInputRef,
        uploadingTarget,
        uploadSelectedFile
    };
}
