import { useTranslation } from 'react-i18next';

import type { AppTable } from '@/components/data-table/appTable';
import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu';
import { DateRangeFilter } from '@/components/date-range-filter/DateRangeFilter';
import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import {
    ToolbarActions,
    ToolbarFilterChips,
    ToolbarRefreshButton,
    ToolbarSearch,
    ToolbarStatus,
    ToolbarViews
} from '@/components/layout/ToolbarControls';

import type { FriendLogRow } from '../friendLogRows';
import { FriendLogTypeFilterDropdown } from './FriendLogViewParts';

export function FriendLogPageToolbar({
    selectedTypes,
    onSelectedTypesChange,
    targetUser,
    onClearTargetUser,
    searchDraft,
    onSearchDraftChange,
    onCommitSearch,
    onClearSearch,
    dateFrom,
    dateTo,
    onDateRangeChange,
    detail,
    currentUserId,
    loadStatus,
    onRefresh,
    table
}: {
    selectedTypes: string[];
    onSelectedTypesChange: (value: string[]) => void;
    targetUser: { id: string; name: string } | null;
    onClearTargetUser(): void;
    searchDraft: string;
    onSearchDraftChange(value: string): void;
    onCommitSearch(): void;
    onClearSearch(): void;
    dateFrom: string;
    dateTo: string;
    onDateRangeChange(from: string, to: string): void;
    detail: string;
    currentUserId: string;
    loadStatus: string;
    onRefresh: () => void;
    table: AppTable<FriendLogRow>;
}) {
    const { t } = useTranslation();

    return (
        <PageToolbar>
            <PageToolbarRow>
                <ToolbarViews>
                    <FriendLogTypeFilterDropdown
                        value={selectedTypes}
                        onChange={onSelectedTypesChange}
                    />
                    {targetUser ? (
                        <ToolbarFilterChips
                            value={[targetUser.id]}
                            options={[
                                { value: targetUser.id, label: targetUser.name }
                            ]}
                            onValueChange={(next) => {
                                if (!next.length) {
                                    onClearTargetUser();
                                }
                            }}
                        />
                    ) : null}
                </ToolbarViews>

                <ToolbarSearch
                    value={searchDraft}
                    onValueChange={onSearchDraftChange}
                    onCommit={onCommitSearch}
                    onClear={onClearSearch}
                    placeholder={t('view.friend_log.search_placeholder')}
                    trailing={
                        <DateRangeFilter
                            dateFrom={dateFrom}
                            dateTo={dateTo}
                            onChange={onDateRangeChange}
                            label={t('view.friend_log.date_range')}
                        />
                    }
                />

                <ToolbarActions>
                    <ToolbarRefreshButton
                        onRefresh={onRefresh}
                        loading={loadStatus === 'running'}
                        disabled={!currentUserId}
                    />
                    <TableColumnVisibilityMenu table={table} />
                </ToolbarActions>
            </PageToolbarRow>

            {detail ? <ToolbarStatus>{detail}</ToolbarStatus> : null}
        </PageToolbar>
    );
}
