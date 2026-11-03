import {
    ArrowRightIcon,
    InfoIcon,
    LayoutGridIcon,
    ListIcon,
    SparklesIcon,
    UsersIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    DATA_TABLE_CONTROL_CELL_CLASS_NAME,
    DATA_TABLE_NUMERIC_CELL_CLASS_NAME,
    DATA_TABLE_NUMERIC_HEADER_CLASS_NAME,
    DataTableCell,
    DataTableHead,
    DataTableHeaderRow,
    DataTableRow
} from '@/components/data-table/DataTableView';
import { DateRangeFilter } from '@/components/date-range-filter/DateRangeFilter';
import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import {
    ToolbarSegmented,
    ToolbarStatus,
    ToolbarViews
} from '@/components/layout/ToolbarControls';
import type {
    ScreenshotFacet,
    ScreenshotPeopleMatch
} from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';
import { Table, TableBody, TableHeader } from '@/ui/shadcn/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    type ScreenshotSearchRow,
    type ScreenshotSearchScope,
    type ScreenshotSearchSort
} from '../screenshotMetadataValues';
import type { ScreenshotSearchLayout } from '../useScreenshotMetadataSearch';
import { SearchSortHead } from './ScreenshotMetadataParts';
import { ScreenshotSearchBox } from './ScreenshotSearchBox';

const PEOPLE_MATCH_OPTIONS = [
    {
        value: 'all',
        labelKey: 'dialog.screenshot_metadata.people_match_all'
    },
    {
        value: 'any',
        labelKey: 'dialog.screenshot_metadata.people_match_any'
    }
] as const;

const SEARCH_LAYOUT_OPTIONS = [
    {
        value: 'grid',
        labelKey: 'dialog.screenshot_metadata.layout_grid',
        icon: LayoutGridIcon
    },
    {
        value: 'list',
        labelKey: 'dialog.screenshot_metadata.layout_list',
        icon: ListIcon
    }
] as const;

export function ScreenshotSearchToolbar({
    scope,
    draft,
    peopleFacets,
    worldFacets,
    isSearching,
    searchLayout,
    showResultControls,
    searchRowsCount,
    withoutPeopleCount,
    onDraftChange,
    onScopeChange,
    onCommitText,
    onDateRangeChange,
    onPeopleMatchChange,
    onSearchLayoutChange,
    onClearSearch,
    onAskAssistant
}: {
    scope: ScreenshotSearchScope;
    draft: string;
    peopleFacets: ScreenshotFacet[];
    worldFacets: ScreenshotFacet[];
    isSearching: boolean;
    searchLayout: ScreenshotSearchLayout;
    showResultControls: boolean;
    searchRowsCount: number;
    withoutPeopleCount: number;
    onDraftChange: (value: string) => void;
    onScopeChange: (people: string[], worlds: string[]) => void;
    onCommitText: () => void;
    onDateRangeChange: (from: string, to: string) => void;
    onPeopleMatchChange: (value: ScreenshotPeopleMatch) => void;
    onSearchLayoutChange: (layout: ScreenshotSearchLayout) => void;
    onClearSearch: () => void;
    onAskAssistant: () => void;
}) {
    const { t } = useTranslation();

    return (
        <PageToolbar>
            <PageToolbarRow>
                <ToolbarViews className="min-w-0 flex-wrap">
                    {showResultControls ? (
                        <>
                            <ToolbarStatus>
                                {t('dialog.screenshot_metadata.result_count', {
                                    count: searchRowsCount
                                })}
                            </ToolbarStatus>
                            {scope.people.length > 1 ? (
                                <ToolbarSegmented
                                    value={scope.peopleMatch}
                                    onValueChange={onPeopleMatchChange}
                                    options={PEOPLE_MATCH_OPTIONS.map(
                                        (option) => ({
                                            value: option.value,
                                            label: t(option.labelKey)
                                        })
                                    )}
                                />
                            ) : null}
                            <ToolbarSegmented
                                iconOnly
                                value={searchLayout}
                                onValueChange={onSearchLayoutChange}
                                options={SEARCH_LAYOUT_OPTIONS.map(
                                    (option) => ({
                                        value: option.value,
                                        label: t(option.labelKey),
                                        icon: option.icon
                                    })
                                )}
                            />
                            {withoutPeopleCount > 0 ? (
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <span className="text-muted-foreground inline-flex cursor-help items-center gap-1 text-xs">
                                                <InfoIcon className="size-3.5" />
                                                {t(
                                                    'dialog.screenshot_metadata.without_people',
                                                    {
                                                        count: withoutPeopleCount
                                                    }
                                                )}
                                            </span>
                                        }
                                    />
                                    <TooltipContent className="max-w-64">
                                        {t(
                                            'dialog.screenshot_metadata.without_people_hint'
                                        )}
                                    </TooltipContent>
                                </Tooltip>
                            ) : null}
                        </>
                    ) : null}
                </ToolbarViews>

                <ScreenshotSearchBox
                    people={scope.people}
                    worlds={scope.worlds}
                    peopleFacets={peopleFacets}
                    worldFacets={worldFacets}
                    draft={draft}
                    isSearching={isSearching}
                    onDraftChange={onDraftChange}
                    onScopeChange={onScopeChange}
                    onCommitText={onCommitText}
                    onClear={onClearSearch}
                    dateFilter={
                        <DateRangeFilter
                            label={t('dialog.screenshot_metadata.date_range')}
                            dateFrom={scope.dateFrom}
                            dateTo={scope.dateTo}
                            onChange={onDateRangeChange}
                        />
                    }
                />
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                type="button"
                                size="icon-xs"
                                variant="outline"
                                aria-label={t('assistant.title')}
                                onClick={onAskAssistant}
                            >
                                <SparklesIcon data-icon="inline-start" />
                            </Button>
                        }
                    />
                    <TooltipContent>{t('assistant.title')}</TooltipContent>
                </Tooltip>
            </PageToolbarRow>
        </PageToolbar>
    );
}

export function ScreenshotMetadataResultsTable({
    showMatch,
    searchSort,
    sortedSearchRows,
    selectedPath,
    onToggleSearchSort,
    onOpenResult
}: {
    showMatch: boolean;
    searchSort: ScreenshotSearchSort;
    sortedSearchRows: ScreenshotSearchRow[];
    selectedPath: string;
    onToggleSearchSort: (key: string) => void;
    onOpenResult: (row: ScreenshotSearchRow) => void;
}) {
    const { t } = useTranslation();

    return (
        <div className="app-data-table min-h-0 flex-1 overflow-auto">
            <Table>
                <TableHeader>
                    <DataTableHeaderRow>
                        <DataTableHead>
                            <SearchSortHead
                                label={t('dialog.screenshot_metadata.col_date')}
                                sortKey="dateTime"
                                sort={searchSort}
                                onToggle={onToggleSearchSort}
                            />
                        </DataTableHead>
                        <DataTableHead>
                            <SearchSortHead
                                label={t(
                                    'dialog.screenshot_metadata.col_world'
                                )}
                                sortKey="world"
                                sort={searchSort}
                                onToggle={onToggleSearchSort}
                            />
                        </DataTableHead>
                        {showMatch ? (
                            <DataTableHead>
                                <SearchSortHead
                                    label={t(
                                        'dialog.screenshot_metadata.col_match'
                                    )}
                                    sortKey="match"
                                    sort={searchSort}
                                    onToggle={onToggleSearchSort}
                                />
                            </DataTableHead>
                        ) : null}
                        <DataTableHead>
                            <SearchSortHead
                                label={t(
                                    'dialog.screenshot_metadata.col_author'
                                )}
                                sortKey="author"
                                sort={searchSort}
                                onToggle={onToggleSearchSort}
                            />
                        </DataTableHead>
                        <DataTableHead
                            className={DATA_TABLE_NUMERIC_HEADER_CLASS_NAME}
                        >
                            <SearchSortHead
                                label={t(
                                    'dialog.screenshot_metadata.col_players'
                                )}
                                sortKey="playerCount"
                                sort={searchSort}
                                onToggle={onToggleSearchSort}
                                className="ml-auto"
                            />
                        </DataTableHead>
                        <DataTableHead>
                            {t('dialog.screenshot_metadata.col_resolution')}
                        </DataTableHead>
                        <DataTableHead className="w-8" />
                    </DataTableHeaderRow>
                </TableHeader>
                <TableBody>
                    {sortedSearchRows.map((row) => (
                        <DataTableRow
                            key={row.filePath}
                            data-state={
                                row.filePath === selectedPath
                                    ? 'selected'
                                    : undefined
                            }
                        >
                            <DataTableCell>{row.dateLabel}</DataTableCell>
                            <DataTableCell>{row.world}</DataTableCell>
                            {showMatch ? (
                                <DataTableCell>{row.match}</DataTableCell>
                            ) : null}
                            <DataTableCell>{row.author}</DataTableCell>
                            <DataTableCell
                                className={DATA_TABLE_NUMERIC_CELL_CLASS_NAME}
                            >
                                <span className="inline-flex items-center gap-1">
                                    <UsersIcon className="text-muted-foreground size-3" />
                                    {row.playerCount}
                                </span>
                            </DataTableCell>
                            <DataTableCell>{row.resolution}</DataTableCell>
                            <DataTableCell
                                className={`${DATA_TABLE_CONTROL_CELL_CLASS_NAME} text-right`}
                            >
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={t('common.actions.open')}
                                    onClick={() => onOpenResult(row)}
                                >
                                    <ArrowRightIcon data-icon="inline-start" />
                                </Button>
                            </DataTableCell>
                        </DataTableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
