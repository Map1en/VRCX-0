import {
    CalendarRangeIcon,
    ChevronDownIcon,
    StarIcon,
    XIcon
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { FeedDateRange } from '@/components/feed/feedTypes';
import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import {
    ToolbarActions,
    ToolbarFilterChips,
    ToolbarViews
} from '@/components/layout/ToolbarControls';
import { cn } from '@/lib/utils';
import type { FeedFilterType } from '@/repositories/feedRepository';
import { usePreferencesStore } from '@/state/preferencesStore';
import { Button } from '@/ui/shadcn/button';
import { Calendar } from '@/ui/shadcn/calendar';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { InputGroupButton } from '@/ui/shadcn/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Toggle } from '@/ui/shadcn/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import type { FeedViewMode } from '../feedColumnsState';
import { FeedPersistenceDisabledIndicator } from './FeedPersistenceDisabledIndicator';
import { FeedSearchBox } from './FeedSearchBox';
import { FeedViewModeToggle } from './FeedViewModeToggle';

type FeedToolbarProps = {
    onViewModeChange(value: FeedViewMode): void;
    filterCommands: {
        onApplyDateFilter(): void;
        onClearDateFilter(): void;
        onClearFeedFilters(): void;
        onClearSearch(): void;
        onCommitSearch(): void;
        onDateFilterOpenChange(open: boolean): void;
        onDateRangeSelect(range?: FeedDateRange): void;
        onScopeChange(userIds: readonly string[]): void;
        onSearchDraftChange(value: string): void;
        onFeedFiltersChange(filters: FeedFilterType[]): void;
        onToggleFavoritesOnly(): void;
        onToggleFeedFilter(filter: FeedFilterType): void;
    };
    filterModel: {
        activeFilters: FeedFilterType[];
        dateDraftFrom: string;
        dateDraftRange?: FeedDateRange;
        dateDraftTo: string;
        dateFilterOpen: boolean;
        dateFrom: string;
        dateTo: string;
        favoritesOnly: boolean;
        feedFilterTypes: readonly FeedFilterType[];
        scopedUserIds: string[];
        searchDraft: string;
        todayDate: Date;
    };
    isSearching: boolean;
};

function FeedTypeFilterMenu({
    activeFilters,
    feedFilterTypes,
    onClearFeedFilters,
    onToggleFeedFilter
}: {
    activeFilters: FeedFilterType[];
    feedFilterTypes: readonly FeedFilterType[];
    onClearFeedFilters(): void;
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
                        variant={activeFilters.length ? 'secondary' : 'outline'}
                    />
                }
                aria-label={t('view.feed.toolbar.type_summary', {
                    types: summary
                })}
            >
                {summary}
                <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
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

function FeedDateRangeFilter({
    dateDraftFrom,
    dateDraftRange,
    dateDraftTo,
    dateFilterOpen,
    dateFrom,
    dateTo,
    onApplyDateFilter,
    onClearDateFilter,
    onDateFilterOpenChange,
    onDateRangeSelect,
    todayDate
}: {
    dateDraftFrom: string;
    dateDraftRange?: FeedDateRange;
    dateDraftTo: string;
    dateFilterOpen: boolean;
    dateFrom: string;
    dateTo: string;
    onApplyDateFilter(): void;
    onClearDateFilter(): void;
    onDateFilterOpenChange(open: boolean): void;
    onDateRangeSelect(range?: FeedDateRange): void;
    todayDate: Date;
}) {
    const { t } = useTranslation();
    const hasRange = Boolean(dateFrom || dateTo);
    const label = hasRange
        ? [dateFrom || '...', dateTo || '...'].join(' - ')
        : t('view.feed.date_range');

    return (
        <div
            role="group"
            aria-label={t('view.feed.date_range')}
            className="flex shrink-0 items-center gap-0.5"
        >
            <Popover
                open={dateFilterOpen}
                onOpenChange={onDateFilterOpenChange}
            >
                <PopoverTrigger
                    render={
                        <InputGroupButton
                            variant={hasRange ? 'secondary' : 'ghost'}
                            size={hasRange ? 'xs' : 'icon-xs'}
                        />
                    }
                    aria-label={
                        hasRange
                            ? `${t('view.feed.date_range')}: ${label}`
                            : label
                    }
                    title={label}
                >
                    <CalendarRangeIcon data-icon="inline-start" />
                    {hasRange ? (
                        <span className="tabular-nums">{label}</span>
                    ) : null}
                </PopoverTrigger>
                <PopoverContent
                    className="w-auto"
                    align="end"
                    aria-label={t('view.feed.date_range')}
                >
                    <Calendar
                        mode="range"
                        numberOfMonths={2}
                        defaultMonth={dateDraftRange?.from ?? todayDate}
                        selected={dateDraftRange}
                        disabled={{ after: todayDate }}
                        onSelect={onDateRangeSelect}
                    />
                    <div className="flex items-center justify-between gap-4 px-3 pb-3">
                        <div className="text-muted-foreground min-w-0 text-xs">
                            {[
                                dateDraftFrom || '...',
                                dateDraftTo || '...'
                            ].join(' - ')}
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={onClearDateFilter}
                            >
                                {t('common.actions.clear')}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                onClick={onApplyDateFilter}
                            >
                                {t('common.actions.confirm')}
                            </Button>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
            {hasRange ? (
                <InputGroupButton
                    size="icon-xs"
                    aria-label={t('common.actions.clear')}
                    title={t('common.actions.clear')}
                    onClick={onClearDateFilter}
                >
                    <XIcon />
                </InputGroupButton>
            ) : null}
        </div>
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
        dateDraftFrom,
        dateDraftRange,
        dateDraftTo,
        dateFilterOpen,
        dateFrom,
        dateTo,
        favoritesOnly,
        feedFilterTypes,
        scopedUserIds,
        searchDraft,
        todayDate
    } = filterModel;
    const {
        onApplyDateFilter,
        onClearDateFilter,
        onClearFeedFilters,
        onClearSearch,
        onCommitSearch,
        onDateFilterOpenChange,
        onDateRangeSelect,
        onScopeChange,
        onSearchDraftChange,
        onFeedFiltersChange,
        onToggleFavoritesOnly,
        onToggleFeedFilter
    } = filterCommands;

    return (
        <PageToolbar className="@container/feed-toolbar">
            <PageToolbarRow>
                <ToolbarViews className="min-w-0 flex-initial flex-wrap">
                    <FeedViewModeToggle
                        value="table"
                        onValueChange={onViewModeChange}
                    />
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Toggle
                                    variant="outline"
                                    className="size-8 shrink-0 p-0"
                                    aria-label={t(
                                        'view.feed.toolbar.grouped_friends_only'
                                    )}
                                    pressed={favoritesOnly}
                                    disabled={scopedUserIds.length > 0}
                                    onPressedChange={onToggleFavoritesOnly}
                                >
                                    <StarIcon
                                        data-icon="icon"
                                        fill={
                                            favoritesOnly
                                                ? 'currentColor'
                                                : 'none'
                                        }
                                    />
                                </Toggle>
                            }
                        />
                        <TooltipContent>
                            {t('view.feed.toolbar.grouped_friends_only')}
                        </TooltipContent>
                    </Tooltip>
                    <div className="@min-4xl/feed-toolbar:hidden">
                        <FeedTypeFilterMenu
                            activeFilters={activeFilters}
                            feedFilterTypes={feedFilterTypes}
                            onClearFeedFilters={onClearFeedFilters}
                            onToggleFeedFilter={onToggleFeedFilter}
                        />
                    </div>
                    <div className="hidden max-w-full min-w-0 @min-4xl/feed-toolbar:block">
                        <ToolbarFilterChips
                            value={activeFilters}
                            onValueChange={onFeedFiltersChange}
                            allLabel={t('view.feed.toolbar.all_types')}
                            options={feedFilterTypes.map((filter) => ({
                                value: filter,
                                label: t(`view.feed.filters.${filter}`)
                            }))}
                        />
                    </div>
                </ToolbarViews>
                <div
                    className={cn(
                        'ml-auto flex min-w-0 grow items-center gap-2',
                        dateFrom || dateTo
                            ? 'max-w-96 basis-96'
                            : 'max-w-80 basis-64'
                    )}
                >
                    <FeedSearchBox
                        isSearching={isSearching}
                        scopedUserIds={scopedUserIds}
                        searchDraft={searchDraft}
                        onClearSearch={onClearSearch}
                        onCommitSearch={onCommitSearch}
                        onScopeChange={onScopeChange}
                        onSearchDraftChange={onSearchDraftChange}
                        dateFilter={
                            <FeedDateRangeFilter
                                dateDraftFrom={dateDraftFrom}
                                dateDraftRange={dateDraftRange}
                                dateDraftTo={dateDraftTo}
                                dateFilterOpen={dateFilterOpen}
                                dateFrom={dateFrom}
                                dateTo={dateTo}
                                onApplyDateFilter={onApplyDateFilter}
                                onClearDateFilter={onClearDateFilter}
                                onDateFilterOpenChange={onDateFilterOpenChange}
                                onDateRangeSelect={onDateRangeSelect}
                                todayDate={todayDate}
                            />
                        }
                    />
                    <ToolbarActions>
                        {feedPersistenceDisabled ? (
                            <FeedPersistenceDisabledIndicator />
                        ) : null}
                    </ToolbarActions>
                </div>
            </PageToolbarRow>
        </PageToolbar>
    );
});
