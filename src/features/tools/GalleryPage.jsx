import {
    ArrowLeftIcon,
    CheckIcon,
    ExternalLinkIcon,
    EyeIcon,
    GiftIcon,
    ImageIcon,
    RefreshCwIcon,
    Trash2Icon,
    UploadIcon,
    XIcon
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { ImageCropDialog } from '@/components/media/ImageCropDialog.jsx';
import { formatDateFilter } from '@/lib/dateTime.js';
import { openExternalLink } from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import { mediaRepository, vrchatAuthRepository } from '@/repositories/index.js';
import userProfileRepository from '@/repositories/userProfileRepository.js';
import { emojiAnimationStyleList } from '@/shared/constants/emoji.js';
import { extractFileId } from '@/shared/utils/fileUtils.js';
import { getPrintFileName } from '@/shared/utils/gallery.js';
import { normalizeVrchatEndpointDomain } from '@/shared/vrchatEndpoint.js';
import {
    IMAGE_UPLOAD_ACCEPT,
    readFileAsBase64,
    validateImageUploadFile,
    withUploadTimeout
} from '@/shared/utils/imageUpload.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Field, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

const FILE_TABS = {
    gallery: {
        tag: 'gallery',
        titleKey: 'dialog.gallery_icons.gallery',
        aspectClass: 'aspect-[4/3]',
        max: 64
    },
    icons: {
        tag: 'icon',
        titleKey: 'dialog.gallery_icons.icons',
        aspectClass: 'aspect-square',
        max: 64
    },
    emojis: {
        tag: 'emoji',
        titleKey: 'dialog.gallery_icons.emojis',
        aspectClass: 'aspect-square',
        max: null
    },
    stickers: {
        tag: 'sticker',
        titleKey: 'dialog.gallery_icons.stickers',
        aspectClass: 'aspect-square',
        max: null
    }
};
const TAB_ORDER = [
    'gallery',
    'icons',
    'emojis',
    'stickers',
    'prints',
    'inventory'
];
const EMPTY_ASSETS = {
    gallery: [],
    icons: [],
    emojis: [],
    stickers: [],
    prints: [],
    inventory: []
};
const MAX_IMAGE_UPLOAD_BYTES = 20_000_000;
const UPLOAD_ASPECT_RATIOS = {
    gallery: 4 / 3,
    icons: 1,
    emojis: 1,
    stickers: 1,
    prints: 16 / 9
};

function getLatestFileUrl(file) {
    const versions = Array.isArray(file?.versions) ? file.versions : [];
    return versions.at(-1)?.file?.url ?? '';
}

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

function EmptyState({ title, description }) {
    return (
        <div className="bg-muted/20 flex min-h-72 items-center justify-center rounded-xl border border-dashed p-6 text-center">
            <div className="flex max-w-sm flex-col gap-2">
                <div className="text-sm font-medium">{title}</div>
                <div className="text-muted-foreground text-sm">
                    {description}
                </div>
            </div>
        </div>
    );
}

function LoadingState() {
    return (
        <div className="bg-muted/20 flex min-h-72 items-center justify-center rounded-xl border border-dashed">
            <Spinner className="text-muted-foreground size-6" />
        </div>
    );
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
                        : `Failed to load ${tab}.`
                );
            }
        } finally {
            setTabLoading(tab, false);
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
                        : 'Failed to load prints.'
                );
            }
        } finally {
            setTabLoading('prints', false);
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
                        : 'Failed to load inventory.'
                );
            }
        } finally {
            setTabLoading('inventory', false);
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
            title: `Delete ${tab} item`,
            description: normalizedFileId,
            confirmText: 'Delete',
            cancelText: 'Cancel',
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
            toast.success('Media item deleted.');
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : 'Failed to delete media item.'
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
            title: 'Delete print',
            description: normalizedPrintId,
            confirmText: 'Delete',
            cancelText: 'Cancel',
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
                toast.success('Print deleted.');
            }
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : 'Failed to delete print.'
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
            toast.error('No current user is available.');
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
                        : 'Failed to update profile media.'
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
                toast.success('Inventory bundle consumed.');
            }
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : 'Failed to consume inventory bundle.'
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
                        : 'Failed to redeem reward.'
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
            <Input
                ref={uploadInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={(event) => void uploadSelectedFile(event)}
            />
            <div className="ml-2 flex items-center gap-2">
                <Button
                    variant="ghost"
                    size="sm"
                    className="mr-3"
                    onClick={() => navigate('/tools')}
                >
                    <ArrowLeftIcon data-icon="inline-start" />
                    {t('nav_tooltip.tools')}
                </Button>
                <span className="header">
                    {t('dialog.gallery_icons.header')}
                </span>
                {uploadingTab ? (
                    <Badge variant="outline">Uploading {uploadingTab}</Badge>
                ) : null}
                <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    onClick={() => void refreshAll()}
                >
                    <RefreshCwIcon data-icon="inline-start" />
                    {t('dialog.gallery_icons.refresh')}
                </Button>
            </div>

            <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="min-h-0 flex-1"
            >
                <TabsList
                    variant="line"
                    className="flex h-auto w-full flex-wrap justify-start"
                >
                    {TAB_ORDER.map((tab) => (
                        <TabsTrigger
                            key={tab}
                            value={tab}
                            className="flex-none"
                        >
                            {FILE_TABS[tab]?.titleKey
                                ? t(FILE_TABS[tab].titleKey)
                                : t(`dialog.gallery_icons.${tab}`)}
                            <span className="text-muted-foreground text-xs">
                                {tabCounts[tab]}
                            </span>
                        </TabsTrigger>
                    ))}
                </TabsList>

                {Object.entries(FILE_TABS).map(([tab, definition]) => (
                    <TabsContent key={tab} value={tab} className="min-h-0">
                        <Card>
                            <CardHeader className="gap-4">
                                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                                    <div>
                                        <CardTitle>
                                            {t(definition.titleKey)}
                                        </CardTitle>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => void refreshTab(tab)}
                                        >
                                            <RefreshCwIcon data-icon="inline-start" />
                                            {t('dialog.gallery_icons.refresh')}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={
                                                !isVrcPlusSupporter ||
                                                Boolean(uploadingTab)
                                            }
                                            onClick={() => beginUpload(tab)}
                                        >
                                            <UploadIcon data-icon="inline-start" />
                                            {t('dialog.gallery_icons.upload')}
                                        </Button>
                                        {tab === 'gallery' ? (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={
                                                    !profilePicOverride ||
                                                    Boolean(mutatingKey)
                                                }
                                                onClick={() =>
                                                    void setProfileField(
                                                        'profilePicOverride',
                                                        ''
                                                    )
                                                }
                                            >
                                                <XIcon data-icon="inline-start" />
                                                {t(
                                                    'dialog.gallery_icons.clear'
                                                )}
                                            </Button>
                                        ) : null}
                                        {tab === 'icons' ? (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={
                                                    !userIcon ||
                                                    Boolean(mutatingKey)
                                                }
                                                onClick={() =>
                                                    void setProfileField(
                                                        'userIcon',
                                                        ''
                                                    )
                                                }
                                            >
                                                <XIcon data-icon="inline-start" />
                                                {t(
                                                    'dialog.gallery_icons.clear'
                                                )}
                                            </Button>
                                        ) : null}
                                    </div>
                                </div>
                                {tab === 'emojis' ? (
                                    <div className="bg-muted/20 flex flex-wrap items-end gap-3 rounded-lg border p-3">
                                        <div className="flex min-w-56 flex-col gap-1">
                                            <Label>
                                                {t(
                                                    'dialog.gallery_icons.emoji_animation_styles'
                                                )}
                                            </Label>
                                            <Select
                                                value={emojiAnimationStyle}
                                                onValueChange={
                                                    setEmojiAnimationStyle
                                                }
                                            >
                                                <SelectTrigger className="w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectGroup>
                                                        {Object.keys(
                                                            emojiAnimationStyleList
                                                        ).map((styleName) => (
                                                            <SelectItem
                                                                key={styleName}
                                                                value={
                                                                    styleName
                                                                }
                                                            >
                                                                {styleName}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectGroup>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <Field
                                            orientation="horizontal"
                                            className="h-9 w-auto"
                                        >
                                            <Checkbox
                                                id="gallery-emoji-animation-type"
                                                checked={emojiAnimType}
                                                onCheckedChange={(value) =>
                                                    setEmojiAnimType(
                                                        Boolean(value)
                                                    )
                                                }
                                            />
                                            <FieldLabel htmlFor="gallery-emoji-animation-type">
                                                {t(
                                                    'dialog.gallery_icons.emoji_animation_type'
                                                )}
                                            </FieldLabel>
                                        </Field>
                                        {emojiAnimType ? (
                                            <>
                                                <div className="flex w-28 flex-col gap-1">
                                                    <Label>
                                                        {t(
                                                            'dialog.gallery_icons.emoji_animation_fps'
                                                        )}
                                                    </Label>
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        max={64}
                                                        value={emojiAnimFps}
                                                        onChange={(event) =>
                                                            setEmojiAnimFps(
                                                                event.target
                                                                    .value
                                                            )
                                                        }
                                                    />
                                                </div>
                                                <div className="flex w-28 flex-col gap-1">
                                                    <Label>
                                                        {t(
                                                            'dialog.gallery_icons.emoji_animation_frame_count'
                                                        )}
                                                    </Label>
                                                    <Input
                                                        type="number"
                                                        min={2}
                                                        max={64}
                                                        value={
                                                            emojiAnimFrameCount
                                                        }
                                                        onChange={(event) =>
                                                            setEmojiAnimFrameCount(
                                                                event.target
                                                                    .value
                                                            )
                                                        }
                                                    />
                                                </div>
                                                <Field
                                                    orientation="horizontal"
                                                    className="h-9 w-auto"
                                                >
                                                    <Checkbox
                                                        id="gallery-emoji-loop-pingpong"
                                                        checked={
                                                            emojiAnimLoopPingPong
                                                        }
                                                        onCheckedChange={(
                                                            value
                                                        ) =>
                                                            setEmojiAnimLoopPingPong(
                                                                Boolean(value)
                                                            )
                                                        }
                                                    />
                                                    <FieldLabel htmlFor="gallery-emoji-loop-pingpong">
                                                        {t(
                                                            'dialog.gallery_icons.emoji_loop_pingpong'
                                                        )}
                                                    </FieldLabel>
                                                </Field>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                        void openExternalLink(
                                                            'https://vrcemoji.com'
                                                        )
                                                    }
                                                >
                                                    <ExternalLinkIcon data-icon="inline-start" />
                                                    {t(
                                                        'dialog.gallery_icons.create_animated_emoji'
                                                    )}
                                                </Button>
                                            </>
                                        ) : null}
                                    </div>
                                ) : null}
                            </CardHeader>
                            <CardContent>
                                {loadingByTab[tab] ? (
                                    <LoadingState />
                                ) : assets[tab].length > 0 ? (
                                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                                        {assets[tab].map((file) => {
                                            const imageUrl =
                                                getLatestFileUrl(file);
                                            const activeFileId =
                                                tab === 'gallery'
                                                    ? extractFileId(
                                                          profilePicOverride
                                                      )
                                                    : extractFileId(userIcon);
                                            const profileField =
                                                tab === 'gallery'
                                                    ? 'profilePicOverride'
                                                    : tab === 'icons'
                                                      ? 'userIcon'
                                                      : '';
                                            const isCurrent =
                                                activeFileId === file.id;
                                            const isMutating =
                                                mutatingKey ===
                                                `${tab}:${file.id}`;
                                            return (
                                                <Card
                                                    key={file.id}
                                                    className={cn(
                                                        'overflow-hidden',
                                                        isCurrent &&
                                                            'ring-primary ring-2'
                                                    )}
                                                >
                                                    {imageUrl ? (
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            className="h-auto w-full rounded-none p-0"
                                                            onClick={() =>
                                                                setPreview({
                                                                    id: file.id,
                                                                    url: imageUrl
                                                                })
                                                            }
                                                        >
                                                            <img
                                                                src={imageUrl}
                                                                alt={file.id}
                                                                loading="lazy"
                                                                className={cn(
                                                                    definition.aspectClass,
                                                                    'w-full object-cover'
                                                                )}
                                                            />
                                                        </Button>
                                                    ) : (
                                                        <div
                                                            className={cn(
                                                                'bg-muted text-muted-foreground flex w-full items-center justify-center',
                                                                definition.aspectClass
                                                            )}
                                                        >
                                                            <ImageIcon className="size-8" />
                                                        </div>
                                                    )}
                                                    <CardContent className="flex flex-col gap-3 p-4">
                                                        <div className="flex flex-col gap-1">
                                                            <div className="line-clamp-1 text-sm font-medium">
                                                                {file.displayName ||
                                                                    file.name ||
                                                                    file.id}
                                                            </div>
                                                            <div className="text-muted-foreground text-xs">
                                                                {Array.isArray(
                                                                    file.versions
                                                                )
                                                                    ? `${file.versions.length} version(s)`
                                                                    : 'No version data'}
                                                            </div>
                                                            {tab ===
                                                            'emojis' ? (
                                                                <div className="text-muted-foreground flex flex-wrap gap-1 text-xs">
                                                                    {file.loopStyle ? (
                                                                        <Badge variant="outline">
                                                                            {
                                                                                file.loopStyle
                                                                            }
                                                                        </Badge>
                                                                    ) : null}
                                                                    {file.animationStyle ? (
                                                                        <Badge variant="outline">
                                                                            {
                                                                                file.animationStyle
                                                                            }
                                                                        </Badge>
                                                                    ) : null}
                                                                    {file.framesOverTime ? (
                                                                        <Badge variant="outline">
                                                                            {
                                                                                file.framesOverTime
                                                                            }
                                                                            fps
                                                                        </Badge>
                                                                    ) : null}
                                                                    {file.frames ? (
                                                                        <Badge variant="outline">
                                                                            {
                                                                                file.frames
                                                                            }
                                                                            frames
                                                                        </Badge>
                                                                    ) : null}
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                        <div className="flex flex-wrap gap-2">
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                disabled={
                                                                    !imageUrl
                                                                }
                                                                onClick={() =>
                                                                    setPreview({
                                                                        id: file.id,
                                                                        url: imageUrl
                                                                    })
                                                                }
                                                            >
                                                                <EyeIcon data-icon="inline-start" />
                                                                Preview
                                                            </Button>
                                                            {profileField ? (
                                                                <Button
                                                                    variant={
                                                                        isCurrent
                                                                            ? 'default'
                                                                            : 'outline'
                                                                    }
                                                                    size="sm"
                                                                    disabled={
                                                                        !isVrcPlusSupporter ||
                                                                        isMutating ||
                                                                        !currentUserId
                                                                    }
                                                                    onClick={() =>
                                                                        void setProfileField(
                                                                            profileField,
                                                                            file.id
                                                                        )
                                                                    }
                                                                >
                                                                    <CheckIcon data-icon="inline-start" />
                                                                    {tab ===
                                                                    'icons'
                                                                        ? 'Icon'
                                                                        : 'Profile'}
                                                                </Button>
                                                            ) : null}
                                                            <Button
                                                                variant="destructive"
                                                                size="sm"
                                                                disabled={
                                                                    isMutating
                                                                }
                                                                onClick={() =>
                                                                    void deleteFileAsset(
                                                                        tab,
                                                                        file.id
                                                                    )
                                                                }
                                                            >
                                                                <Trash2Icon data-icon="inline-start" />
                                                                Delete
                                                            </Button>
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <EmptyState
                                        title={`No ${tab} loaded.`}
                                        description={`Refresh this tab to load ${definition.tag} files.`}
                                    />
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                ))}
                <TabsContent value="prints" className="min-h-0">
                    <Card>
                        <CardHeader className="gap-4">
                            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                                <div>
                                    <CardTitle>
                                        {t('dialog.gallery_icons.prints')}
                                    </CardTitle>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                            void refreshTab('prints')
                                        }
                                    >
                                        <RefreshCwIcon data-icon="inline-start" />
                                        {t('dialog.gallery_icons.refresh')}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={
                                            !isVrcPlusSupporter ||
                                            Boolean(uploadingTab)
                                        }
                                        onClick={() => beginUpload('prints')}
                                    >
                                        <UploadIcon data-icon="inline-start" />
                                        {t('dialog.gallery_icons.upload')}
                                    </Button>
                                </div>
                            </div>
                            <div className="bg-muted/20 flex flex-wrap items-end gap-3 rounded-lg border p-3">
                                <div className="flex w-80 max-w-full flex-col gap-1">
                                    <Label>
                                        {t('dialog.gallery_icons.note')}
                                    </Label>
                                    <Input
                                        maxLength={32}
                                        value={printUploadNote}
                                        onChange={(event) =>
                                            setPrintUploadNote(
                                                event.target.value
                                            )
                                        }
                                        placeholder={t(
                                            'dialog.gallery_icons.note'
                                        )}
                                    />
                                </div>
                                <Field
                                    orientation="horizontal"
                                    className="h-9 w-auto"
                                >
                                    <Checkbox
                                        id="gallery-print-crop-border"
                                        checked={printCropBorder}
                                        onCheckedChange={(value) =>
                                            setPrintCropBorder(Boolean(value))
                                        }
                                    />
                                    <FieldLabel htmlFor="gallery-print-crop-border">
                                        {t(
                                            'dialog.gallery_icons.crop_print_border'
                                        )}
                                    </FieldLabel>
                                </Field>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {loadingByTab.prints ? (
                                <LoadingState />
                            ) : assets.prints.length > 0 ? (
                                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                                    {assets.prints.map((print) => {
                                        const imageUrl =
                                            print?.files?.image || '';
                                        const isMutating =
                                            mutatingKey ===
                                            `prints:${print.id}`;
                                        return (
                                            <Card
                                                key={print.id}
                                                className="overflow-hidden"
                                            >
                                                {imageUrl ? (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        className="h-auto w-full rounded-none p-0"
                                                        onClick={() =>
                                                            setPreview({
                                                                id: print.id,
                                                                url: imageUrl,
                                                                title: getPrintFileName(
                                                                    print
                                                                )
                                                            })
                                                        }
                                                    >
                                                        <img
                                                            src={imageUrl}
                                                            alt={
                                                                print.note ||
                                                                print.id
                                                            }
                                                            loading="lazy"
                                                            className="aspect-[16/9] w-full object-cover"
                                                        />
                                                    </Button>
                                                ) : (
                                                    <div className="bg-muted text-muted-foreground flex aspect-[16/9] w-full items-center justify-center">
                                                        <ImageIcon className="size-8" />
                                                    </div>
                                                )}
                                                <CardContent className="flex flex-col gap-3 p-4">
                                                    <div className="flex flex-col gap-1">
                                                        <div className="line-clamp-1 text-sm font-medium">
                                                            {print.note ||
                                                                print.id}
                                                        </div>
                                                        <div className="text-muted-foreground line-clamp-1 text-xs">
                                                            {print.worldName ||
                                                                print.worldId ||
                                                                '\u00A0'}
                                                        </div>
                                                        <div className="text-muted-foreground line-clamp-1 font-mono text-xs">
                                                            {print.authorName ||
                                                                print.authorId ||
                                                                '\u00A0'}
                                                        </div>
                                                        {print.createdAt ? (
                                                            <div className="text-muted-foreground line-clamp-1 font-mono text-xs">
                                                                {formatDateFilter(
                                                                    print.createdAt,
                                                                    'long'
                                                                )}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            disabled={!imageUrl}
                                                            onClick={() =>
                                                                setPreview({
                                                                    id: print.id,
                                                                    url: imageUrl,
                                                                    title: getPrintFileName(
                                                                        print
                                                                    )
                                                                })
                                                            }
                                                        >
                                                            <EyeIcon data-icon="inline-start" />
                                                            Preview
                                                        </Button>
                                                        <Button
                                                            variant="destructive"
                                                            size="sm"
                                                            disabled={
                                                                isMutating
                                                            }
                                                            onClick={() =>
                                                                void deletePrint(
                                                                    print.id
                                                                )
                                                            }
                                                        >
                                                            <Trash2Icon data-icon="inline-start" />
                                                            Delete
                                                        </Button>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        );
                                    })}
                                </div>
                            ) : (
                                <EmptyState
                                    title="No prints loaded."
                                    description="Refresh this tab to load your VRChat prints."
                                />
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="inventory" className="min-h-0">
                    <Card>
                        <CardHeader className="gap-4">
                            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                                <div>
                                    <CardTitle>
                                        {t('dialog.gallery_icons.inventory')}
                                    </CardTitle>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                            void refreshTab('inventory')
                                        }
                                    >
                                        <RefreshCwIcon data-icon="inline-start" />
                                        {t('dialog.gallery_icons.refresh')}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={
                                            mutatingKey === 'inventory:redeem'
                                        }
                                        onClick={() => void redeemReward()}
                                    >
                                        <GiftIcon data-icon="inline-start" />
                                        {t('dialog.gallery_icons.redeem')}
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {loadingByTab.inventory ? (
                                <LoadingState />
                            ) : assets.inventory.length > 0 ? (
                                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                                    {assets.inventory.map((item) => {
                                        const isMutating =
                                            mutatingKey ===
                                            `inventory:${item.id}`;
                                        const typeLabel =
                                            item.itemType === 'prop'
                                                ? t('dialog.gallery_icons.item')
                                                : item.itemType === 'sticker'
                                                  ? t(
                                                        'dialog.gallery_icons.sticker'
                                                    )
                                                  : item.itemType ===
                                                      'droneskin'
                                                    ? t(
                                                          'dialog.gallery_icons.drone_skin'
                                                      )
                                                    : item.itemType === 'emoji'
                                                      ? t(
                                                            'dialog.gallery_icons.emoji'
                                                        )
                                                      : item.itemTypeLabel ||
                                                        item.itemType ||
                                                        'Item';
                                        return (
                                            <Card
                                                key={item.id}
                                                className="overflow-hidden"
                                            >
                                                {item.imageUrl ? (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        className="h-auto w-full rounded-none p-0"
                                                        onClick={() =>
                                                            setPreview({
                                                                id: item.id,
                                                                url: item.imageUrl,
                                                                title:
                                                                    item.name ||
                                                                    item.id
                                                            })
                                                        }
                                                    >
                                                        <img
                                                            src={item.imageUrl}
                                                            alt={
                                                                item.name ||
                                                                item.id
                                                            }
                                                            loading="lazy"
                                                            className="aspect-square w-full object-cover"
                                                        />
                                                    </Button>
                                                ) : (
                                                    <div className="bg-muted text-muted-foreground flex aspect-square w-full items-center justify-center">
                                                        <ImageIcon className="size-8" />
                                                    </div>
                                                )}
                                                <CardContent className="flex flex-col gap-3 p-4">
                                                    <div className="flex flex-col gap-1">
                                                        <div className="line-clamp-1 text-sm font-medium">
                                                            {item.name ||
                                                                item.id}
                                                        </div>
                                                        {item.description ? (
                                                            <div className="text-muted-foreground line-clamp-1 text-xs">
                                                                {
                                                                    item.description
                                                                }
                                                            </div>
                                                        ) : null}
                                                        {item.created_at ? (
                                                            <div className="text-muted-foreground line-clamp-1 font-mono text-xs">
                                                                {formatDateFilter(
                                                                    item.created_at,
                                                                    'long'
                                                                )}
                                                            </div>
                                                        ) : null}
                                                        <Badge variant="outline">
                                                            {typeLabel}
                                                        </Badge>
                                                    </div>
                                                    {item.itemType ===
                                                    'bundle' ? (
                                                        <Button
                                                            size="sm"
                                                            disabled={
                                                                isMutating
                                                            }
                                                            onClick={() =>
                                                                void consumeInventoryBundle(
                                                                    item.id
                                                                )
                                                            }
                                                        >
                                                            {t(
                                                                'dialog.gallery_icons.consume_bundle'
                                                            )}
                                                        </Button>
                                                    ) : null}
                                                </CardContent>
                                            </Card>
                                        );
                                    })}
                                </div>
                            ) : (
                                <EmptyState
                                    title="No inventory items loaded."
                                    description="Refresh this tab to load inventory items."
                                />
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

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

            <Dialog
                open={Boolean(preview)}
                onOpenChange={(open) => !open && setPreview(null)}
            >
                <DialogContent className="max-w-5xl">
                    <DialogHeader>
                        <DialogTitle>
                            {preview?.title ||
                                preview?.id ||
                                t('dialog.gallery_icons.gallery')}
                        </DialogTitle>
                        <DialogDescription>
                            {preview?.id || ''}
                        </DialogDescription>
                    </DialogHeader>
                    {preview?.url ? (
                        <img
                            src={preview.url}
                            alt={preview?.title || preview.id}
                            className="max-h-[75vh] w-full rounded-lg object-contain"
                        />
                    ) : null}
                </DialogContent>
            </Dialog>
        </div>
    );
}
