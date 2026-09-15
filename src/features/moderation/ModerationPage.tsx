import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import {
    LoadingState,
    PageBody,
    PageScaffold
} from '@/components/layout/PageScaffold';

import { ModerationPageToolbar } from './components/ModerationPageToolbar';
import { ModerationEmptyState } from './components/ModerationViewParts';
import { ModerationVirtualList } from './components/ModerationVirtualList';
import { useModerationPageController } from './useModerationPageController';

export function ModerationPage({
    embedded = false
}: { embedded?: boolean } = {}) {
    const { t } = useTranslation();
    const location = useLocation();
    const { filters, listResetKey, rowsState, table } =
        useModerationPageController({
            refreshKey: location.key || location.pathname
        });
    const isLoading =
        rowsState.loadStatus === 'running' && rowsState.rows.length === 0;
    const isError =
        rowsState.loadStatus === 'error' && rowsState.rows.length === 0;

    return (
        <PageScaffold embedded={embedded}>
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
                ) : (
                    <ModerationVirtualList
                        table={table}
                        resetKey={listResetKey}
                        emptyState={
                            <ModerationEmptyState
                                title={t(
                                    'view.moderation.empty.no_moderation_rows_match_the_current_filters'
                                )}
                                description={t(
                                    'view.moderation.label.broaden_the_type_filters_or_search_query_to_see_more_results'
                                )}
                            />
                        }
                    />
                )}
            </PageBody>
        </PageScaffold>
    );
}
