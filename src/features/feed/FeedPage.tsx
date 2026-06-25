import { Columns3Icon, TableIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { PreviousInstancesTableDialog } from '@/components/dialogs/PreviousInstancesTableDialog';
import { PageBody, PageScaffold } from '@/components/layout/PageScaffold';
import { Spinner } from '@/ui/shadcn/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { FeedColumnsMode } from './columns/FeedColumnsMode';
import { FeedTableShell } from './components/FeedTableShell';
import { FeedToolbar } from './components/FeedToolbar';
import type { FeedViewMode } from './feedColumnsState';
import { useFeedPageController } from './useFeedPageController';
import { useFeedViewModeState } from './useFeedViewModeState';

type FeedPageProps = {
    embedded?: boolean;
};

function FeedViewModeToggle({
    onValueChange,
    value
}: {
    onValueChange(value: FeedViewMode): void;
    value: FeedViewMode;
}) {
    const { t } = useTranslation();
    const tableLabel = t('view.feed.modes.table');
    const columnsLabel = t('view.feed.modes.columns');

    return (
        <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={value}
            onValueChange={(nextValue) => {
                if (nextValue) {
                    onValueChange(nextValue as FeedViewMode);
                }
            }}
        >
            <Tooltip>
                <TooltipTrigger asChild>
                    <ToggleGroupItem value="table" aria-label={tableLabel}>
                        <TableIcon data-icon="icon" />
                    </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>{tableLabel}</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <ToggleGroupItem value="columns" aria-label={columnsLabel}>
                        <Columns3Icon data-icon="icon" />
                    </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>{columnsLabel}</TooltipContent>
            </Tooltip>
        </ToggleGroup>
    );
}

export function FeedPage({ embedded = false }: FeedPageProps = {}) {
    const {
        columns,
        density,
        ready,
        setColumns,
        setDensity,
        setViewMode,
        viewMode
    } = useFeedViewModeState();
    const modeToggle = (
        <FeedViewModeToggle value={viewMode} onValueChange={setViewMode} />
    );

    if (!ready) {
        return (
            <PageScaffold
                embedded={embedded}
                className={embedded ? '' : 'feed'}
            >
                <PageBody className="items-center justify-center">
                    <Spinner />
                </PageBody>
            </PageScaffold>
        );
    }

    return (
        <PageScaffold embedded={embedded} className={embedded ? '' : 'feed'}>
            {viewMode === 'columns' ? (
                <PageBody className="gap-2">
                    <FeedColumnsMode
                        columns={columns}
                        density={density}
                        modeToggle={modeToggle}
                        onColumnsChange={setColumns}
                        onDensityChange={setDensity}
                    />
                </PageBody>
            ) : (
                <FeedTableMode modeToggle={modeToggle} />
            )}
        </PageScaffold>
    );
}

function FeedTableMode({ modeToggle }: { modeToggle: ReactNode }) {
    const {
        columns,
        filters,
        friendActions,
        isFavoritesLoaded,
        loadStatus,
        previousInstancesDialog,
        resolvePageSize,
        rows,
        table,
        tableModel
    } = useFeedPageController();

    return (
        <>
            <FeedToolbar
                filterModel={{
                    activeFilterCount: filters.activeFilterCount,
                    activeFilters: filters.activeFilters,
                    dateDraftFrom: filters.dateDraftFrom,
                    dateDraftRange: filters.dateDraftRange,
                    dateDraftTo: filters.dateDraftTo,
                    dateFilterOpen: filters.dateFilterOpen,
                    dateFrom: filters.dateFrom,
                    dateTo: filters.dateTo,
                    favoritesOnly: filters.favoritesOnly,
                    feedFilterTypes: filters.feedFilterTypes,
                    searchDraft: filters.searchDraft,
                    todayDate: filters.todayDate
                }}
                filterCommands={{
                    onApplyDateFilter: filters.applyDateFilter,
                    onClearDateFilter: filters.clearDateFilter,
                    onClearFeedFilters: () => filters.setFeedFilters([]),
                    onClearSearch: filters.clearSearch,
                    onDateFilterOpenChange: filters.setDateFilterOpen,
                    onDateRangeSelect: filters.onDateRangeSelect,
                    onSearchBlur: () => filters.commitSearch(),
                    onSearchDraftChange: filters.setSearchDraft,
                    onSearchEnter: filters.commitSearch,
                    onToggleFavoritesOnly: () =>
                        filters.setFavoritesOnly((current) => !current),
                    onToggleFeedFilter: filters.toggleFeedFilter
                }}
                modeToggle={modeToggle}
                table={table}
            />
            <PageBody>
                <FeedTableShell
                    columns={columns}
                    favoritesOnly={filters.favoritesOnly}
                    isFavoritesLoaded={isFavoritesLoaded}
                    loadStatus={loadStatus}
                    loadingPreviousInstancesKey={
                        previousInstancesDialog.loadingKey
                    }
                    onNewInstance={friendActions.openFeedNewInstance}
                    onOpenPreviousInstances={
                        previousInstancesDialog.openPreviousInstancesForLocation
                    }
                    onPaginationChange={tableModel.setPagination}
                    pageSizes={tableModel.pageSizes}
                    pagination={tableModel.pagination}
                    resolvePageSize={resolvePageSize}
                    rows={rows}
                    table={table}
                />
            </PageBody>
            <PreviousInstancesTableDialog
                open={previousInstancesDialog.open}
                onOpenChange={previousInstancesDialog.setOpen}
                title={previousInstancesDialog.title}
                instances={previousInstancesDialog.rows}
                onRowsChange={previousInstancesDialog.setRows}
            />
        </>
    );
}
