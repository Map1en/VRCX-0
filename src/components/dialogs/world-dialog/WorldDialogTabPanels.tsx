import { ImageIcon, RefreshCwIcon, SparklesIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EconomyStoreListings } from '@/components/economy/EconomyStoreListings';
import { ScreenshotThumbnailCard } from '@/components/media/ScreenshotThumbnailCard';
import { useScreenshotGalleryGrid } from '@/components/media/useScreenshotGalleryGrid';
import { formatDateFilterOrFallback, timeToText } from '@/lib/dateTime';
import { openExternalLink } from '@/services/entityMediaService';
import { useAssistantChatStore } from '@/state/assistantChatStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@/ui/shadcn/empty';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    EntityDialogTabContent,
    EntityDialogTabs,
    EntityInfoBlock,
    EntityInfoGrid,
    EntityMemoTextarea,
    EntityRawJson
} from '../EntityDialogScaffold';
import { InstanceHistoryListPanel } from '../previous-instances-table/InstanceHistoryListPanel';
import { formatPreviousInstanceCount } from '../previous-instances-table/previousInstancesRows';
import { WorldDialogInstancesPanel } from './WorldDialogInstancesPanel';
import type {
    WorldDialogTabCommands,
    WorldDialogTabModel,
    WorldWorldScreenshots
} from './WorldDialogTabbedView';
import { friendVisitSummary } from './worldDialogUtils';
import { platformDisplayName } from './WorldDialogViewParts';

const WORLD_DATE_FALLBACKS = {
    empty: '',
    invalid: String
};

function WorldScreenshotsEmptyState({
    loading = false,
    message = ''
}: {
    loading?: boolean;
    message?: string;
}) {
    const { t } = useTranslation();

    return (
        <Empty className="min-h-32 border">
            <EmptyHeader>
                {loading ? (
                    <Spinner />
                ) : !message ? (
                    <EmptyMedia variant="icon">
                        <ImageIcon />
                    </EmptyMedia>
                ) : null}
                <EmptyTitle>{t('dialog.world.screenshots.header')}</EmptyTitle>
                <EmptyDescription>
                    {message ||
                        t(
                            loading
                                ? 'dialog.world.screenshots.loading'
                                : 'empty_state.world_screenshots_description'
                        )}
                </EmptyDescription>
            </EmptyHeader>
        </Empty>
    );
}

function WorldScreenshotsGrid({
    screenshots,
    worldId,
    worldName,
    onOpenScreenshot
}: {
    screenshots: WorldWorldScreenshots;
    worldId: string;
    worldName: string;
    onOpenScreenshot: (path: string) => void;
}) {
    const { t } = useTranslation();
    const safeScreenshots = Array.isArray(screenshots) ? screenshots : [];
    const {
        gridColumnCount,
        gridGap,
        gridMinWidth,
        totalHeight,
        viewportRef,
        visibleRows
    } = useScreenshotGalleryGrid({
        density: 'compact',
        items: safeScreenshots,
        resetKey: worldId
    });

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            <Badge variant="outline" className="w-fit">
                {t('dialog.screenshot_metadata.image_count', {
                    count: safeScreenshots.length
                })}
            </Badge>
            <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto p-1">
                <div className="relative" style={{ height: totalHeight }}>
                    {visibleRows.map((row) => (
                        <div
                            key={row.key}
                            className="absolute right-0 left-0 grid"
                            style={{
                                top: row.top,
                                gridTemplateColumns: `repeat(${gridColumnCount}, minmax(${gridMinWidth}px, 1fr))`,
                                gap: gridGap
                            }}
                        >
                            {row.items.map(
                                (item: WorldWorldScreenshots[number]) => (
                                    <ScreenshotThumbnailCard
                                        key={item.path}
                                        compact
                                        item={item}
                                        onOpen={onOpenScreenshot}
                                        worldNameHint={worldName}
                                    />
                                )
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function WorldDialogTabPanels({
    tabModel: model,
    tabCommands: commands
}: {
    tabModel: WorldDialogTabModel;
    tabCommands: WorldDialogTabCommands;
}) {
    const { t } = useTranslation();
    const {
        activeTab,
        authorTags,
        currentUserId,
        displayInstanceRows,
        favoriteRate,
        friendVisits,
        hasPersistData,
        isInstanceLocation,
        lastVisitedInstance,
        memo,
        previousInstances,
        previewUrl,
        restrictions,
        screenshots,
        screenshotsError,
        screenshotsRefreshDisabled,
        screenshotsStatus,
        tabs,
        totalVisitTime,
        visibleInstanceUserIds,
        world,
        worldDialogShortName
    } = model;
    const {
        onChangeTab,
        onOpenAuthor,
        onOpenScreenshot,
        onPreviousInstancesChange,
        onRefreshScreenshots,
        onSaveMemo
    } = commands;
    const releaseStatusLabel = world.isLabs
        ? t('dialog.world.tags.labs')
        : world.releaseStatus === 'public'
          ? t('dialog.world.tags.public')
          : world.releaseStatus === 'private'
            ? t('dialog.world.tags.private')
            : '—';
    return (
        <EntityDialogTabs
            value={activeTab}
            onValueChange={onChangeTab}
            tabs={tabs}
            actions={
                world.id ? (
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    type="button"
                                    size="icon-xs"
                                    variant="outline"
                                    aria-label={t('assistant.title')}
                                    onClick={() =>
                                        useAssistantChatStore
                                            .getState()
                                            .startAssistantDraft({
                                                topic: 'profile',
                                                target: {
                                                    kind: 'world',
                                                    id: world.id,
                                                    name: world.name || world.id
                                                }
                                            })
                                    }
                                >
                                    <SparklesIcon data-icon="inline-start" />
                                </Button>
                            }
                        />
                        <TooltipContent>{t('assistant.title')}</TooltipContent>
                    </Tooltip>
                ) : null
            }
        >
            <EntityDialogTabContent
                value="instances"
                className="flex flex-col gap-3 pt-3"
            >
                <WorldDialogInstancesPanel
                    world={world}
                    rows={displayInstanceRows}
                    currentUserId={currentUserId}
                    worldDialogShortName={worldDialogShortName}
                    visibleInstanceUserIds={visibleInstanceUserIds}
                    isInstanceLocation={isInstanceLocation}
                    showHistory={Boolean(previousInstances.length)}
                    onShowHistory={() => onChangeTab('visit-history')}
                />
            </EntityDialogTabContent>
            <EntityDialogTabContent
                value="visit-history"
                className="flex min-h-0 flex-col"
            >
                <InstanceHistoryListPanel
                    instances={previousInstances}
                    variant="world"
                    onRowsChange={onPreviousInstancesChange}
                    className="flex-1"
                />
            </EntityDialogTabContent>
            <EntityDialogTabContent
                value="screenshots"
                className="flex min-h-0 flex-col gap-3 pt-3"
            >
                <div className="flex shrink-0 justify-end">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={screenshotsRefreshDisabled}
                        onClick={onRefreshScreenshots}
                    >
                        {screenshotsRefreshDisabled ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <RefreshCwIcon data-icon="inline-start" />
                        )}
                        {t('common.actions.refresh')}
                    </Button>
                </div>
                {screenshotsError &&
                Array.isArray(screenshots) &&
                screenshots.length ? (
                    <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs">
                        {screenshotsError}
                    </div>
                ) : null}
                {screenshotsStatus === 'loading' ? (
                    <WorldScreenshotsEmptyState loading />
                ) : screenshotsError &&
                  (!Array.isArray(screenshots) || !screenshots.length) ? (
                    <WorldScreenshotsEmptyState message={screenshotsError} />
                ) : Array.isArray(screenshots) && screenshots.length ? (
                    <WorldScreenshotsGrid
                        screenshots={screenshots}
                        worldId={world.id}
                        worldName={world.name || ''}
                        onOpenScreenshot={onOpenScreenshot}
                    />
                ) : (
                    <WorldScreenshotsEmptyState />
                )}
            </EntityDialogTabContent>
            <EntityDialogTabContent value="info" forceMount>
                <EntityInfoGrid>
                    <EntityMemoTextarea
                        label={t('dialog.world.info.memo')}
                        value={memo}
                        placeholder={t('dialog.world.info.memo_placeholder')}
                        onSave={onSaveMemo}
                    />
                    {previewUrl ? (
                        <EntityInfoBlock
                            label={t('dialog.world.info.youtube_preview')}
                            wide
                            onClick={() => openExternalLink(previewUrl)}
                        >
                            <span className="block truncate text-xs">
                                {previewUrl}
                            </span>
                        </EntityInfoBlock>
                    ) : null}
                    <EntityInfoBlock
                        label={t('dialog.world.label.author')}
                        onClick={world.authorId ? onOpenAuthor : undefined}
                    >
                        <span className="block truncate text-xs">
                            {world.authorName || '—'}
                        </span>
                    </EntityInfoBlock>
                    <EntityInfoBlock
                        label={t('dialog.world.info.players')}
                        value={world.occupants ? String(world.occupants) : '—'}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.info.favorites')}
                        value={
                            world.favorites
                                ? `${world.favorites}${favoriteRate ? ` (${favoriteRate}%)` : ''}`
                                : '—'
                        }
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.info.visits')}
                        value={world.visits ? String(world.visits) : '—'}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.info.capacity')}
                        value={`${world.recommendedCapacity || '—'} (${world.capacity || '—'})`}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.info.created_at')}
                        value={formatDateFilterOrFallback(
                            world.createdAt || world.created_at,
                            'long',
                            WORLD_DATE_FALLBACKS
                        )}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.info.last_updated')}
                        value={formatDateFilterOrFallback(
                            world.updatedAt || world.updated_at,
                            'long',
                            WORLD_DATE_FALLBACKS
                        )}
                    />
                    {world.labsPublicationDate &&
                    world.labsPublicationDate !== 'none' ? (
                        <EntityInfoBlock
                            label={t('dialog.world.info.labs_publication_date')}
                            value={formatDateFilterOrFallback(
                                world.labsPublicationDate,
                                'long',
                                WORLD_DATE_FALLBACKS
                            )}
                        />
                    ) : null}
                    <EntityInfoBlock
                        label={t('dialog.world.info.publication_date')}
                        value={formatDateFilterOrFallback(
                            world.publicationDate,
                            'long',
                            WORLD_DATE_FALLBACKS
                        )}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.info.last_visited')}
                        value={formatDateFilterOrFallback(
                            lastVisitedInstance?.created_at,
                            'long',
                            WORLD_DATE_FALLBACKS
                        )}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.info.visit_count')}
                        value={
                            previousInstances.length
                                ? formatPreviousInstanceCount(
                                      previousInstances.length
                                  )
                                : '—'
                        }
                        onClick={
                            previousInstances.length
                                ? () => onChangeTab('visit-history')
                                : undefined
                        }
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.info.time_spent')}
                        value={
                            totalVisitTime > 0
                                ? timeToText(totalVisitTime)
                                : '—'
                        }
                    />
                    {friendVisits && friendVisits.friendCount > 0 ? (
                        <>
                            <EntityInfoBlock
                                label={t('dialog.world.info.friends_visited')}
                                wide
                            >
                                <span className="block truncate text-sm leading-snug font-medium">
                                    {String(friendVisits.friendCount)}
                                </span>
                                <span className="text-muted-foreground block truncate text-xs leading-snug">
                                    {friendVisitSummary(friendVisits)}
                                </span>
                            </EntityInfoBlock>
                            <EntityInfoBlock
                                label={t(
                                    'dialog.world.info.friends_last_visited'
                                )}
                                value={formatDateFilterOrFallback(
                                    friendVisits.lastVisitedAt,
                                    'long',
                                    WORLD_DATE_FALLBACKS
                                )}
                            />
                        </>
                    ) : null}
                    <EntityInfoBlock
                        label={t('dialog.world.info.version')}
                        value={world.version ? String(world.version) : '—'}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.info.heat')}
                        value={world.heat ? String(world.heat) : '—'}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.info.popularity')}
                        value={
                            world.popularity ? String(world.popularity) : '—'
                        }
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.info.persistent_data')}
                        value={hasPersistData ? '✓' : '—'}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.info.cache_size')}
                        value={world.$isCached ? world.$cacheSize || '—' : '—'}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.info.release_status')}
                        value={releaseStatusLabel}
                    />
                    <EntityInfoBlock
                        label={t('dialog.world.info.platform')}
                        full
                    >
                        <span className="block text-xs whitespace-normal">
                            {world.platforms
                                ?.map(platformDisplayName)
                                .join(', ') || '—'}
                        </span>
                    </EntityInfoBlock>
                    {Array.isArray(world.urlList) && world.urlList.length ? (
                        <EntityInfoBlock
                            label={t(
                                'dialog.allowed_video_player_domains.header'
                            )}
                            full
                        >
                            <div className="flex flex-wrap gap-1.5">
                                {world.urlList.map((url) => (
                                    <Badge key={url} variant="outline">
                                        {url}
                                    </Badge>
                                ))}
                            </div>
                        </EntityInfoBlock>
                    ) : null}
                    {authorTags.length ? (
                        <EntityInfoBlock
                            label={t('dialog.world.info.author_tags')}
                            full
                        >
                            <div className="flex flex-wrap gap-1.5">
                                {authorTags.map((tag) => (
                                    <Badge key={tag} variant="outline">
                                        {tag}
                                    </Badge>
                                ))}
                            </div>
                        </EntityInfoBlock>
                    ) : null}
                    {restrictions.length ? (
                        <EntityInfoBlock
                            label={t('dialog.world.info.restrictions')}
                            full
                        >
                            <div className="flex flex-wrap gap-1.5">
                                {restrictions.map((tag) => (
                                    <Badge key={tag.key} variant="outline">
                                        {tag.label}
                                    </Badge>
                                ))}
                            </div>
                        </EntityInfoBlock>
                    ) : null}
                </EntityInfoGrid>
            </EntityDialogTabContent>
            {typeof world.storeId === 'string' && world.storeId ? (
                <EntityDialogTabContent value="store">
                    <EconomyStoreListings storeId={world.storeId} />
                </EntityDialogTabContent>
            ) : null}
            <EntityDialogTabContent value="json">
                <EntityRawJson value={world} />
            </EntityDialogTabContent>
        </EntityDialogTabs>
    );
}
