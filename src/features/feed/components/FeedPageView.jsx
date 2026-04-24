import { PreviousInstancesTableDialog } from '@/components/dialogs/PreviousInstancesTableDialog.jsx';
import {
    PageBody,
    PageScaffold
} from '@/components/layout/PageScaffold.jsx';

import { FeedTableShell } from './FeedTableShell.jsx';
import { FeedToolbar } from './FeedToolbar.jsx';

export function FeedPageView({
    embedded,
    t,
    toolbarState,
    toolbarActions,
    tableState,
    tableActions,
    previousInstancesDialog
}) {
    return (
        <PageScaffold embedded={embedded} className={embedded ? '' : 'feed'}>
            <FeedToolbar
                activeFilterCount={toolbarState.activeFilterCount}
                activeFilters={toolbarState.activeFilters}
                dateDraftFrom={toolbarState.dateDraftFrom}
                dateDraftRange={toolbarState.dateDraftRange}
                dateDraftTo={toolbarState.dateDraftTo}
                dateFilterOpen={toolbarState.dateFilterOpen}
                favoritesOnly={toolbarState.favoritesOnly}
                feedFilterTypes={toolbarState.feedFilterTypes}
                onApplyDateFilter={toolbarActions.onApplyDateFilter}
                onClearDateFilter={toolbarActions.onClearDateFilter}
                onClearFeedFilters={toolbarActions.onClearFeedFilters}
                onClearSearch={toolbarActions.onClearSearch}
                onDateFilterOpenChange={toolbarActions.onDateFilterOpenChange}
                onDateRangeSelect={toolbarActions.onDateRangeSelect}
                onSearchBlur={toolbarActions.onSearchBlur}
                onSearchDraftChange={toolbarActions.onSearchDraftChange}
                onSearchEnter={toolbarActions.onSearchEnter}
                onToggleFavoritesOnly={toolbarActions.onToggleFavoritesOnly}
                onToggleFeedFilter={toolbarActions.onToggleFeedFilter}
                searchDraft={toolbarState.searchDraft}
                t={t}
                table={toolbarState.table}
                todayDate={toolbarState.todayDate}
            />
            <PageBody>
                <FeedTableShell
                    table={tableState.table}
                    columns={tableState.columns}
                    rows={tableState.rows}
                    loadStatus={tableState.loadStatus}
                    favoritesOnly={tableState.favoritesOnly}
                    isFavoritesLoaded={tableState.isFavoritesLoaded}
                    loadingPreviousInstancesKey={
                        tableState.loadingPreviousInstancesKey
                    }
                    currentEndpoint={tableState.currentEndpoint}
                    onOpenPreviousInstances={
                        tableActions.onOpenPreviousInstances
                    }
                    onNewInstance={tableActions.onNewInstance}
                    onPreviewImage={tableActions.onPreviewImage}
                    pagination={tableState.pagination}
                    pageSizes={tableState.pageSizes}
                    resolvePageSize={tableState.resolvePageSize}
                    setPagination={tableActions.onPageSizeChange}
                    t={t}
                />
            </PageBody>
            <PreviousInstancesTableDialog
                open={previousInstancesDialog.open}
                onOpenChange={previousInstancesDialog.onOpenChange}
                title={previousInstancesDialog.title}
                instances={previousInstancesDialog.rows}
                onRowsChange={previousInstancesDialog.onRowsChange}
            />
        </PageScaffold>
    );
}
