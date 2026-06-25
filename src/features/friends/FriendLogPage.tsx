import { useTranslation } from 'react-i18next';

import {
    LoadingState,
    PageBody,
    PageScaffold,
    PageToolbar
} from '@/components/layout/PageScaffold';

import { FriendLogPageTable } from './components/FriendLogPageTable';
import { FriendLogPageToolbar } from './components/FriendLogPageToolbar';
import { FriendLogEmptyState } from './components/FriendLogViewParts';
import { useFriendLogPageController } from './useFriendLogPageController';

export function FriendLogPage({
    embedded = false
}: { embedded?: boolean } = {}) {
    const { t } = useTranslation();
    const { filters, isError, isLoading, rows, table, tableState } =
        useFriendLogPageController();
    const hasRows = rows.orderedRows.length > 0;

    return (
        <PageScaffold embedded={embedded}>
            <PageToolbar>
                <FriendLogPageToolbar
                    selectedTypes={filters.selectedTypes}
                    onSelectedTypesChange={filters.setSelectedTypes}
                    searchQuery={filters.searchQuery}
                    onSearchQueryChange={filters.setSearchQuery}
                    detail={rows.detail}
                    currentUserId={rows.currentUserId}
                    loadStatus={rows.loadStatus}
                    onRefresh={filters.refreshFriendLog}
                    table={table}
                />
            </PageToolbar>

            <PageBody>
                {isLoading ? (
                    <LoadingState
                        label={t(
                            'view.friend_log.loading.loading_the_friend_history_snapshot'
                        )}
                    />
                ) : isError ? (
                    <FriendLogEmptyState
                        title={t(
                            'view.friend_log.error.friend_history_failed_to_load'
                        )}
                        description={
                            rows.detail || 'The history query did not complete.'
                        }
                    />
                ) : hasRows ? (
                    <FriendLogPageTable
                        table={table}
                        orderedRowsLength={rows.orderedRows.length}
                        pagination={tableState.pagination}
                        pageSizes={tableState.pageSizes}
                        onPageSizeChange={tableState.setPageSize}
                    />
                ) : (
                    <FriendLogEmptyState
                        title={t(
                            'view.friend_log.empty.no_friend_history_rows_match_the_current_filters'
                        )}
                        description={t(
                            'view.friend_log.label.broaden_the_type_filters_or_search_query_to_see_more_history'
                        )}
                    />
                )}
            </PageBody>
        </PageScaffold>
    );
}
