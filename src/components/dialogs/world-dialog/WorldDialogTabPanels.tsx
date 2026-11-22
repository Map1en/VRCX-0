import { ImageIcon, SparklesIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EconomyStoreListings } from '@/components/economy/EconomyStoreListings';
import {
    ToolbarActions,
    ToolbarRefreshButton,
    ToolbarStatus
} from '@/components/layout/ToolbarControls';
import { ScreenshotThumbnailCard } from '@/components/media/ScreenshotThumbnailCard';
import { useScreenshotGalleryGrid } from '@/components/media/useScreenshotGalleryGrid';
import { useAssistantChatStore } from '@/state/assistantChatStore';
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
    EntityRawJson
} from '../EntityDialogScaffold';
import { InstanceHistoryListPanel } from '../previous-instances-table/InstanceHistoryListPanel';
import { WorldInfoSections } from './WorldDialogInfoSections';
import { WorldDialogInstancesPanel } from './WorldDialogInstancesPanel';
import type {
    WorldDialogTabCommands,
    WorldDialogTabModel,
    WorldWorldScreenshots
} from './WorldDialogTabbedView';

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
    onOpenScreenshot
}: {
    screenshots: WorldWorldScreenshots;
    worldId: string;
    onOpenScreenshot: (path: string) => void;
}) {
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
                                        hideWorldTitle
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
        actionStatus,
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
        attributes,
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
        onOpenScreenshot,
        onPreviousInstancesChange,
        onRefresh,
        onRefreshScreenshots,
        onSaveMemo
    } = commands;
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
                    refreshing={actionStatus === 'refresh'}
                    onShowHistory={() => onChangeTab('visit-history')}
                    onRefresh={onRefresh}
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
                <div className="flex shrink-0 items-center gap-2">
                    <ToolbarStatus className="mr-auto tabular-nums">
                        {Array.isArray(screenshots) && screenshots.length
                            ? t('dialog.screenshot_metadata.image_count', {
                                  count: screenshots.length
                              })
                            : null}
                    </ToolbarStatus>
                    <ToolbarActions>
                        <ToolbarRefreshButton
                            loading={screenshotsRefreshDisabled}
                            onRefresh={onRefreshScreenshots}
                        />
                    </ToolbarActions>
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
                        onOpenScreenshot={onOpenScreenshot}
                    />
                ) : (
                    <WorldScreenshotsEmptyState />
                )}
            </EntityDialogTabContent>
            <EntityDialogTabContent value="info" forceMount>
                <WorldInfoSections
                    world={world}
                    authorTags={authorTags}
                    favoriteRate={favoriteRate}
                    friendVisits={friendVisits}
                    hasPersistData={hasPersistData}
                    lastVisitedInstance={lastVisitedInstance}
                    memo={memo}
                    previousInstanceCount={previousInstances.length}
                    previewUrl={previewUrl}
                    restrictions={restrictions}
                    attributes={attributes}
                    totalVisitTime={totalVisitTime}
                    onOpenVisitHistory={() => onChangeTab('visit-history')}
                    onSaveMemo={onSaveMemo}
                />
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
