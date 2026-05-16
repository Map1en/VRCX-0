// @ts-nocheck
import {
    ArchiveIcon,
    GiftIcon,
    ImageIcon,
    PackageIcon,
    RefreshCwIcon,
    RotateCcwIcon,
    SlidersHorizontalIcon,
    SettingsIcon,
    Trash2Icon,
    UploadIcon
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
    EmptyState,
    LoadingState,
    PageBackButton,
    PageBody,
    PageHeader,
    PageScaffold,
    PageTitle,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold';
import { ImageCropDialog } from '@/components/media/ImageCropDialog';
import { openExternalLink } from '@/lib/entityMedia.js';
import { mediaRepository } from '@/repositories/index.js';
import { emojiAnimationStyleList } from '@/shared/constants/emoji.js';
import { formatDateFilter } from '@/lib/dateTime.js';
import {
    IMAGE_UPLOAD_ACCEPT,
    readFileAsBase64,
    validateImageUploadFile,
    withUploadTimeout
} from '@/shared/utils/imageUpload.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    Popover,
    PopoverContent,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger
} from '@/ui/shadcn/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { GalleryEmojiImage } from './components/GalleryEmojiImage';
import { GalleryEmojiUploadSettings } from './components/GalleryEmojiUploadSettings';
import { InventoryItemTile } from './components/InventoryItemTile';
import {
    MediaAssetTile,
    shortAssetId
} from './components/MediaAssetTile';
import { MediaLibraryToolbar } from './components/MediaLibraryToolbar';
import {
    GALLERY_GRID_DENSITY_OPTIONS,
    getGalleryGridDensityConfig,
    sanitizeGalleryGridDensity
} from './galleryDensity.js';

const MAX_IMAGE_UPLOAD_BYTES = 20_000_000;
const INVENTORY_GRID_DENSITY_STORAGE_KEY = 'VRCX_InventoryGridDensity';

const CATEGORY_ORDER = ['emojis', 'stickers', 'items', 'cosmetics'];

const CATEGORY_DEFINITIONS = {
    emojis: {
        labelKey: 'dialog.inventory.emojis',
        tabs: [
            {
                key: 'custom',
                labelKey: 'dialog.inventory.custom',
                source: 'file',
                fileTags: ['emoji', 'emojianimated'],
                uploadTarget: 'emojis'
            },
            {
                key: 'exclusive',
                labelKey: 'dialog.inventory.exclusive',
                source: 'inventory',
                params: {
                    types: 'emoji',
                    notFlags: 'ugc',
                    archived: false
                }
            },
            {
                key: 'archived',
                labelKey: 'dialog.inventory.archived',
                source: 'inventory',
                params: {
                    types: 'emoji',
                    archived: true
                }
            }
        ]
    },
    stickers: {
        labelKey: 'dialog.inventory.stickers',
        tabs: [
            {
                key: 'custom',
                labelKey: 'dialog.inventory.custom',
                source: 'file',
                fileTags: ['sticker'],
                uploadTarget: 'stickers'
            },
            {
                key: 'exclusive',
                labelKey: 'dialog.inventory.exclusive',
                source: 'inventory',
                params: {
                    types: 'sticker',
                    notFlags: 'ugc',
                    archived: false
                }
            },
            {
                key: 'archived',
                labelKey: 'dialog.inventory.archived',
                source: 'inventory',
                params: {
                    types: 'sticker',
                    archived: true
                }
            }
        ]
    },
    items: {
        labelKey: 'dialog.inventory.items',
        tabs: [
            {
                key: 'all',
                labelKey: 'dialog.inventory.all_items',
                source: 'inventory',
                params: {
                    types: 'bundle,prop',
                    notFlags: 'ugc',
                    archived: false
                }
            },
            {
                key: 'archived',
                labelKey: 'dialog.inventory.archived',
                source: 'inventory',
                params: {
                    types: 'bundle,prop',
                    archived: true
                }
            }
        ]
    },
    cosmetics: {
        labelKey: 'dialog.inventory.cosmetics',
        tabs: [
            {
                key: 'drones',
                labelKey: 'dialog.inventory.drones',
                source: 'inventory',
                params: {
                    types: 'droneskin',
                    notFlags: 'ugc',
                    archived: false
                }
            },
            {
                key: 'portals',
                labelKey: 'dialog.inventory.portals',
                source: 'inventory',
                params: {
                    types: 'portalskin',
                    notFlags: 'ugc',
                    archived: false
                }
            },
            {
                key: 'warp-effects',
                labelKey: 'dialog.inventory.warp_effects',
                source: 'inventory',
                params: {
                    types: 'warpeffect',
                    notFlags: 'ugc',
                    archived: false
                }
            },
            {
                key: 'loading-screens',
                labelKey: 'dialog.inventory.loading_screens',
                source: 'empty'
            },
            {
                key: 'archived',
                labelKey: 'dialog.inventory.archived',
                source: 'inventory',
                params: {
                    types: 'droneskin,portalskin,warpeffect',
                    archived: true
                }
            }
        ]
    }
};

function scopeKey(category, tab) {
    return `${category}:${tab}`;
}

function readGridDensityPreference() {
    if (typeof window === 'undefined') {
        return sanitizeGalleryGridDensity();
    }
    try {
        return sanitizeGalleryGridDensity(
            window.localStorage.getItem(INVENTORY_GRID_DENSITY_STORAGE_KEY)
        );
    } catch {
        return sanitizeGalleryGridDensity();
    }
}

function writeGridDensityPreference(value) {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        window.localStorage.setItem(INVENTORY_GRID_DENSITY_STORAGE_KEY, value);
    } catch {
        // Display preference only.
    }
}

function getLatestFileUrl(file) {
    const versions = Array.isArray(file?.versions) ? file.versions : [];
    return versions.at(-1)?.file?.url ?? '';
}

function getUsefulDisplayName(file) {
    const displayName = String(file?.displayName || '').trim();
    const name = String(file?.name || '').trim();
    const id = String(file?.id || '').trim();
    const visibleName = displayName || name;

    if (
        !visibleName ||
        visibleName === id ||
        /^file_[\w-]+_blob$/i.test(visibleName)
    ) {
        return '';
    }

    return visibleName;
}

function resolveInventoryImageUrl(item) {
    return (
        item?.imageUrl ||
        item?.thumbnailUrl ||
        item?.item?.imageUrl ||
        item?.item?.thumbnailUrl ||
        item?.template?.imageUrl ||
        item?.template?.thumbnailUrl ||
        item?.metadata?.imageUrl ||
        ''
    );
}

function resolveInventoryName(item) {
    return (
        item?.name ||
        item?.item?.name ||
        item?.template?.name ||
        item?.displayName ||
        item?.id ||
        ''
    );
}

function resolveInventoryDescription(item) {
    return (
        item?.description ||
        item?.item?.description ||
        item?.template?.description ||
        ''
    );
}

function resolveInventoryType(item) {
    return item?.itemType || item?.type || item?.item?.type || '';
}

function isArchivedInventoryItem(item) {
    return Boolean(item?.isArchived || item?.archived);
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

function GridSettingsMenu({ t, gridDensity, onGridDensityChange }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('dialog.gallery_icons.grid_settings')}
                >
                    <SettingsIcon data-icon="inline-start" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-72 p-3" align="end">
                <FieldGroup>
                    <Field>
                        <FieldLabel>
                            {t('dialog.gallery_icons.grid_density')}
                        </FieldLabel>
                        <ToggleGroup
                            type="single"
                            variant="outline"
                            size="sm"
                            spacing={1}
                            value={gridDensity}
                            onValueChange={(nextValue) => {
                                if (nextValue) {
                                    onGridDensityChange(nextValue);
                                }
                            }}
                            className="grid w-full grid-cols-3"
                        >
                            {GALLERY_GRID_DENSITY_OPTIONS.map((option) => (
                                <ToggleGroupItem
                                    key={option.value}
                                    value={option.value}
                                    aria-label={t(option.labelKey)}
                                    className="w-full min-w-0 justify-center px-2"
                                >
                                    <span className="truncate">
                                        {t(option.labelKey)}
                                    </span>
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                    </Field>
                </FieldGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function InventoryFileCard({
    category,
    file,
    mutatingKey,
    onPreview,
    onDelete,
    t
}) {
    const imageUrl = getLatestFileUrl(file);
    const displayName = getUsefulDisplayName(file);
    const isMutating = mutatingKey === `file:${file.id}`;
    const hideFileName = category === 'emojis' || category === 'stickers';
    const badges =
        category === 'emojis'
            ? [
                  file.loopStyle
                      ? { key: 'loopStyle', label: file.loopStyle }
                      : null,
                  file.animationStyle
                      ? { key: 'animationStyle', label: file.animationStyle }
                      : null,
                  file.framesOverTime
                      ? {
                            key: 'fps',
                            label: `${file.framesOverTime}${t('view.tools.label.fps')}`
                        }
                      : null,
                  file.frames
                      ? {
                            key: 'frames',
                            label: `${file.frames}${t('view.tools.label.frames')}`
                        }
                      : null
              ].filter(Boolean)
            : [];

    return (
        <MediaAssetTile
            title={displayName || shortAssetId(file.id)}
            subtitle={displayName ? shortAssetId(file.id) : ''}
            badges={badges}
            imageUrl={imageUrl}
            alt={displayName || file.id}
            imageFit="contain"
            hideContent={hideFileName}
            placeholderIcon={ImageIcon}
            renderMedia={
                category === 'emojis' && imageUrl
                    ? ({ className }) => (
                          <GalleryEmojiImage
                              file={category === 'emojis' ? file : null}
                              imageUrl={imageUrl}
                              alt={displayName || file.id}
                              className={className}
                          />
                      )
                    : null
            }
            onPreview={() =>
                onPreview({
                    id: file.id,
                    title: displayName || file.id,
                    url: imageUrl
                })
            }
            menuLabel={t('aria.more')}
            menuActions={[
                {
                    key: 'delete',
                    label: t('common.actions.delete'),
                    icon: Trash2Icon,
                    destructive: true,
                    disabled: isMutating,
                    onSelect: () => onDelete(file.id)
                }
            ]}
        />
    );
}

function InventoryItemCard({
    item,
    mutatingKey,
    onPreview,
    onArchive,
    onConsumeBundle,
    t
}) {
    const imageUrl = resolveInventoryImageUrl(item);
    const name = resolveInventoryName(item);
    const description = resolveInventoryDescription(item);
    const itemType = resolveInventoryType(item);
    const archived = isArchivedInventoryItem(item);
    const isMutating = mutatingKey === `inventory:${item.id}`;
    const timestamp =
        item.created_at || item.createdAt
            ? formatDateFilter(item.created_at || item.createdAt, 'long')
            : '';

    return (
        <InventoryItemTile
            title={name || shortAssetId(item.id)}
            description={description}
            timestamp={timestamp}
            badges={[
                itemType ? { key: 'type', label: itemType } : null,
                archived
                    ? {
                          key: 'archived',
                          label: t('dialog.inventory.archived'),
                          variant: 'secondary'
                      }
                    : null
            ].filter(Boolean)}
            imageUrl={imageUrl}
            alt={name || item.id}
            onPreview={() =>
                onPreview({
                    id: item.id,
                    url: imageUrl,
                    title: name || item.id
                })
            }
            primaryAction={
                itemType === 'bundle'
                    ? {
                          label: t('dialog.gallery_icons.consume_bundle'),
                          icon: GiftIcon,
                          disabled: isMutating,
                          onClick: () => onConsumeBundle(item.id)
                      }
                    : null
            }
            menuLabel={t('aria.more')}
            menuActions={[
                {
                    key: archived ? 'unarchive' : 'archive',
                    label: archived
                        ? t('dialog.inventory.unarchive')
                        : t('dialog.inventory.archive'),
                    icon: archived ? RotateCcwIcon : ArchiveIcon,
                    disabled: isMutating,
                    onSelect: () => onArchive(item.id, !archived)
                }
            ]}
        />
    );
}

function InventoryRows({
    category,
    rows,
    source,
    loading,
    densityConfig,
    mutatingKey,
    onPreview,
    onDeleteFile,
    onArchive,
    onConsumeBundle,
    t
}) {
    if (loading) {
        return <LoadingState className="min-h-72" />;
    }

    if (!rows.length) {
        return (
            <EmptyState
                icon={source === 'file' ? ImageIcon : PackageIcon}
                title={t('dialog.inventory.empty_title')}
                description={t('dialog.inventory.empty_description')}
                className="min-h-72"
            />
        );
    }

    return (
        <div className={`${densityConfig.inventoryGridClass} p-1`}>
            {rows.map((row) =>
                source === 'file' ? (
                    <InventoryFileCard
                        key={row.id}
                        category={category}
                        file={row}
                        mutatingKey={mutatingKey}
                        onPreview={onPreview}
                        onDelete={onDeleteFile}
                        t={t}
                    />
                ) : (
                    <InventoryItemCard
                        key={row.id}
                        item={row}
                        mutatingKey={mutatingKey}
                        onPreview={onPreview}
                        onArchive={onArchive}
                        onConsumeBundle={onConsumeBundle}
                        t={t}
                    />
                )
            )}
        </div>
    );
}

export function InventoryPage() {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const uploadInputRef = useRef(null);
    const uploadTargetRef = useRef(null);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const [activeCategory, setActiveCategory] = useState('emojis');
    const [activeSubTabs, setActiveSubTabs] = useState({
        emojis: 'custom',
        stickers: 'custom',
        items: 'all',
        cosmetics: 'drones'
    });
    const [rowsByScope, setRowsByScope] = useState({});
    const [loadingByScope, setLoadingByScope] = useState({});
    const [mutatingKey, setMutatingKey] = useState('');
    const [uploadingTarget, setUploadingTarget] = useState('');
    const [cropRequest, setCropRequest] = useState(null);
    const [emojiAnimFps, setEmojiAnimFps] = useState(15);
    const [emojiAnimFrameCount, setEmojiAnimFrameCount] = useState(4);
    const [emojiAnimType, setEmojiAnimType] = useState(false);
    const [emojiAnimationStyle, setEmojiAnimationStyle] = useState('Stop');
    const [emojiAnimLoopPingPong, setEmojiAnimLoopPingPong] = useState(false);
    const [gridDensity, setGridDensity] = useState(readGridDensityPreference);
    const gridDensityConfig = useMemo(
        () => getGalleryGridDensityConfig(gridDensity),
        [gridDensity]
    );
    const isVrcPlusSupporter = Boolean(
        currentUserSnapshot?.$isVRCPlus ||
            currentUserSnapshot?.tags?.includes?.('system_supporter') ||
            globalThis?.$debug?.debugVrcPlus
    );

    const activeSubTab = activeSubTabs[activeCategory];
    const activeScopeKey = scopeKey(activeCategory, activeSubTab);

    function getAuthTarget() {
        return {
            userId: currentUserId || '',
            endpoint: currentEndpoint || ''
        };
    }

    function isCurrentAuthTarget(authTarget) {
        const currentAuth = getAuthTarget();
        return (
            currentAuth.userId === authTarget.userId &&
            currentAuth.endpoint === authTarget.endpoint
        );
    }

    function changeGridDensity(nextValue) {
        const nextDensity = sanitizeGalleryGridDensity(nextValue);
        setGridDensity(nextDensity);
        writeGridDensityPreference(nextDensity);
    }

    function setScopeLoading(key, value) {
        setLoadingByScope((current) => ({
            ...current,
            [key]: Boolean(value)
        }));
    }

    function setScopeRows(key, rows) {
        setRowsByScope((current) => ({
            ...current,
            [key]: Array.isArray(rows) ? rows : []
        }));
    }

    async function loadFileRows(definition, authTarget) {
        const nextRows = [];
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

    async function loadInventoryRows(definition) {
        if (definition.source === 'empty') {
            return [];
        }
        const nextRows = [];
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

    async function refreshScope(category = activeCategory, tab = activeSubTab) {
        const definition = CATEGORY_DEFINITIONS[category].tabs.find(
            (entry) => entry.key === tab
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
        void refreshScope(activeCategory, activeSubTab);
    }, [currentEndpoint, currentUserId, activeCategory, activeSubTab]);

    function beginUpload(target) {
        if (!isVrcPlusSupporter) {
            toast.error(t('message.vrcplus.required'));
            return;
        }
        uploadTargetRef.current = target;
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

    function uploadAsset(target, base64Body, settings) {
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

    async function confirmCroppedUpload(blob) {
        const request = cropRequest;
        if (!request || !blob || !isCurrentAuthTarget(request.authTarget)) {
            return;
        }
        const { target, settings, authTarget } = request;
        setUploadingTarget(target);
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
                setRowsByScope((current) => ({
                    ...current,
                    [key]: [
                        args.json,
                        ...(current[key] || []).filter(
                            (item) => item.id !== args.json.id
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

    async function deleteFileAsset(fileId) {
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
                setRowsByScope((current) => ({
                    ...current,
                    [activeScopeKey]: (current[activeScopeKey] || []).filter(
                        (file) => file.id !== normalizedFileId
                    )
                }));
                toast.success(t('view.tools.success.media_item_deleted'));
            }
        } catch (error) {
            if (isCurrentAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.tools.toast.failed_to_delete_media_item'
                          )
                );
            }
        } finally {
            setMutatingKey((current) =>
                current === `file:${normalizedFileId}` ? '' : current
            );
        }
    }

    async function archiveInventoryItem(inventoryId, archived) {
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
            setMutatingKey((current) =>
                current === `inventory:${normalizedInventoryId}` ? '' : current
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
        setMutatingKey(`inventory:${normalizedInventoryId}`);
        try {
            await mediaRepository.consumeInventoryBundle(
                normalizedInventoryId,
                {
                    endpoint: currentEndpoint
                }
            );
            if (isCurrentAuthTarget(authTarget)) {
                toast.success(
                    t('view.tools.label.inventory_bundle_consumed')
                );
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
                        : t(
                              'view.tools.toast.failed_to_redeem_reward'
                          )
                );
            }
        } finally {
            setMutatingKey((current) =>
                current === 'inventory:redeem' ? '' : current
            );
        }
    }

    return (
        <PageScaffold className="gallery-page">
            <Input
                ref={uploadInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={uploadSelectedFile}
            />
            <PageToolbar>
                <PageToolbarRow className="items-center">
                    <PageBackButton
                        label={t('nav_tooltip.tools')}
                        onClick={() => navigate('/tools')}
                    />
                    <PageHeader className="min-w-0 p-0">
                        <PageTitle>{t('dialog.inventory.header')}</PageTitle>
                    </PageHeader>
                    {uploadingTarget ? (
                        <Badge variant="outline">
                            {t('message.upload.loading')} {uploadingTarget}
                        </Badge>
                    ) : null}
                    <div className="ml-auto flex flex-wrap items-center gap-1">
                        <GridSettingsMenu
                            t={t}
                            gridDensity={gridDensity}
                            onGridDensityChange={changeGridDensity}
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                                void refreshScope(
                                    activeCategory,
                                    activeSubTab
                                )
                            }
                        >
                            <RefreshCwIcon data-icon="inline-start" />
                            {t('dialog.gallery_icons.refresh')}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={mutatingKey === 'inventory:redeem'}
                            onClick={() => void redeemReward()}
                        >
                            <GiftIcon data-icon="inline-start" />
                            {t('dialog.gallery_icons.redeem')}
                        </Button>
                    </div>
                </PageToolbarRow>
            </PageToolbar>
            <PageBody>
                <Tabs
                    value={activeCategory}
                    onValueChange={setActiveCategory}
                    className="min-h-0 flex-1"
                >
                    <TabsList
                        variant="line"
                        className="flex h-auto w-full flex-wrap justify-start"
                    >
                        {CATEGORY_ORDER.map((category) => (
                            <TabsTrigger
                                key={category}
                                value={category}
                                className="flex-none"
                            >
                                {t(CATEGORY_DEFINITIONS[category].labelKey)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {CATEGORY_ORDER.map((category) => {
                        const definition = CATEGORY_DEFINITIONS[category];
                        const categorySubTab = activeSubTabs[category];
                        const selectedTab = definition.tabs.find(
                            (entry) => entry.key === categorySubTab
                        );
                        const selectedScopeKey = scopeKey(
                            category,
                            categorySubTab
                        );
                        const rows = rowsByScope[selectedScopeKey] || [];
                        const loading = loadingByScope[selectedScopeKey];
                        const selectedCanUpload = Boolean(
                            selectedTab?.uploadTarget
                        );
                        const showEmojiUploadOptions =
                            category === 'emojis' &&
                            categorySubTab === 'custom';
                        return (
                            <TabsContent
                                key={category}
                                value={category}
                                className="mt-2 min-h-0 flex-1 data-[state=active]:flex data-[state=inactive]:hidden"
                            >
                                <div className="flex min-h-0 flex-1 flex-col gap-3">
                                    <MediaLibraryToolbar
                                        leading={
                                            <ToggleGroup
                                                type="single"
                                                variant="outline"
                                                size="sm"
                                                spacing={1}
                                                value={categorySubTab}
                                                onValueChange={(nextValue) => {
                                                    if (!nextValue) {
                                                        return;
                                                    }
                                                    setActiveSubTabs(
                                                        (current) => ({
                                                            ...current,
                                                            [category]:
                                                                nextValue
                                                        })
                                                    );
                                                }}
                                                className="flex flex-wrap justify-start"
                                            >
                                                {definition.tabs.map((tab) => (
                                                    <ToggleGroupItem
                                                        key={tab.key}
                                                        value={tab.key}
                                                        aria-label={t(
                                                            tab.labelKey
                                                        )}
                                                    >
                                                        {t(tab.labelKey)}
                                                    </ToggleGroupItem>
                                                ))}
                                            </ToggleGroup>
                                        }
                                        actions={
                                            <>
                                                {showEmojiUploadOptions ? (
                                                    <Popover>
                                                        <PopoverTrigger asChild>
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                            >
                                                                <SlidersHorizontalIcon data-icon="inline-start" />
                                                                {t(
                                                                    'dialog.gallery_icons.upload_options'
                                                                )}
                                                            </Button>
                                                        </PopoverTrigger>
                                                        <PopoverContent
                                                            align="end"
                                                            className="w-80"
                                                        >
                                                            <PopoverHeader>
                                                                <PopoverTitle>
                                                                    {t(
                                                                        'dialog.gallery_icons.upload_options'
                                                                    )}
                                                                </PopoverTitle>
                                                            </PopoverHeader>
                                                            <GalleryEmojiUploadSettings
                                                                compact
                                                                t={t}
                                                                emojiAnimType={
                                                                    emojiAnimType
                                                                }
                                                                emojiAnimationStyle={
                                                                    emojiAnimationStyle
                                                                }
                                                                emojiAnimFps={
                                                                    emojiAnimFps
                                                                }
                                                                emojiAnimFrameCount={
                                                                    emojiAnimFrameCount
                                                                }
                                                                emojiAnimLoopPingPong={
                                                                    emojiAnimLoopPingPong
                                                                }
                                                                onEmojiAnimTypeChange={
                                                                    setEmojiAnimType
                                                                }
                                                                onEmojiAnimationStyleChange={
                                                                    setEmojiAnimationStyle
                                                                }
                                                                onEmojiAnimFpsChange={
                                                                    setEmojiAnimFps
                                                                }
                                                                onEmojiAnimFrameCountChange={
                                                                    setEmojiAnimFrameCount
                                                                }
                                                                onEmojiAnimLoopPingPongChange={
                                                                    setEmojiAnimLoopPingPong
                                                                }
                                                                onCreateAnimatedEmoji={() =>
                                                                    void openExternalLink(
                                                                        'https://vrcemoji.com'
                                                                    )
                                                                }
                                                            />
                                                        </PopoverContent>
                                                    </Popover>
                                                ) : null}
                                                {selectedCanUpload ? (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={
                                                            !isVrcPlusSupporter ||
                                                            Boolean(
                                                                uploadingTarget
                                                            )
                                                        }
                                                        onClick={() =>
                                                            beginUpload(
                                                                selectedTab.uploadTarget
                                                            )
                                                        }
                                                    >
                                                        <UploadIcon data-icon="inline-start" />
                                                        {t(
                                                            'dialog.gallery_icons.upload'
                                                        )}
                                                    </Button>
                                                ) : null}
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                        void refreshScope(
                                                            category,
                                                            categorySubTab
                                                        )
                                                    }
                                                >
                                                    <RefreshCwIcon data-icon="inline-start" />
                                                    {t(
                                                        'dialog.gallery_icons.refresh'
                                                    )}
                                                </Button>
                                            </>
                                        }
                                    />
                                    <div className="min-h-0 flex-1 overflow-y-auto p-1">
                                        <InventoryRows
                                            category={category}
                                            rows={rows}
                                            source={selectedTab?.source}
                                            loading={loading}
                                            densityConfig={gridDensityConfig}
                                            mutatingKey={mutatingKey}
                                            onPreview={openImagePreview}
                                            onDeleteFile={(fileId) =>
                                                void deleteFileAsset(fileId)
                                            }
                                            onArchive={(inventoryId, archived) =>
                                                void archiveInventoryItem(
                                                    inventoryId,
                                                    archived
                                                )
                                            }
                                            onConsumeBundle={(inventoryId) =>
                                                void consumeInventoryBundle(
                                                    inventoryId
                                                )
                                            }
                                            t={t}
                                        />
                                    </div>
                                </div>
                            </TabsContent>
                        );
                    })}
                </Tabs>
            </PageBody>
            <ImageCropDialog
                open={Boolean(cropRequest)}
                file={cropRequest?.file || null}
                aspectRatio={cropRequest?.aspectRatio || 1}
                title={t('dialog.change_content_image.upload')}
                onOpenChange={(open) => {
                    if (!open) {
                        uploadTargetRef.current = null;
                        setCropRequest(null);
                    }
                }}
                onConfirm={confirmCroppedUpload}
            />
        </PageScaffold>
    );
}
