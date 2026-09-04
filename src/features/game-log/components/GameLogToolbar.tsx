import {
    CalendarRangeIcon,
    ChevronDownIcon,
    ChevronsDownUpIcon,
    ChevronsUpDownIcon,
    LogsIcon,
    StarIcon,
    Table2Icon,
    XIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { AppTable } from '@/components/data-table/appTable';
import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu';
import {
    DateTimeRangePicker,
    type DateTimeRangeValue
} from '@/components/date-time-range-picker/DateTimeRangePicker';
import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import {
    ToolbarActions,
    ToolbarFilterChips,
    ToolbarIconButton,
    ToolbarRefreshButton,
    ToolbarSearch,
    ToolbarSegmented,
    ToolbarStatus,
    ToolbarToggleButton,
    ToolbarViews,
    type ToolbarSegmentOption
} from '@/components/layout/ToolbarControls';
import { formatCompactDateTime } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
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
import { InputGroupButton } from '@/ui/shadcn/input-group';

import { GAME_LOG_SESSION_DATE_RANGE_MAX_DAYS } from '../gameLogDateRange';
import type {
    GameLogFilterType,
    GameLogLoadStatus,
    GameLogRow,
    GameLogViewMode
} from '../gameLogTypes';

function GameLogTypeFilterMenu({
    value,
    options,
    onValueChange
}: {
    value: readonly GameLogFilterType[];
    options: readonly ToolbarSegmentOption<GameLogFilterType>[];
    onValueChange(value: GameLogFilterType[]): void;
}) {
    const { t } = useTranslation();
    const selected = options.filter((option) => value.includes(option.value));
    const first = selected[0];
    const allLabel = t('view.search.avatar.all');

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        variant={selected.length ? 'secondary' : 'outline'}
                        aria-label={t('table.gameLog.type')}
                    />
                }
            >
                <span className="max-w-32 truncate">
                    {first?.label ?? allLabel}
                </span>
                {selected.length > 1 ? (
                    <span className="tabular-nums">+{selected.length - 1}</span>
                ) : null}
                <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
                <DropdownMenuGroup>
                    <DropdownMenuLabel>
                        {t('table.gameLog.type')}
                    </DropdownMenuLabel>
                    <DropdownMenuCheckboxItem
                        checked={!value.length}
                        closeOnClick={false}
                        onCheckedChange={() => onValueChange([])}
                    >
                        {allLabel}
                    </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    {options.map((option) => (
                        <DropdownMenuCheckboxItem
                            key={option.value}
                            checked={value.includes(option.value)}
                            closeOnClick={false}
                            onCheckedChange={(checked) => {
                                const picked = options
                                    .filter((entry) =>
                                        entry.value === option.value
                                            ? checked
                                            : value.includes(entry.value)
                                    )
                                    .map((entry) => entry.value);
                                onValueChange(
                                    picked.length === options.length
                                        ? []
                                        : picked
                                );
                            }}
                        >
                            {option.label}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function GameLogDateRangeFilter({
    value,
    todayDate,
    onChange
}: {
    value: DateTimeRangeValue;
    todayDate: Date;
    onChange(value: DateTimeRangeValue): void;
}) {
    const { t } = useTranslation();
    const dateRangeLabel = t('view.game_log.label.session_date_range');
    const hasRange = Boolean(value.from || value.to);

    return (
        <>
            <DateTimeRangePicker
                value={value}
                onChange={onChange}
                placeholder={dateRangeLabel}
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
                        variant={active ? 'secondary' : 'ghost'}
                        size={active ? 'xs' : 'icon-xs'}
                        aria-label={
                            active ? `${dateRangeLabel}: ${label}` : label
                        }
                        title={label}
                    >
                        <CalendarRangeIcon data-icon="inline-start" />
                        {active ? (
                            <span className="hidden max-w-52 truncate tabular-nums @min-5xl/game-log-toolbar:inline">
                                {label}
                            </span>
                        ) : null}
                    </InputGroupButton>
                )}
            />
            {hasRange ? (
                <InputGroupButton
                    size="icon-xs"
                    aria-label={`${dateRangeLabel}: ${t('common.actions.clear')}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onChange({ from: null, to: null })}
                >
                    <XIcon data-icon="icon" />
                </InputGroupButton>
            ) : null}
        </>
    );
}

export function GameLogToolbar({
    detail,
    filterModel,
    refreshModel,
    table,
    sessionControls
}: {
    detail?: string;
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
    table: AppTable<GameLogRow>;
    sessionControls: {
        allOpen: boolean;
        canToggle: boolean;
        onToggle(): void;
    };
}) {
    const { t } = useTranslation();
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
    const hasDateRange = Boolean(sessionDateRange.from || sessionDateRange.to);
    const typeOptions = availableFilterTypes.map((type) => ({
        value: type,
        label: t(`view.game_log.filters.${type}`)
    }));
    const viewModeOptions: ToolbarSegmentOption<GameLogViewMode>[] = [
        {
            value: 'sessions',
            label: t('view.game_log.label.sessions'),
            icon: LogsIcon
        },
        {
            value: 'table',
            label: t('view.game_log.label.table'),
            icon: Table2Icon
        }
    ];

    return (
        <PageToolbar className="@container/game-log-toolbar">
            <PageToolbarRow>
                <ToolbarViews className="min-w-0 flex-initial flex-wrap @min-4xl/game-log-toolbar:flex-1">
                    <ToolbarSegmented
                        iconOnly
                        value={viewMode}
                        onValueChange={changeViewMode}
                        options={viewModeOptions}
                    />
                    <ToolbarToggleButton
                        icon={StarIcon}
                        fillWhenActive
                        active={favoritesOnly}
                        label={t('view.game_log.label.favorites_only')}
                        onClick={toggleFavoritesOnly}
                    />
                    <div className="@min-4xl/game-log-toolbar:hidden">
                        <GameLogTypeFilterMenu
                            value={queryFilterTypes}
                            options={typeOptions}
                            onValueChange={setActiveSelectedTypes}
                        />
                    </div>
                    <div className="hidden min-w-0 flex-1 @min-4xl/game-log-toolbar:block">
                        <ToolbarFilterChips
                            value={queryFilterTypes}
                            allLabel={t('view.search.avatar.all')}
                            options={typeOptions}
                            onValueChange={setActiveSelectedTypes}
                        />
                    </div>
                </ToolbarViews>

                <div
                    className={cn(
                        'ms-auto flex min-w-0 grow items-center gap-2',
                        !isTableView && hasDateRange
                            ? 'max-w-[30rem] basis-80'
                            : 'max-w-96 basis-64'
                    )}
                >
                    <ToolbarSearch
                        value={searchDraft}
                        onValueChange={setSearchDraft}
                        onCommit={commitSearchDraft}
                        onClear={clearSearch}
                        className="w-auto min-w-0 flex-1 shrink sm:w-auto"
                        trailing={
                            isTableView ? undefined : (
                                <GameLogDateRangeFilter
                                    value={sessionDateRange}
                                    todayDate={todayDate}
                                    onChange={setSessionDateTimeRange}
                                />
                            )
                        }
                    />
                    <ToolbarActions>
                        {isTableView ? null : (
                            <ToolbarIconButton
                                icon={
                                    sessionControls.allOpen
                                        ? ChevronsDownUpIcon
                                        : ChevronsUpDownIcon
                                }
                                label={t(
                                    sessionControls.allOpen
                                        ? 'view.game_log.sessions.collapse_all'
                                        : 'view.game_log.sessions.expand_all'
                                )}
                                disabled={!sessionControls.canToggle}
                                onClick={sessionControls.onToggle}
                            />
                        )}
                        <ToolbarRefreshButton
                            onRefresh={onRefresh}
                            loading={loadStatus === 'running'}
                            disabled={!canRefresh}
                        />
                        {isTableView ? (
                            <TableColumnVisibilityMenu table={table} />
                        ) : null}
                    </ToolbarActions>
                </div>
            </PageToolbarRow>

            {detail ? <ToolbarStatus>{detail}</ToolbarStatus> : null}
        </PageToolbar>
    );
}
