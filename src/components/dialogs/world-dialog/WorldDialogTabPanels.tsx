import { RefreshCwIcon, UserIcon, UsersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { InstanceActionBar } from '@/components/instances/InstanceActionBar';
import { LocationWorld } from '@/components/LocationWorld';
import { ScreenshotThumbnailCard } from '@/features/tools/components/ScreenshotThumbnailGrid';
import { useScreenshotGalleryGrid } from '@/features/tools/useScreenshotGalleryGrid';
import { formatDateFilterOrFallback, timeToText } from '@/lib/dateTime';
import { openExternalLink } from '@/services/entityMediaService';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';
import { Spinner } from '@/ui/shadcn/spinner';

import {
    EntityDialogTabContent,
    EntityDialogTabs,
    EntityInfoBlock,
    EntityInfoGrid,
    EntityMemoTextarea,
    EntityRawJson
} from '../EntityDialogScaffold';
import { formatPreviousInstanceCount } from '../previous-instances-table/previousInstancesRows';
import { PreviousInstancesPanel } from '../PreviousInstancesTableDialog';
import {
    InstanceUserTiles,
    WorldInstancesEmptyState,
    resolveLaunchLocation
} from './WorldDialogViewParts';

const WORLD_DATE_FALLBACKS = {
    empty: '',
    invalid: String
};

function firstKnownValue(...values: any[]) {
    for (const value of values) {
        if (value !== null && typeof value !== 'undefined' && value !== '') {
            return value;
        }
    }
    return undefined;
}

function WorldScreenshotsEmptyState({ loading = false, message = '' }: any) {
    const { t } = useTranslation();

    return (
        <Empty className="min-h-32 border">
            <EmptyHeader>
                {loading ? <Spinner /> : null}
                <EmptyTitle>{t('dialog.world.screenshots.header')}</EmptyTitle>
                <EmptyDescription>
                    {message ||
                        t(
                            loading
                                ? 'dialog.world.screenshots.loading'
                                : 'dialog.world.screenshots.empty'
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
}: any) {
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
        compact: true,
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
            <div
                ref={viewportRef}
                className="min-h-0 flex-1 overflow-auto pr-1"
            >
                <div className="relative" style={{ height: totalHeight }}>
                    {visibleRows.map((row: any) => (
                        <div
                            key={row.key}
                            className="absolute right-0 left-0 grid"
                            style={{
                                top: row.top,
                                gridTemplateColumns: `repeat(${gridColumnCount}, minmax(${gridMinWidth}px, 1fr))`,
                                gap: gridGap
                            }}
                        >
                            {row.items.map((item: any) => (
                                <ScreenshotThumbnailCard
                                    key={item.path}
                                    compact
                                    item={item}
                                    onOpen={onOpenScreenshot}
                                    worldNameHint={worldName}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function WorldDialogTabPanels(props: any) {
    const { t } = useTranslation();
    const model = props?.tabModel || props || {};
    const commands = props?.tabCommands || props || {};
    const {
        activeTab,
        authorTags,
        currentUserId,
        displayInstanceRows,
        favoriteRate,
        hasPersistData,
        isInstanceLocation,
        lastVisitedInstance,
        memo,
        previousInstances,
        previewUrl,
        screenshots,
        screenshotsError,
        screenshotsRefreshDisabled,
        screenshotsStatus,
        tabs,
        totalVisitTime,
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
    return (
        <EntityDialogTabs
            value={activeTab}
            onValueChange={onChangeTab}
            tabs={tabs}
        >
            <EntityDialogTabContent
                value="instances"
                className="flex flex-col gap-3 px-px pt-3 pb-px"
            >
                <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">
                        <UserIcon data-icon="inline-start" />
                        {t('dialog.world.instances.public_count', {
                            count: world.publicOccupants ?? 0
                        })}
                    </Badge>
                    <Badge variant="outline">
                        <UserIcon data-icon="inline-start" />
                        {t('dialog.world.instances.private_count', {
                            count: world.privateOccupants ?? 0
                        })}
                    </Badge>
                    <Badge variant="outline">
                        <UsersIcon data-icon="inline-start" />
                        {t('dialog.world.instances.capacity_count', {
                            count: world.recommendedCapacity || '—',
                            max: world.capacity || '—'
                        })}
                    </Badge>
                </div>
                <div className="flex flex-col gap-2">
                    {displayInstanceRows.length ? (
                        displayInstanceRows.map((instance: any) => {
                            const location = resolveLaunchLocation(
                                world,
                                instance
                            );
                            const shortName = instance.shortName || '';
                            const launchToken =
                                instance.shortName || instance.secureName || '';
                            const playerCount = firstKnownValue(
                                instance.playerCount,
                                instance.userCount,
                                instance.occupants,
                                Array.isArray(instance.users)
                                    ? instance.users.length
                                    : undefined
                            );
                            const capacity = firstKnownValue(
                                instance.capacity,
                                instance.ref?.capacity,
                                instance.ref?.world?.capacity,
                                world.capacity
                            );
                            return (
                                <div
                                    key={instance.id}
                                    className="bg-muted/10 hover:bg-muted/25 rounded-md border px-2.5 py-2 text-sm transition-colors"
                                >
                                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0 flex-1">
                                            <LocationWorld
                                                className="min-w-0 text-sm"
                                                locationObject={{
                                                    ...(instance.ref || {}),
                                                    ...instance,
                                                    tag: location,
                                                    location,
                                                    shortName,
                                                    launchToken
                                                }}
                                                currentUserId={currentUserId}
                                                worldDialogShortName={
                                                    worldDialogShortName
                                                }
                                                grouphint={
                                                    instance.groupName ||
                                                    instance.group?.name ||
                                                    ''
                                                }
                                                playerCount={playerCount}
                                                capacity={capacity}
                                                showPlayerSummary={false}
                                                hint={
                                                    world.name ||
                                                    instance.worldName ||
                                                    instance.world?.name ||
                                                    ''
                                                }
                                            />
                                        </div>
                                        <InstanceActionBar
                                            className="min-w-0 flex-wrap justify-start sm:justify-end"
                                            target={{
                                                location,
                                                shortName: launchToken,
                                                worldName:
                                                    world.name ||
                                                    instance.worldName ||
                                                    instance.world?.name ||
                                                    ''
                                            }}
                                            instance={instance}
                                            friendCount={
                                                Number(instance.friendCount) ||
                                                undefined
                                            }
                                            playerCount={playerCount}
                                            capacity={capacity}
                                            instanceInfoPlacement="start"
                                            instanceCountAlign="left"
                                            instanceSummaryOrder="markers-first"
                                            showHistory={Boolean(
                                                previousInstances.length
                                            )}
                                            historyTooltip="Visit history"
                                            onHistory={() =>
                                                onChangeTab('visit-history')
                                            }
                                        />
                                    </div>
                                    <InstanceUserTiles instance={instance} />
                                </div>
                            );
                        })
                    ) : !isInstanceLocation ? (
                        <WorldInstancesEmptyState />
                    ) : null}
                </div>
            </EntityDialogTabContent>
            <EntityDialogTabContent
                value="visit-history"
                className="flex min-h-0 flex-col"
            >
                <PreviousInstancesPanel
                    title={t('dialog.world.actions.show_previous_instances')}
                    instances={previousInstances}
                    variant="world"
                    targetRef={world}
                    onRowsChange={onPreviousInstancesChange}
                    className="flex-1"
                />
            </EntityDialogTabContent>
            <EntityDialogTabContent
                value="screenshots"
                className="flex min-h-0 flex-col gap-3 px-px pt-3 pb-px"
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
                    <WorldScreenshotsEmptyState
                        message={t('dialog.world.screenshots.empty')}
                    />
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
                            lastVisitedInstance?.created_at ||
                                lastVisitedInstance?.createdAt,
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
                        label={t('dialog.world.info.platform')}
                        full
                    >
                        <span className="block text-xs whitespace-normal">
                            {world.platforms?.join(', ') || '—'}
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
                                {world.urlList.map((url: any) => (
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
                                {authorTags.map((tag: any) => (
                                    <Badge key={tag} variant="outline">
                                        {tag}
                                    </Badge>
                                ))}
                            </div>
                        </EntityInfoBlock>
                    ) : null}
                </EntityInfoGrid>
            </EntityDialogTabContent>
            <EntityDialogTabContent value="json">
                <EntityRawJson
                    value={{
                        world,
                        memo,
                        hasPersistData,
                        fileAnalysis: world.fileAnalysis || {}
                    }}
                />
            </EntityDialogTabContent>
        </EntityDialogTabs>
    );
}
