import {
    ChevronDownIcon,
    ChevronsDownUpIcon,
    ChevronsUpDownIcon,
    LogsIcon,
    StarIcon,
    Table2Icon
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
    toolbarSearchDateRangeTrigger,
    ToolbarActions,
    ToolbarFilterChips,
    ToolbarIconButton,
    ToolbarRefreshButton,
    ToolbarSearch,
    ToolbarSegmented,
    ToolbarStatus,
    ToolbarViews,
    type ToolbarSegmentOption
} from '@/components/layout/ToolbarControls';
import { formatCompactDateTime } from '@/lib/dateTime';
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
import { Tooltip } from '@/ui/shadcn/tooltip';

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
    favoritesOnly,
    onValueChange,
    onToggleFavoritesOnly
}: {
    value: readonly GameLogFilterType[];
    options: readonly ToolbarSegmentOption<GameLogFilterType>[];
    favoritesOnly: boolean;
    onValueChange(value: GameLogFilterType[]): void;
    onToggleFavoritesOnly(): void;
}) {
    const { t } = useTranslation();
    const selected = options.filter((option) => value.includes(option.value));
    const allLabel = t('view.search.avatar.all');

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        variant={
                            selected.length || favoritesOnly
                                ? 'secondary'
                                : 'outline'
                        }
                        aria-label={t('table.gameLog.type')}
                    />
                }
            >
                <span className="max-w-32 truncate">
                    {t('table.gameLog.type')}
                </span>
                <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
                <DropdownMenuGroup>
                    <DropdownMenuCheckboxItem
                        checked={favoritesOnly}
                        closeOnClick={false}
                        onCheckedChange={onToggleFavoritesOnly}
                    >
                        {t('view.game_log.label.favorites_only')}
                    </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
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

    return (
        <Tooltip>
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
                renderTrigger={toolbarSearchDateRangeTrigger}
            />
        </Tooltip>
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
                <ToolbarViews className="min-w-0 flex-wrap">
                    <ToolbarSegmented
                        iconOnly
                        value={viewMode}
                        onValueChange={changeViewMode}
                        options={viewModeOptions}
                    />
                    <ToolbarFilterChips
                        value={queryFilterTypes}
                        options={typeOptions}
                        leading={{
                            label: t('view.game_log.label.favorites_only'),
                            icon: StarIcon,
                            pressed: favoritesOnly,
                            onPressedChange: toggleFavoritesOnly
                        }}
                        onValueChange={setActiveSelectedTypes}
                    />
                    <GameLogTypeFilterMenu
                        value={queryFilterTypes}
                        options={typeOptions}
                        favoritesOnly={favoritesOnly}
                        onValueChange={setActiveSelectedTypes}
                        onToggleFavoritesOnly={toggleFavoritesOnly}
                    />
                </ToolbarViews>

                <ToolbarSearch
                    value={searchDraft}
                    onValueChange={setSearchDraft}
                    onCommit={commitSearchDraft}
                    onClear={clearSearch}
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
                    <ToolbarRefreshButton
                        onRefresh={onRefresh}
                        loading={loadStatus === 'running'}
                        disabled={!canRefresh}
                    />
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
                    {isTableView ? (
                        <TableColumnVisibilityMenu table={table} />
                    ) : null}
                </ToolbarActions>
            </PageToolbarRow>

            {detail ? <ToolbarStatus>{detail}</ToolbarStatus> : null}
        </PageToolbar>
    );
}
