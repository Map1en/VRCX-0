import { PreviousInstancesTableDialog } from '@/components/dialogs/PreviousInstancesTableDialog.jsx';
import {
    PageBody,
    PageScaffold
} from '@/components/layout/PageScaffold.jsx';

import { FeedTableShell } from './FeedTableShell.jsx';
import { FeedToolbar } from './FeedToolbar.jsx';

export function FeedPageView({
    activeFilterCount,
    activeFilters,
    currentEndpoint,
    dateDraftFrom,
    dateDraftRange,
    dateDraftTo,
    dateFilterOpen,
    embedded,
    feedFilterTypes,
    favoritesOnly,
    isFavoritesLoaded,
    loadStatus,
    loadingPreviousInstancesKey,
    onApplyDateFilter,
    onClearDateFilter,
    onClearFeedFilters,
    onClearSearch,
    onDateFilterOpenChange,
    onDateRangeSelect,
    onNewInstance,
    onOpenPreviousInstances,
    onPageSizeChange,
    onPreviousInstancesOpenChange,
    onPreviousInstancesRowsChange,
    onPreviewImage,
    onSearchBlur,
    onSearchDraftChange,
    onSearchEnter,
    onToggleFavoritesOnly,
    onToggleFeedFilter,
    pageSizes,
    pagination,
    previousInstancesOpen,
    previousInstancesRows,
    previousInstancesTitle,
    resolvePageSize,
    rows,
    searchDraft,
    t,
    table,
    columns,
    todayDate
}) {
    return (
        <PageScaffold embedded={embedded} className={embedded ? '' : 'feed'}>
            <FeedToolbar
                activeFilterCount={activeFilterCount}
                activeFilters={activeFilters}
                dateDraftFrom={dateDraftFrom}
                dateDraftRange={dateDraftRange}
                dateDraftTo={dateDraftTo}
                dateFilterOpen={dateFilterOpen}
                favoritesOnly={favoritesOnly}
                feedFilterTypes={feedFilterTypes}
                onApplyDateFilter={onApplyDateFilter}
                onClearDateFilter={onClearDateFilter}
                onClearFeedFilters={onClearFeedFilters}
                onClearSearch={onClearSearch}
                onDateFilterOpenChange={onDateFilterOpenChange}
                onDateRangeSelect={onDateRangeSelect}
                onSearchBlur={onSearchBlur}
                onSearchDraftChange={onSearchDraftChange}
                onSearchEnter={onSearchEnter}
                onToggleFavoritesOnly={onToggleFavoritesOnly}
                onToggleFeedFilter={onToggleFeedFilter}
                searchDraft={searchDraft}
                t={t}
                table={table}
                todayDate={todayDate}
            />
            <PageBody>
                <FeedTableShell
                    table={table}
                    columns={columns}
                    rows={rows}
                    loadStatus={loadStatus}
                    favoritesOnly={favoritesOnly}
                    isFavoritesLoaded={isFavoritesLoaded}
                    loadingPreviousInstancesKey={loadingPreviousInstancesKey}
                    currentEndpoint={currentEndpoint}
                    onOpenPreviousInstances={onOpenPreviousInstances}
                    onNewInstance={onNewInstance}
                    onPreviewImage={onPreviewImage}
                    pagination={pagination}
                    pageSizes={pageSizes}
                    resolvePageSize={resolvePageSize}
                    setPagination={onPageSizeChange}
                    t={t}
                />
            </PageBody>
            <PreviousInstancesTableDialog
                open={previousInstancesOpen}
                onOpenChange={onPreviousInstancesOpenChange}
                title={previousInstancesTitle}
                instances={previousInstancesRows}
                onRowsChange={onPreviousInstancesRowsChange}
            />
        </PageScaffold>
    );
}
