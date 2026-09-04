import {
    ArchiveIcon,
    CheckIcon,
    GiftIcon,
    ImageIcon,
    PackageIcon,
    RefreshCwIcon,
    RotateCcwIcon,
    SlidersHorizontalIcon,
    SettingsIcon,
    Trash2Icon,
    UploadIcon,
    XIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    EmptyState,
    LoadingState,
    PageBody,
    PageScaffold
} from '@/components/layout/PageScaffold';
import { ToolPageHeader } from '@/components/layout/ToolPageHeader';
import { ImageCropDialog } from '@/components/media/ImageCropDialog';
import {
    isArchivedInventoryItem,
    isEquippedProfileDecoration,
    resolveInventoryDescription,
    resolveInventoryImageUrl,
    resolveInventoryName,
    resolveInventoryType,
    resolveProfileDecorationMutation,
    resolveProfileDecorationPreviewUrl,
    resolveProfileDecorationTypeLabelKey
} from '@/domain/entities/inventory';
import { formatDateFilter } from '@/lib/dateTime';
import type {
    InventoryItemRecord,
    MediaFileRecord
} from '@/repositories/mediaRepository';
import { openExternalLink } from '@/services/entityMediaService';
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

import { GalleryEmojiImage } from './components/GalleryEmojiImage';
import { GalleryEmojiUploadSettings } from './components/GalleryEmojiUploadSettings';
import { InventoryItemTile } from './components/InventoryItemTile';
import { MediaAssetTile, shortAssetId } from './components/MediaAssetTile';
import type {
    MediaAssetBadge,
    MediaPreviewOptions
} from './components/MediaAssetTile';
import { MediaLibraryToolbar } from './components/MediaLibraryToolbar';
import {
    GALLERY_GRID_DENSITY_OPTIONS,
    sanitizeGalleryGridDensity,
    type GalleryGridDensity,
    type getGalleryGridDensityConfig
} from './galleryDensity';
import {
    CATEGORY_DEFINITIONS,
    CATEGORY_ORDER,
    getLatestFileUrl,
    getUsefulDisplayName,
    scopeKey,
    type InventoryCategory,
    type InventorySource
} from './inventoryHelpers';
import {
    IMAGE_UPLOAD_ACCEPT,
    useInventoryPageState,
    type InventoryRow
} from './useInventoryPageState';

type PreviewHandler = (options: MediaPreviewOptions) => void;

function GridSettingsMenu({
    gridDensity,
    onGridDensityChange
}: {
    gridDensity: GalleryGridDensity;
    onGridDensityChange: (value: GalleryGridDensity) => void;
}) {
    const { t } = useTranslation();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('common.actions.view_options')}
                    >
                        <SettingsIcon data-icon="inline-start" />
                    </Button>
                }
            />
            <DropdownMenuContent className="w-72 p-3" align="end">
                <FieldGroup>
                    <Field>
                        <FieldLabel>
                            {t('dialog.gallery_icons.grid_density')}
                        </FieldLabel>
                        <ToggleGroup
                            variant="outline"
                            size="sm"
                            spacing={1}
                            value={gridDensity ? [gridDensity] : []}
                            onValueChange={(nextValue) => {
                                if (nextValue[0]) {
                                    onGridDensityChange(
                                        sanitizeGalleryGridDensity(nextValue[0])
                                    );
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
    onDelete
}: {
    category: InventoryCategory;
    file: MediaFileRecord;
    mutatingKey: string;
    onPreview: PreviewHandler;
    onDelete: (fileId: string) => void;
}) {
    const { t } = useTranslation();
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
                    ? ({ className }: { className: string }) => (
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

export function InventoryItemCard({
    item,
    currentUserId,
    mutatingKey,
    profileDecorationMutationPending,
    onPreview,
    onArchive,
    onConsumeBundle,
    onSetProfileDecorationEquipped
}: {
    item: InventoryItemRecord;
    currentUserId: string | null;
    mutatingKey: string;
    profileDecorationMutationPending: boolean;
    onPreview: PreviewHandler;
    onArchive: (inventoryId: string, archived: boolean) => void;
    onConsumeBundle: (inventoryId: string) => void;
    onSetProfileDecorationEquipped: (item: InventoryItemRecord) => void;
}) {
    const { t } = useTranslation();
    const imageUrl = resolveInventoryImageUrl(item);
    const name = resolveInventoryName(item);
    const description = resolveInventoryDescription(item);
    const itemType = resolveInventoryType(item);
    const archived = isArchivedInventoryItem(item);
    const profileDecorationTypeLabelKey =
        resolveProfileDecorationTypeLabelKey(itemType);
    const profileDecorationMutation = resolveProfileDecorationMutation(
        item,
        currentUserId
    );
    const previewUrl = profileDecorationTypeLabelKey
        ? resolveProfileDecorationPreviewUrl(item)
        : imageUrl;
    const isMutating = mutatingKey === `inventory:${item.id}`;
    const timestamp =
        item.created_at || item.createdAt
            ? formatDateFilter(item.created_at || item.createdAt, 'long')
            : '';
    const isUnequip = profileDecorationMutation?.action === 'unequip';
    const profileDecorationAction = profileDecorationMutation
        ? {
              label: t(
                  isUnequip
                      ? 'dialog.inventory.unequip'
                      : 'dialog.inventory.equip'
              ),
              icon: isUnequip ? XIcon : CheckIcon,
              disabled: isMutating || profileDecorationMutationPending,
              onClick: () => onSetProfileDecorationEquipped(item)
          }
        : null;
    const primaryAction =
        itemType === 'bundle'
            ? {
                  label: t('dialog.gallery_icons.consume_bundle'),
                  icon: GiftIcon,
                  disabled: isMutating,
                  onClick: () => onConsumeBundle(item.id)
              }
            : profileDecorationAction;
    const badges: Array<MediaAssetBadge | null> = [
        itemType
            ? {
                  key: 'type',
                  label: profileDecorationTypeLabelKey
                      ? t(profileDecorationTypeLabelKey)
                      : itemType
              }
            : null,
        archived
            ? {
                  key: 'archived',
                  label: t('dialog.inventory.archived'),
                  variant: 'secondary'
              }
            : null
    ];

    return (
        <InventoryItemTile
            title={name || shortAssetId(item.id)}
            description={description}
            timestamp={timestamp}
            badges={badges}
            imageUrl={imageUrl}
            alt={name || item.id}
            isCurrent={isEquippedProfileDecoration(item)}
            currentLabel={t('dialog.inventory.equipped')}
            onPreview={() =>
                onPreview({
                    id: item.id,
                    url: previewUrl,
                    title: name || item.id
                })
            }
            primaryAction={primaryAction}
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
    currentUserId,
    mutatingKey,
    profileDecorationMutationPending,
    onPreview,
    onDeleteFile,
    onArchive,
    onConsumeBundle,
    onSetProfileDecorationEquipped
}: {
    category: InventoryCategory;
    rows: InventoryRow[];
    source?: InventorySource;
    loading?: boolean;
    densityConfig: ReturnType<typeof getGalleryGridDensityConfig>;
    currentUserId: string | null;
    mutatingKey: string;
    profileDecorationMutationPending: boolean;
    onPreview: PreviewHandler;
    onDeleteFile: (fileId: string) => void;
    onArchive: (inventoryId: string, archived: boolean) => void;
    onConsumeBundle: (inventoryId: string) => void;
    onSetProfileDecorationEquipped: (item: InventoryItemRecord) => void;
}) {
    const { t } = useTranslation();

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
                    />
                ) : (
                    <InventoryItemCard
                        key={row.id}
                        item={row}
                        currentUserId={currentUserId}
                        mutatingKey={mutatingKey}
                        profileDecorationMutationPending={
                            profileDecorationMutationPending
                        }
                        onPreview={onPreview}
                        onArchive={onArchive}
                        onConsumeBundle={onConsumeBundle}
                        onSetProfileDecorationEquipped={
                            onSetProfileDecorationEquipped
                        }
                    />
                )
            )}
        </div>
    );
}

export function InventoryPage() {
    const { t } = useTranslation();
    const inventory = useInventoryPageState();

    return (
        <PageScaffold className="gallery-page">
            <Input
                ref={inventory.uploadInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={inventory.uploadSelectedFile}
            />
            <ToolPageHeader
                toolKey="inventory"
                status={
                    inventory.uploadingTarget ? (
                        <Badge variant="outline">
                            {t('message.upload.loading')}{' '}
                            {inventory.uploadingTarget}
                        </Badge>
                    ) : null
                }
                actions={
                    <>
                        <GridSettingsMenu
                            gridDensity={inventory.gridDensity}
                            onGridDensityChange={inventory.changeGridDensity}
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                inventory.refreshScope(
                                    inventory.activeCategory,
                                    inventory.activeSubTab
                                );
                            }}
                        >
                            <RefreshCwIcon data-icon="inline-start" />
                            {t('dialog.gallery_icons.refresh')}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={
                                inventory.mutatingKey === 'inventory:redeem'
                            }
                            onClick={() => {
                                inventory.redeemReward();
                            }}
                        >
                            <GiftIcon data-icon="inline-start" />
                            {t('dialog.gallery_icons.redeem')}
                        </Button>
                    </>
                }
            />
            <PageBody>
                <Tabs
                    value={inventory.activeCategory}
                    onValueChange={inventory.setActiveCategory}
                    className="min-h-0 flex-1"
                >
                    <TabsList
                        variant="underline"
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
                        const categorySubTab =
                            inventory.activeSubTabs[category];
                        const selectedTab = definition.tabs.find(
                            (entry) => entry.key === categorySubTab
                        );
                        const selectedScopeKey = scopeKey(
                            category,
                            categorySubTab
                        );
                        const rows =
                            inventory.rowsByScope[selectedScopeKey] || [];
                        const loading =
                            inventory.loadingByScope[selectedScopeKey];
                        const selectedUploadTarget = selectedTab?.uploadTarget;
                        const selectedCanUpload = Boolean(selectedUploadTarget);
                        const showEmojiUploadOptions =
                            category === 'emojis' &&
                            categorySubTab === 'custom';
                        return (
                            <TabsContent
                                key={category}
                                value={category}
                                className="mt-2 flex min-h-0 flex-1 data-hidden:hidden"
                            >
                                <div className="flex min-h-0 flex-1 flex-col gap-3">
                                    <MediaLibraryToolbar
                                        leading={
                                            <ToggleGroup
                                                variant="outline"
                                                size="sm"
                                                spacing={1}
                                                value={
                                                    categorySubTab
                                                        ? [categorySubTab]
                                                        : []
                                                }
                                                onValueChange={(nextValue) => {
                                                    if (!nextValue[0]) {
                                                        return;
                                                    }
                                                    inventory.setActiveSubTabs(
                                                        (current) => ({
                                                            ...current,
                                                            [category]:
                                                                nextValue[0]
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
                                                        <PopoverTrigger
                                                            render={
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                >
                                                                    <SlidersHorizontalIcon data-icon="inline-start" />
                                                                    {t(
                                                                        'dialog.gallery_icons.upload_options'
                                                                    )}
                                                                </Button>
                                                            }
                                                        />
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
                                                                emojiAnimType={
                                                                    inventory.emojiAnimType
                                                                }
                                                                emojiAnimationStyle={
                                                                    inventory.emojiAnimationStyle
                                                                }
                                                                emojiAnimFps={
                                                                    inventory.emojiAnimFps
                                                                }
                                                                emojiAnimFrameCount={
                                                                    inventory.emojiAnimFrameCount
                                                                }
                                                                emojiAnimLoopPingPong={
                                                                    inventory.emojiAnimLoopPingPong
                                                                }
                                                                onEmojiAnimTypeChange={
                                                                    inventory.setEmojiAnimType
                                                                }
                                                                onEmojiAnimationStyleChange={
                                                                    inventory.setEmojiAnimationStyle
                                                                }
                                                                onEmojiAnimFpsChange={
                                                                    inventory.setEmojiAnimFps
                                                                }
                                                                onEmojiAnimFrameCountChange={
                                                                    inventory.setEmojiAnimFrameCount
                                                                }
                                                                onEmojiAnimLoopPingPongChange={
                                                                    inventory.setEmojiAnimLoopPingPong
                                                                }
                                                                onCreateAnimatedEmoji={() => {
                                                                    openExternalLink(
                                                                        'https://vrcemoji.com'
                                                                    );
                                                                }}
                                                            />
                                                        </PopoverContent>
                                                    </Popover>
                                                ) : null}
                                                {selectedCanUpload ? (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={
                                                            !inventory.isVrcPlusSupporter ||
                                                            Boolean(
                                                                inventory.uploadingTarget
                                                            )
                                                        }
                                                        onClick={() => {
                                                            if (
                                                                selectedUploadTarget
                                                            ) {
                                                                inventory.beginUpload(
                                                                    selectedUploadTarget
                                                                );
                                                            }
                                                        }}
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
                                                    onClick={() => {
                                                        inventory.refreshScope(
                                                            category,
                                                            categorySubTab
                                                        );
                                                    }}
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
                                            densityConfig={
                                                inventory.gridDensityConfig
                                            }
                                            currentUserId={
                                                inventory.currentUserId
                                            }
                                            mutatingKey={inventory.mutatingKey}
                                            profileDecorationMutationPending={
                                                inventory.profileDecorationMutationPending
                                            }
                                            onPreview={
                                                inventory.openImagePreview
                                            }
                                            onDeleteFile={(fileId) => {
                                                inventory.deleteFileAsset(
                                                    fileId
                                                );
                                            }}
                                            onArchive={(
                                                inventoryId,
                                                archived
                                            ) => {
                                                inventory.archiveInventoryItem(
                                                    inventoryId,
                                                    archived
                                                );
                                            }}
                                            onConsumeBundle={(inventoryId) => {
                                                inventory.consumeInventoryBundle(
                                                    inventoryId
                                                );
                                            }}
                                            onSetProfileDecorationEquipped={
                                                inventory.setProfileDecorationEquipped
                                            }
                                        />
                                    </div>
                                </div>
                            </TabsContent>
                        );
                    })}
                </Tabs>
            </PageBody>
            <ImageCropDialog
                open={Boolean(inventory.cropRequest)}
                file={inventory.cropRequest?.file || null}
                aspectRatio={inventory.cropRequest?.aspectRatio || 1}
                title={t('dialog.change_content_image.upload')}
                onOpenChange={(open) => {
                    if (!open) {
                        inventory.closeCropRequest();
                    }
                }}
                onConfirm={inventory.confirmCroppedUpload}
            />
        </PageScaffold>
    );
}
