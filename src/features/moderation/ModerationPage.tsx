import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import {
    LoadingState,
    PageBody,
    PageScaffold,
    PageToolbar
} from '@/components/layout/PageScaffold';

import { ModerationPageTable } from './components/ModerationPageTable';
import { ModerationPageToolbar } from './components/ModerationPageToolbar';
import { ModerationEmptyState } from './components/ModerationViewParts';
import { useModerationPageController } from './useModerationPageController';

export function ModerationPage({
    embedded = false
}: { embedded?: boolean } = {}) {
    const { t } = useTranslation();
    const location = useLocation();
    const { filteredRows, filters, rowsState, table, tableState } =
        useModerationPageController({
            refreshKey: location.key || location.pathname
        });
    const isLoading =
        rowsState.loadStatus === 'running' && rowsState.rows.length === 0;
    const isError =
        rowsState.loadStatus === 'error' && rowsState.rows.length === 0;
    const hasRows = filteredRows.length > 0;

    return (
        <PageScaffold embedded={embedded}>
            <PageToolbar>
                <ModerationPageToolbar
                    selectedTypes={filters.selectedTypes}
                    onSelectedTypesChange={filters.setSelectedTypes}
                    searchQuery={filters.searchQuery}
                    onSearchQueryChange={filters.setSearchQuery}
                    detail={rowsState.detail}
                    currentUserId={rowsState.currentUserId}
                    loadStatus={rowsState.loadStatus}
                    onRefresh={rowsState.refresh}
                    table={table}
                />
            </PageToolbar>

            <PageBody>
                {isLoading ? (
                    <LoadingState
                        label={t(
                            'view.moderation.loading.loading_the_moderation_snapshot'
                        )}
                    />
                ) : isError ? (
                    <ModerationEmptyState
                        title={t(
                            'view.moderation.error.moderation_snapshot_failed_to_load'
                        )}
                        description={
                            rowsState.detail ||
                            'The moderation request did not complete.'
                        }
                    />
                ) : hasRows ? (
                    <ModerationPageTable
                        table={table}
                        filteredRowsLength={filteredRows.length}
                        pagination={tableState.pagination}
                        pageSizes={tableState.pageSizes}
                        onPageSizeChange={tableState.handlePageSizeChange}
                    />
                ) : (
                    <ModerationEmptyState
                        title={t(
                            'view.moderation.empty.no_moderation_rows_match_the_current_filters'
                        )}
                        description={t(
                            'view.moderation.label.broaden_the_type_filters_or_search_query_to_see_more_results'
                        )}
                    />
                )}
            </PageBody>
        </PageScaffold>
    );
}
