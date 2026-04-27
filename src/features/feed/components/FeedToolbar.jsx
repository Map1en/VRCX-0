import { CalendarRangeIcon, StarIcon, XIcon } from 'lucide-react';

import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu.jsx';
import {
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold.jsx';
import { Button } from '@/ui/shadcn/button';
import { Calendar } from '@/ui/shadcn/calendar';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

function FeedDateFilterControl({
    activeFilterCount,
    dateFrom,
    dateDraftFrom,
    dateDraftRange,
    dateDraftTo,
    dateTo,
    dateFilterOpen,
    onApplyDateFilter,
    onClearDateFilter,
    onDateFilterOpenChange,
    onDateRangeSelect,
    t,
    todayDate
}) {
    const dateRangeLabel =
        dateFrom || dateTo
            ? [dateFrom || '...', dateTo || '...'].join(' - ')
            : t('view.feed.date_range');

    return (
        <Popover open={dateFilterOpen} onOpenChange={onDateFilterOpenChange}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                        <InputGroupButton
                            type="button"
                            size="icon-xs"
                            variant={activeFilterCount ? 'secondary' : 'ghost'}
                            aria-label={dateRangeLabel}
                            onMouseDown={(event) => event.preventDefault()}
                        >
                            <CalendarRangeIcon data-icon="icon" />
                        </InputGroupButton>
                    </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>{dateRangeLabel}</TooltipContent>
            </Tooltip>
            <PopoverContent className="w-auto" align="end">
                <Calendar
                    mode="range"
                    numberOfMonths={2}
                    selected={dateDraftRange}
                    disabled={{ after: todayDate }}
                    onSelect={onDateRangeSelect}
                />
                <div className="flex items-center justify-between gap-4 px-3 pb-3">
                    <div className="text-muted-foreground min-w-0 text-xs">
                        {[dateDraftFrom || '...', dateDraftTo || '...'].join(
                            ' - '
                        )}
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
    );
}

function FeedFilterButtons({
    activeFilters,
    feedFilterTypes,
    onClearFeedFilters,
    onToggleFeedFilter,
    t
}) {
    return (
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto">
            <Button
                type="button"
                variant={activeFilters.length === 0 ? 'default' : 'outline'}
                size="sm"
                onClick={onClearFeedFilters}
            >
                {t('view.search.avatar.all')}
            </Button>
            {feedFilterTypes.map((filter) => {
                const active = activeFilters.includes(filter);
                return (
                    <Button
                        key={filter}
                        type="button"
                        variant={active ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => onToggleFeedFilter(filter)}
                    >
                        {t(`view.feed.filters.${filter}`)}
                    </Button>
                );
            })}
        </div>
    );
}

function FeedSearchInput({
    activeFilterCount,
    dateFrom,
    dateDraftFrom,
    dateDraftRange,
    dateDraftTo,
    dateTo,
    dateFilterOpen,
    onApplyDateFilter,
    onClearSearch,
    onClearDateFilter,
    onDateFilterOpenChange,
    onDateRangeSelect,
    onSearchBlur,
    onSearchDraftChange,
    onSearchEnter,
    searchDraft,
    t,
    todayDate
}) {
    return (
        <InputGroup className="h-9 min-w-0 flex-1 basis-0">
            <InputGroupInput
                value={searchDraft}
                onChange={(event) => onSearchDraftChange(event.target.value)}
                onBlur={onSearchBlur}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        onSearchEnter(event.currentTarget.value);
                    }
                }}
                placeholder={t('view.feed.search_placeholder')}
            />
            <InputGroupAddon align="inline-end" className="gap-1">
                {searchDraft ? (
                    <InputGroupButton
                        type="button"
                        size="icon-xs"
                        aria-label="Clear search"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={onClearSearch}
                    >
                        <XIcon data-icon="icon" />
                    </InputGroupButton>
                ) : null}
                <FeedDateFilterControl
                    activeFilterCount={activeFilterCount}
                    dateFrom={dateFrom}
                    dateDraftFrom={dateDraftFrom}
                    dateDraftRange={dateDraftRange}
                    dateDraftTo={dateDraftTo}
                    dateTo={dateTo}
                    dateFilterOpen={dateFilterOpen}
                    onApplyDateFilter={onApplyDateFilter}
                    onClearDateFilter={onClearDateFilter}
                    onDateFilterOpenChange={onDateFilterOpenChange}
                    onDateRangeSelect={onDateRangeSelect}
                    t={t}
                    todayDate={todayDate}
                />
            </InputGroupAddon>
        </InputGroup>
    );
}

export function FeedToolbar({
    activeFilterCount,
    activeFilters,
    dateFrom,
    dateDraftFrom,
    dateDraftRange,
    dateDraftTo,
    dateTo,
    dateFilterOpen,
    favoritesOnly,
    feedFilterTypes,
    onApplyDateFilter,
    onClearDateFilter,
    onClearFeedFilters,
    onClearSearch,
    onDateFilterOpenChange,
    onDateRangeSelect,
    onSearchBlur,
    onSearchDraftChange,
    onSearchEnter,
    onToggleFavoritesOnly,
    onToggleFeedFilter,
    searchDraft,
    t,
    table,
    todayDate
}) {
    return (
        <PageToolbar>
            <PageToolbarRow>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant={favoritesOnly ? 'default' : 'outline'}
                                size="icon-sm"
                                aria-label="Filter favorites only"
                                onClick={onToggleFavoritesOnly}
                            >
                                <StarIcon data-icon="icon" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            {t('view.feed.favorites_only_tooltip')}
                        </TooltipContent>
                    </Tooltip>
                </div>

                <FeedFilterButtons
                    activeFilters={activeFilters}
                    feedFilterTypes={feedFilterTypes}
                    onClearFeedFilters={onClearFeedFilters}
                    onToggleFeedFilter={onToggleFeedFilter}
                    t={t}
                />

                <FeedSearchInput
                    activeFilterCount={activeFilterCount}
                    dateFrom={dateFrom}
                    dateDraftFrom={dateDraftFrom}
                    dateDraftRange={dateDraftRange}
                    dateDraftTo={dateDraftTo}
                    dateTo={dateTo}
                    dateFilterOpen={dateFilterOpen}
                    onApplyDateFilter={onApplyDateFilter}
                    onClearSearch={onClearSearch}
                    onClearDateFilter={onClearDateFilter}
                    onDateFilterOpenChange={onDateFilterOpenChange}
                    onDateRangeSelect={onDateRangeSelect}
                    onSearchBlur={onSearchBlur}
                    onSearchDraftChange={onSearchDraftChange}
                    onSearchEnter={onSearchEnter}
                    searchDraft={searchDraft}
                    t={t}
                    todayDate={todayDate}
                />

                <div className="flex items-center gap-2">
                    <TableColumnVisibilityMenu table={table} />
                </div>
            </PageToolbarRow>
        </PageToolbar>
    );
}
