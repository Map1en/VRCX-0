import { ChevronDownIcon, StarIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DateRangeFilter } from '@/components/date-range-filter/DateRangeFilter';
import { FeedPersistenceDisabledIndicator } from '@/components/feed/FeedPersistenceDisabledIndicator';
import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import {
    ToolbarActions,
    ToolbarFilterChips,
    ToolbarViews
} from '@/components/layout/ToolbarControls';
import type { FeedFilterType } from '@/repositories/feedRepository';
import { usePreferencesStore } from '@/state/preferencesStore';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

import type { FeedViewMode } from '../feedColumnsState';
import { FeedSearchBox } from './FeedSearchBox';
import { FeedViewModeToggle } from './FeedViewModeToggle';

type FeedToolbarProps = {
    onViewModeChange(value: FeedViewMode): void;
    filterCommands: {
        onDateRangeChange(from: string, to: string): void;
        onClearFeedFilters(): void;
        onClearSearch(): void;
        onCommitSearch(): void;
        onScopeChange(userIds: readonly string[]): void;
        onSearchDraftChange(value: string): void;
        onFeedFiltersChange(filters: FeedFilterType[]): void;
        onToggleFavoritesOnly(): void;
        onToggleFeedFilter(filter: FeedFilterType): void;
    };
    filterModel: {
        activeFilters: FeedFilterType[];
        dateFrom: string;
        dateTo: string;
        favoritesOnly: boolean;
        feedFilterTypes: readonly FeedFilterType[];
        scopedUserIds: string[];
        searchDraft: string;
    };
    isSearching: boolean;
};

function FeedTypeFilterMenu({
    activeFilters,
    favoritesOnly,
    favoritesOnlyDisabled,
    feedFilterTypes,
    onClearFeedFilters,
    onToggleFavoritesOnly,
    onToggleFeedFilter
}: {
    activeFilters: FeedFilterType[];
    favoritesOnly: boolean;
    favoritesOnlyDisabled: boolean;
    feedFilterTypes: readonly FeedFilterType[];
    onClearFeedFilters(): void;
    onToggleFavoritesOnly(): void;
    onToggleFeedFilter(filter: FeedFilterType): void;
}) {
    const { t } = useTranslation();
    const firstFilter = feedFilterTypes.find((filter) =>
        activeFilters.includes(filter)
    );
    const firstLabel = firstFilter
        ? t(`view.feed.filters.${firstFilter}`)
        : t('view.feed.toolbar.all_types');
    const summary =
        activeFilters.length > 1
            ? t('view.feed.toolbar.more_types', {
                  type: firstLabel,
                  count: activeFilters.length - 1
              })
            : firstLabel;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        variant={
                            activeFilters.length || favoritesOnly
                                ? 'secondary'
                                : 'outline'
                        }
                    />
                }
                aria-label={t('view.feed.toolbar.type_summary', {
                    types: summary
                })}
            >
                {t('view.feed.columns.types')}
                <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
                <DropdownMenuGroup>
                    <DropdownMenuCheckboxItem
                        checked={favoritesOnly}
                        disabled={favoritesOnlyDisabled}
                        closeOnClick={false}
                        onCheckedChange={onToggleFavoritesOnly}
                    >
                        {t('view.feed.toolbar.grouped_friends_only')}
                    </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    <DropdownMenuLabel>
                        {t('view.feed.columns.types')}
                    </DropdownMenuLabel>
                    <DropdownMenuCheckboxItem
                        checked={!activeFilters.length}
                        closeOnClick={false}
                        onCheckedChange={onClearFeedFilters}
                    >
                        {t('view.feed.toolbar.all_types')}
                    </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    {feedFilterTypes.map((filter) => (
                        <DropdownMenuCheckboxItem
                            key={filter}
                            checked={activeFilters.includes(filter)}
                            closeOnClick={false}
                            onCheckedChange={() => onToggleFeedFilter(filter)}
                        >
                            {t(`view.feed.filters.${filter}`)}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export const FeedToolbar = memo(function FeedToolbar({
    onViewModeChange,
    filterCommands,
    filterModel,
    isSearching
}: FeedToolbarProps) {
    const { t } = useTranslation();
    const feedPersistenceDisabled = usePreferencesStore(
        (state) => state.feedPersistenceDisabled
    );
    const {
        activeFilters,
        dateFrom,
        dateTo,
        favoritesOnly,
        feedFilterTypes,
        scopedUserIds,
        searchDraft
    } = filterModel;
    const {
        onDateRangeChange,
        onClearFeedFilters,
        onClearSearch,
        onCommitSearch,
        onScopeChange,
        onSearchDraftChange,
        onFeedFiltersChange,
        onToggleFavoritesOnly,
        onToggleFeedFilter
    } = filterCommands;

    return (
        <PageToolbar className="@container/feed-toolbar">
            <PageToolbarRow>
                <ToolbarViews className="min-w-0 flex-wrap">
                    <FeedViewModeToggle
                        value="table"
                        onValueChange={onViewModeChange}
                    />
                    <ToolbarFilterChips
                        value={activeFilters}
                        onValueChange={onFeedFiltersChange}
                        leading={{
                            label: t('view.feed.toolbar.grouped_friends_only'),
                            icon: StarIcon,
                            pressed: favoritesOnly,
                            disabled: scopedUserIds.length > 0,
                            onPressedChange: onToggleFavoritesOnly
                        }}
                        options={feedFilterTypes.map((filter) => ({
                            value: filter,
                            label: t(`view.feed.filters.${filter}`)
                        }))}
                    />
                    <FeedTypeFilterMenu
                        activeFilters={activeFilters}
                        favoritesOnly={favoritesOnly}
                        favoritesOnlyDisabled={scopedUserIds.length > 0}
                        feedFilterTypes={feedFilterTypes}
                        onClearFeedFilters={onClearFeedFilters}
                        onToggleFavoritesOnly={onToggleFavoritesOnly}
                        onToggleFeedFilter={onToggleFeedFilter}
                    />
                </ToolbarViews>
                <FeedSearchBox
                    isSearching={isSearching}
                    scopedUserIds={scopedUserIds}
                    searchDraft={searchDraft}
                    onClearSearch={onClearSearch}
                    onCommitSearch={onCommitSearch}
                    onScopeChange={onScopeChange}
                    onSearchDraftChange={onSearchDraftChange}
                    dateFilter={
                        <DateRangeFilter
                            label={t('view.feed.date_range')}
                            onChange={onDateRangeChange}
                            dateFrom={dateFrom}
                            dateTo={dateTo}
                        />
                    }
                />
                <ToolbarActions>
                    {feedPersistenceDisabled ? (
                        <FeedPersistenceDisabledIndicator />
                    ) : null}
                </ToolbarActions>
            </PageToolbarRow>
        </PageToolbar>
    );
});
