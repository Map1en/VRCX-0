import type { Table as ReactTable } from '@tanstack/react-table';
import { CalendarRangeIcon, StarIcon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu';
import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import type { FeedFilterType } from '@/repositories/feedRepository';
import { Button } from '@/ui/shadcn/button';
import { Calendar } from '@/ui/shadcn/calendar';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import type { FeedDateRange, FeedRow } from '../feedTypes';

type FeedDateFilterControlProps = {
    activeFilterCount: number;
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
};

type FeedFilterButtonsProps = {
    activeFilters: FeedFilterType[];
    feedFilterTypes: readonly FeedFilterType[];
    onClearFeedFilters(): void;
    onSelectedTypesChange(filter: FeedFilterType[]): void;
};

type FeedSearchInputProps = FeedDateFilterControlProps & {
    onClearSearch(): void;
    onSearchBlur(): void;
    onSearchDraftChange(value: string): void;
    onSearchEnter(value: string): void;
    searchDraft: string;
};

type FeedToolbarProps = {
    filterCommands: {
        onApplyDateFilter(): void;
        onClearDateFilter(): void;
        onClearFeedFilters(): void;
        onClearSearch(): void;
        onDateFilterOpenChange(open: boolean): void;
        onDateRangeSelect(range?: FeedDateRange): void;
        onSearchBlur(): void;
        onSearchDraftChange(value: string): void;
        onSearchEnter(value: string): void;
        onToggleFavoritesOnly(): void;
        setActiveSelectedTypes(types: FeedFilterType[]): void;
    };
    filterModel: {
        activeFilterCount: number;
        activeFilters: FeedFilterType[];
        dateDraftFrom: string;
        dateDraftRange?: FeedDateRange;
        dateDraftTo: string;
        dateFilterOpen: boolean;
        dateFrom: string;
        dateTo: string;
        favoritesOnly: boolean;
        feedFilterTypes: readonly FeedFilterType[];
        searchDraft: string;
        todayDate: Date;
    };
    modeToggle: ReactNode;
    table: ReactTable<FeedRow>;
};

function FeedDateFilterControl({
    activeFilterCount,
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
}: FeedDateFilterControlProps) {
    const { t } = useTranslation();
    const dateRangeLabel =
        dateFrom || dateTo
            ? [dateFrom || '...', dateTo || '...'].join(' - ')
            : t('view.feed.date_range');

    return (
        <Popover open={dateFilterOpen} onOpenChange={onDateFilterOpenChange}>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <PopoverTrigger
                            render={
                                <InputGroupButton
                                    type="button"
                                    size="icon-xs"
                                    variant={
                                        activeFilterCount
                                            ? 'secondary'
                                            : 'ghost'
                                    }
                                    aria-label={dateRangeLabel}
                                    onMouseDown={(event) =>
                                        event.preventDefault()
                                    }
                                >
                                    <CalendarRangeIcon data-icon="icon" />
                                </InputGroupButton>
                            }
                        />
                    }
                />
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
    onSelectedTypesChange
}: FeedFilterButtonsProps) {
    const { t } = useTranslation();

    return (
        <div
            className={
                'border-border/50 bg-muted/50 flex min-w-0 flex-wrap items-center gap-1 rounded-lg'
            }
        >
            <Button
                type="button"
                size="lg"
                variant={activeFilters.length === 0 ? 'secondary' : 'ghost'}
                onClick={onClearFeedFilters}
            >
                {t('view.search.avatar.all')}
            </Button>
            <ToggleGroup
                multiple
                variant="default"
                size="lg"
                spacing={1}
                value={[...activeFilters]}
                onValueChange={(nextTypes_) => {
                    const nextTypes = nextTypes_ as FeedFilterType[];
                    onSelectedTypesChange(
                        nextTypes.length === feedFilterTypes.length
                            ? []
                            : nextTypes
                    );
                }}
                className="flex min-w-0 flex-wrap"
            >
                {feedFilterTypes.map((type) => (
                    <ToggleGroupItem key={type} value={type}>
                        {t(`view.feed.filters.${type}`)}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
        </div>
    );
}

function FeedSearchInput({
    activeFilterCount,
    dateDraftFrom,
    dateDraftRange,
    dateDraftTo,
    dateFilterOpen,
    dateFrom,
    dateTo,
    onApplyDateFilter,
    onClearDateFilter,
    onClearSearch,
    onDateFilterOpenChange,
    onDateRangeSelect,
    onSearchBlur,
    onSearchDraftChange,
    onSearchEnter,
    searchDraft,
    todayDate
}: FeedSearchInputProps) {
    const { t } = useTranslation();

    return (
        <InputGroup className="h-9 min-w-0 flex-1">
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
                        aria-label={t('common.actions.clear')}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={onClearSearch}
                    >
                        <XIcon data-icon="icon" />
                    </InputGroupButton>
                ) : null}
                <FeedDateFilterControl
                    activeFilterCount={activeFilterCount}
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
            </InputGroupAddon>
        </InputGroup>
    );
}

export function FeedToolbar({
    filterCommands,
    filterModel,
    modeToggle,
    table
}: FeedToolbarProps) {
    const { t } = useTranslation();
    const {
        activeFilterCount,
        activeFilters,
        dateDraftFrom,
        dateDraftRange,
        dateDraftTo,
        dateFilterOpen,
        dateFrom,
        dateTo,
        favoritesOnly,
        feedFilterTypes,
        searchDraft,
        todayDate
    } = filterModel;
    const {
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
        setActiveSelectedTypes
    } = filterCommands;
    const favoritesOnlyLabel = t('view.feed.favorites_only_tooltip');

    return (
        <PageToolbar>
            <PageToolbarRow className="flex-nowrap">
                <div className="flex shrink-0 items-center">{modeToggle}</div>

                <div className="flex shrink-0 items-center">
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    type="button"
                                    variant={
                                        favoritesOnly ? 'secondary' : 'ghost'
                                    }
                                    size="icon-lg"
                                    aria-label={favoritesOnlyLabel}
                                    onClick={onToggleFavoritesOnly}
                                >
                                    <StarIcon data-icon="icon" />
                                </Button>
                            }
                        />
                        <TooltipContent>{favoritesOnlyLabel}</TooltipContent>
                    </Tooltip>
                </div>

                <FeedFilterButtons
                    activeFilters={activeFilters}
                    feedFilterTypes={feedFilterTypes}
                    onClearFeedFilters={onClearFeedFilters}
                    onSelectedTypesChange={setActiveSelectedTypes}
                />

                <FeedSearchInput
                    activeFilterCount={activeFilterCount}
                    dateDraftFrom={dateDraftFrom}
                    dateDraftRange={dateDraftRange}
                    dateDraftTo={dateDraftTo}
                    dateFilterOpen={dateFilterOpen}
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    onApplyDateFilter={onApplyDateFilter}
                    onClearDateFilter={onClearDateFilter}
                    onClearSearch={onClearSearch}
                    onDateFilterOpenChange={onDateFilterOpenChange}
                    onDateRangeSelect={onDateRangeSelect}
                    onSearchBlur={onSearchBlur}
                    onSearchDraftChange={onSearchDraftChange}
                    onSearchEnter={onSearchEnter}
                    searchDraft={searchDraft}
                    todayDate={todayDate}
                />

                <div className="flex items-center gap-2">
                    <TableColumnVisibilityMenu table={table} />
                </div>
            </PageToolbarRow>
        </PageToolbar>
    );
}
