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
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

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
import { formatDateFilter } from '@/lib/dateTime';
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
import { MediaLibraryToolbar } from './components/MediaLibraryToolbar';
import { GALLERY_GRID_DENSITY_OPTIONS } from './galleryDensity';
import {
    CATEGORY_DEFINITIONS,
    CATEGORY_ORDER,
    getLatestFileUrl,
    getUsefulDisplayName,
    isArchivedInventoryItem,
    resolveInventoryDescription,
    resolveInventoryImageUrl,
    resolveInventoryName,
    resolveInventoryType,
    scopeKey
} from './inventoryHelpers';
import {
    IMAGE_UPLOAD_ACCEPT,
    useInventoryPageController
} from './useInventoryPageController';

function GridSettingsMenu({ gridDensity, onGridDensityChange }: any) {
    const { t } = useTranslation();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('dialog.gallery_icons.grid_settings')}
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
                                    onGridDensityChange(nextValue[0]);
                                }
                            }}
                            className="grid w-full grid-cols-3"
                        >
                            {GALLERY_GRID_DENSITY_OPTIONS.map((option: any) => (
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
}: any) {
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
                    ? ({ className }: any) => (
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
    onConsumeBundle
}: any) {
    const { t } = useTranslation();
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
    onConsumeBundle
}: any) {
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
            {rows.map((row: any) =>
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
                        mutatingKey={mutatingKey}
                        onPreview={onPreview}
                        onArchive={onArchive}
                        onConsumeBundle={onConsumeBundle}
                    />
                )
            )}
        </div>
    );
}

export function InventoryPage() {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const inventory = useInventoryPageController();

    return (
        <PageScaffold className="gallery-page">
            <Input
                ref={inventory.uploadInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={inventory.uploadSelectedFile}
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
                    {inventory.uploadingTarget ? (
                        <Badge variant="outline">
                            {t('message.upload.loading')}{' '}
                            {inventory.uploadingTarget}
                        </Badge>
                    ) : null}
                    <div className="ml-auto flex flex-wrap items-center gap-1">
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
                    </div>
                </PageToolbarRow>
            </PageToolbar>
            <PageBody>
                <Tabs
                    value={inventory.activeCategory}
                    onValueChange={inventory.setActiveCategory}
                    className="min-h-0 flex-1"
                >
                    <TabsList
                        variant="line"
                        className="flex h-auto w-full flex-wrap justify-start"
                    >
                        {CATEGORY_ORDER.map((category: any) => (
                            <TabsTrigger
                                key={category}
                                value={category}
                                className="flex-none"
                            >
                                {t(CATEGORY_DEFINITIONS[category].labelKey)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {CATEGORY_ORDER.map((category: any) => {
                        const definition = CATEGORY_DEFINITIONS[category];
                        const categorySubTab =
                            inventory.activeSubTabs[category];
                        const selectedTab = definition.tabs.find(
                            (entry: any) => entry.key === categorySubTab
                        );
                        const selectedScopeKey = scopeKey(
                            category,
                            categorySubTab
                        );
                        const rows =
                            inventory.rowsByScope[selectedScopeKey] || [];
                        const loading =
                            inventory.loadingByScope[selectedScopeKey];
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
                                                        (current: any) => ({
                                                            ...current,
                                                            [category]:
                                                                nextValue[0]
                                                        })
                                                    );
                                                }}
                                                className="flex flex-wrap justify-start"
                                            >
                                                {definition.tabs.map(
                                                    (tab: any) => (
                                                        <ToggleGroupItem
                                                            key={tab.key}
                                                            value={tab.key}
                                                            aria-label={t(
                                                                tab.labelKey
                                                            )}
                                                        >
                                                            {t(tab.labelKey)}
                                                        </ToggleGroupItem>
                                                    )
                                                )}
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
                                                        onClick={() =>
                                                            inventory.beginUpload(
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
                                            mutatingKey={inventory.mutatingKey}
                                            onPreview={
                                                inventory.openImagePreview
                                            }
                                            onDeleteFile={(fileId: any) => {
                                                inventory.deleteFileAsset(
                                                    fileId
                                                );
                                            }}
                                            onArchive={(
                                                inventoryId: any,
                                                archived: any
                                            ) => {
                                                inventory.archiveInventoryItem(
                                                    inventoryId,
                                                    archived
                                                );
                                            }}
                                            onConsumeBundle={(
                                                inventoryId: any
                                            ) => {
                                                inventory.consumeInventoryBundle(
                                                    inventoryId
                                                );
                                            }}
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
                onOpenChange={(open: any) => {
                    if (!open) {
                        inventory.closeCropRequest();
                    }
                }}
                onConfirm={inventory.confirmCroppedUpload}
            />
        </PageScaffold>
    );
}
