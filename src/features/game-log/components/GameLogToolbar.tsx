// @ts-nocheck
import {
    CalendarRangeIcon,
    LogsIcon,
    RefreshCwIcon,
    SearchIcon,
    StarIcon,
    Table2Icon,
    XIcon
} from 'lucide-react';

import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu';
import { cn } from '@/lib/utils.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Calendar } from '@/ui/shadcn/calendar';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Spinner } from '@/ui/shadcn/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { GAME_LOG_SESSION_DATE_RANGE_MAX_DAYS } from '../gameLogDateRange.js';
import {
    TypeFilterDropdown,
    TypeFilterToggleGroup
} from './GameLogTableParts';

function GameLogViewModeToggle({ viewMode, onViewModeChange, t }) {
    const sessionsLabel = t('view.game_log.label.sessions');
    const tableLabel = t('view.game_log.label.table');

    return (
        <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={viewMode}
            onValueChange={(nextValue) => {
                if (nextValue) {
                    onViewModeChange(nextValue);
                }
            }}
            className="shrink-0"
        >
            <Tooltip>
                <TooltipTrigger asChild>
                    <ToggleGroupItem
                        value="sessions"
                        aria-label={sessionsLabel}
                    >
                        <LogsIcon data-icon="inline-start" />
                    </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>{sessionsLabel}</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <ToggleGroupItem
                        value="table"
                        aria-label={tableLabel}
                    >
                        <Table2Icon data-icon="inline-start" />
                    </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>{tableLabel}</TooltipContent>
            </Tooltip>
        </ToggleGroup>
    );
}

function GameLogFavoritesToggle({ favoritesOnly, onToggle, t }) {
    const label = t('view.game_log.label.favorites_only');

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    type="button"
                    variant={favoritesOnly ? 'default' : 'outline'}
                    size="icon-sm"
                    aria-label={label}
                    onClick={onToggle}
                >
                    <StarIcon data-icon="inline-start" />
                </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

function GameLogSessionDateFilter({
    open,
    onOpenChange,
    sessionDateFrom,
    sessionDateTo,
    sessionDateDraftFrom,
    sessionDateDraftTo,
    sessionDateDraftRange,
    todayDate,
    onRangeSelect,
    onClear,
    onApply,
    t
}) {
    const label = t('view.game_log.label.session_date_range');

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className={cn(
                                'shrink-0 gap-1.5',
                                (sessionDateFrom || sessionDateTo) &&
                                    'bg-accent text-accent-foreground'
                            )}
                            aria-label={label}
                        >
                            <CalendarRangeIcon data-icon="inline-start" />
                            {sessionDateFrom || sessionDateTo ? (
                                <Badge
                                    variant="secondary"
                                    className="ml-0.5 h-4.5 min-w-4.5 rounded-full px-1 text-xs"
                                >
                                    1
                                </Badge>
                            ) : null}
                        </Button>
                    </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
            </Tooltip>
            <PopoverContent className="w-auto" align="start">
                <Calendar
                    mode="range"
                    numberOfMonths={2}
                    max={GAME_LOG_SESSION_DATE_RANGE_MAX_DAYS}
                    selected={sessionDateDraftRange}
                    disabled={{ after: todayDate }}
                    onSelect={onRangeSelect}
                />
                <div className="flex items-center justify-between gap-4 px-3 pb-3">
                    <div className="text-muted-foreground min-w-0 text-xs">
                        {[
                            sessionDateDraftFrom || '...',
                            sessionDateDraftTo || '...'
                        ].join(' - ')}
                        <span className="ml-2">
                            {t('view.game_log.label.max')}{' '}
                            {GAME_LOG_SESSION_DATE_RANGE_MAX_DAYS}{' '}
                            {t('view.game_log.label.days')}
                        </span>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onClear}
                        >
                            {t('common.actions.clear')}
                        </Button>
                        <Button type="button" size="sm" onClick={onApply}>
                            {t('common.actions.confirm')}
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}

function GameLogSearchInput({ value, onChange, onCommit, onClear, t }) {
    return (
        <InputGroup className="order-last w-full min-w-0 sm:order-none sm:ml-auto sm:w-60 sm:shrink-0">
            <InputGroupAddon>
                <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onBlur={onCommit}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        onCommit();
                    }
                }}
                placeholder={t('common.actions.search')}
            />
            {value ? (
                <InputGroupAddon align="inline-end">
                    <InputGroupButton
                        type="button"
                        size="icon-xs"
                        aria-label={t('common.actions.clear')}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={onClear}
                    >
                        <XIcon data-icon="icon" />
                    </InputGroupButton>
                </InputGroupAddon>
            ) : null}
        </InputGroup>
    );
}

function GameLogToolbarControls({
    canRefresh,
    loadStatus,
    onRefresh,
    showColumnVisibilityMenu,
    table,
    t
}) {
    return (
        <div className="flex shrink-0 items-center gap-2">
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label={t('common.actions.refresh')}
                        disabled={!canRefresh || loadStatus === 'running'}
                        onClick={onRefresh}
                    >
                        {loadStatus === 'running' ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <RefreshCwIcon data-icon="inline-start" />
                        )}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>{t('common.actions.refresh')}</TooltipContent>
            </Tooltip>
            {showColumnVisibilityMenu ? (
                <TableColumnVisibilityMenu table={table} />
            ) : null}
        </div>
    );
}

export function GameLogToolbar({
    viewMode,
    favoritesOnly,
    availableFilterTypes,
    queryFilterTypes,
    onViewModeChange,
    onToggleFavoritesOnly,
    onSelectedTypesChange,
    sessionDatePopoverOpen,
    onSessionDatePopoverOpenChange,
    sessionDateFrom,
    sessionDateTo,
    sessionDateDraftFrom,
    sessionDateDraftTo,
    sessionDateDraftRange,
    todayDate,
    onSessionDateRangeSelect,
    onSessionDateClear,
    onSessionDateApply,
    searchDraft,
    onSearchDraftChange,
    onSearchCommit,
    onSearchClear,
    canRefresh,
    loadStatus,
    onRefresh,
    table,
    t
}) {
    const isTableView = viewMode === 'table';

    return (
        <div className="overflow-hidden pb-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="flex shrink-0 items-center gap-2">
                    <GameLogViewModeToggle
                        viewMode={viewMode}
                        onViewModeChange={onViewModeChange}
                        t={t}
                    />
                    <GameLogFavoritesToggle
                        favoritesOnly={favoritesOnly}
                        onToggle={onToggleFavoritesOnly}
                        t={t}
                    />
                </div>
                {isTableView ? (
                    <div className="min-w-44">
                        <TypeFilterDropdown
                            types={availableFilterTypes}
                            selectedTypes={queryFilterTypes}
                            onSelectedTypesChange={onSelectedTypesChange}
                        />
                    </div>
                ) : (
                    <>
                        <GameLogSessionDateFilter
                            open={sessionDatePopoverOpen}
                            onOpenChange={onSessionDatePopoverOpenChange}
                            sessionDateFrom={sessionDateFrom}
                            sessionDateTo={sessionDateTo}
                            sessionDateDraftFrom={sessionDateDraftFrom}
                            sessionDateDraftTo={sessionDateDraftTo}
                            sessionDateDraftRange={sessionDateDraftRange}
                            todayDate={todayDate}
                            onRangeSelect={onSessionDateRangeSelect}
                            onClear={onSessionDateClear}
                            onApply={onSessionDateApply}
                            t={t}
                        />
                        <TypeFilterToggleGroup
                            types={availableFilterTypes}
                            selectedTypes={queryFilterTypes}
                            onSelectedTypesChange={onSelectedTypesChange}
                            className="flex min-w-0 flex-wrap items-center gap-1"
                        />
                    </>
                )}
                <GameLogSearchInput
                    value={searchDraft}
                    onChange={onSearchDraftChange}
                    onCommit={onSearchCommit}
                    onClear={onSearchClear}
                    t={t}
                />
                <GameLogToolbarControls
                    canRefresh={canRefresh}
                    loadStatus={loadStatus}
                    onRefresh={onRefresh}
                    showColumnVisibilityMenu={isTableView}
                    table={table}
                    t={t}
                />
            </div>
        </div>
    );
}
