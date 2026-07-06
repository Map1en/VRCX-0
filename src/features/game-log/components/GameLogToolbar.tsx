import type { Table as ReactTable } from '@tanstack/react-table';
import {
    CalendarRangeIcon,
    LogsIcon,
    RefreshCwIcon,
    SearchIcon,
    StarIcon,
    Table2Icon,
    XIcon
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu';
import {
    DateTimeRangePicker,
    type DateTimeRangeValue
} from '@/components/date-time-range-picker/DateTimeRangePicker';
import { formatCompactDateTime } from '@/lib/dateTime';
import { Button } from '@/ui/shadcn/button';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { Spinner } from '@/ui/shadcn/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { GAME_LOG_SESSION_DATE_RANGE_MAX_DAYS } from '../gameLogDateRange';
import type {
    GameLogFilterType,
    GameLogLoadStatus,
    GameLogRow,
    GameLogViewMode
} from '../gameLogTypes';
import { TypeFilterDropdown, TypeFilterToggleGroup } from './GameLogTableParts';

function GameLogViewModeToggle({
    viewMode,
    onViewModeChange
}: {
    onViewModeChange(viewMode: GameLogViewMode): void;
    viewMode: GameLogViewMode;
}) {
    const { t } = useTranslation();
    const sessionsLabel = t('view.game_log.label.sessions');
    const tableLabel = t('view.game_log.label.table');

    return (
        <ToggleGroup
            variant="outline"
            size="sm"
            value={viewMode ? [viewMode] : []}
            onValueChange={(nextValue) => {
                const next = nextValue[0];
                if (next) {
                    onViewModeChange(next as GameLogViewMode);
                }
            }}
            className="shrink-0"
        >
            <Tooltip>
                <TooltipTrigger
                    render={
                        <ToggleGroupItem
                            value="sessions"
                            aria-label={sessionsLabel}
                        >
                            <LogsIcon data-icon="inline-start" />
                        </ToggleGroupItem>
                    }
                />
                <TooltipContent>{sessionsLabel}</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <ToggleGroupItem value="table" aria-label={tableLabel}>
                            <Table2Icon data-icon="inline-start" />
                        </ToggleGroupItem>
                    }
                />
                <TooltipContent>{tableLabel}</TooltipContent>
            </Tooltip>
        </ToggleGroup>
    );
}

function GameLogFavoritesToggle({
    favoritesOnly,
    onToggle
}: {
    favoritesOnly: boolean;
    onToggle(): void;
}) {
    const { t } = useTranslation();
    const label = t('view.game_log.label.favorites_only');

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        variant={favoritesOnly ? 'secondary' : 'outline'}
                        size="icon-sm"
                        aria-label={label}
                        onClick={onToggle}
                    >
                        <StarIcon data-icon="inline-start" />
                    </Button>
                }
            />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

function GameLogSessionDateFilter({
    value,
    onChange,
    todayDate
}: {
    onChange(value: DateTimeRangeValue): void;
    todayDate: Date;
    value: DateTimeRangeValue;
}) {
    const { t } = useTranslation();

    return (
        <DateTimeRangePicker
            value={value}
            onChange={onChange}
            placeholder={t('view.game_log.label.session_date_range')}
            startLabel={t('view.game_log.label.start')}
            endLabel={t('view.game_log.label.end')}
            clearLabel={t('common.actions.clear')}
            confirmLabel={t('common.actions.confirm')}
            formatValue={formatCompactDateTime}
            maxDays={GAME_LOG_SESSION_DATE_RANGE_MAX_DAYS}
            minuteStep={15}
            align="end"
            disabled={{ after: todayDate }}
            renderTrigger={({ active, label }) => (
                <InputGroupButton
                    type="button"
                    size="icon-xs"
                    variant={active ? 'secondary' : 'ghost'}
                    aria-label={label}
                    onMouseDown={(event) => event.preventDefault()}
                >
                    <CalendarRangeIcon data-icon="icon" />
                </InputGroupButton>
            )}
        />
    );
}

function GameLogSearchInput({
    dateFilterControl = null,
    value,
    onChange,
    onCommit,
    onClear
}: {
    dateFilterControl?: ReactNode;
    onChange(value: string): void;
    onClear(): void;
    onCommit(): void;
    value: string;
}) {
    const { t } = useTranslation();
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
            {value || dateFilterControl ? (
                <InputGroupAddon align="inline-end" className="gap-1">
                    {value ? (
                        <InputGroupButton
                            type="button"
                            size="icon-xs"
                            aria-label={t('common.actions.clear')}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={onClear}
                        >
                            <XIcon data-icon="icon" />
                        </InputGroupButton>
                    ) : null}
                    {dateFilterControl}
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
    table
}: {
    canRefresh: boolean;
    loadStatus: GameLogLoadStatus;
    onRefresh(): void;
    showColumnVisibilityMenu: boolean;
    table: ReactTable<GameLogRow>;
}) {
    const { t } = useTranslation();
    return (
        <div className="flex shrink-0 items-center gap-2">
            <Tooltip>
                <TooltipTrigger
                    render={
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
                    }
                />
                <TooltipContent>{t('common.actions.refresh')}</TooltipContent>
            </Tooltip>
            {showColumnVisibilityMenu ? (
                <TableColumnVisibilityMenu table={table} />
            ) : null}
        </div>
    );
}

export function GameLogToolbar({
    filterModel,
    refreshModel,
    table
}: {
    filterModel: {
        availableFilterTypes: readonly GameLogFilterType[];
        favoritesOnly: boolean;
        queryFilterTypes: readonly GameLogFilterType[];
        searchDraft: string;
        sessionDateRange: DateTimeRangeValue;
        todayDate: Date;
        viewMode: GameLogViewMode;
        changeViewMode(viewMode: GameLogViewMode): void;
        clearSearch(): void;
        commitSearchDraft(): void;
        setActiveSelectedTypes(types: GameLogFilterType[]): void;
        setSearchDraft(value: string): void;
        setSessionDateTimeRange(value: DateTimeRangeValue): void;
        toggleFavoritesOnly(): void;
    };
    refreshModel: {
        canRefresh: boolean;
        loadStatus: GameLogLoadStatus;
        onRefresh(): void;
    };
    table: ReactTable<GameLogRow>;
}) {
    const {
        availableFilterTypes,
        favoritesOnly,
        queryFilterTypes,
        searchDraft,
        sessionDateRange,
        todayDate,
        viewMode,
        changeViewMode,
        clearSearch,
        commitSearchDraft,
        setActiveSelectedTypes,
        setSearchDraft,
        setSessionDateTimeRange,
        toggleFavoritesOnly
    } = filterModel;
    const { canRefresh, loadStatus, onRefresh } = refreshModel;
    const isTableView = viewMode === 'table';

    return (
        <div className="overflow-hidden pb-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="flex shrink-0 items-center gap-2">
                    <GameLogViewModeToggle
                        viewMode={viewMode}
                        onViewModeChange={changeViewMode}
                    />
                    <GameLogFavoritesToggle
                        favoritesOnly={favoritesOnly}
                        onToggle={toggleFavoritesOnly}
                    />
                </div>
                {isTableView ? (
                    <div className="min-w-44">
                        <TypeFilterDropdown
                            types={availableFilterTypes}
                            selectedTypes={queryFilterTypes}
                            onSelectedTypesChange={setActiveSelectedTypes}
                        />
                    </div>
                ) : (
                    <TypeFilterToggleGroup
                        types={availableFilterTypes}
                        selectedTypes={queryFilterTypes}
                        onSelectedTypesChange={setActiveSelectedTypes}
                        className="flex min-w-0 flex-wrap items-center gap-1"
                    />
                )}
                <GameLogSearchInput
                    dateFilterControl={
                        isTableView ? null : (
                            <GameLogSessionDateFilter
                                value={sessionDateRange}
                                onChange={setSessionDateTimeRange}
                                todayDate={todayDate}
                            />
                        )
                    }
                    value={searchDraft}
                    onChange={setSearchDraft}
                    onCommit={commitSearchDraft}
                    onClear={clearSearch}
                />
                <GameLogToolbarControls
                    canRefresh={canRefresh}
                    loadStatus={loadStatus}
                    onRefresh={onRefresh}
                    showColumnVisibilityMenu={isTableView}
                    table={table}
                />
            </div>
        </div>
    );
}
