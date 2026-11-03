import {
    ArrowLeftIcon,
    ArrowRightIcon,
    CopyIcon,
    FolderOpenIcon,
    InfoIcon,
    LayoutGridIcon,
    ListIcon,
    PanelRightCloseIcon,
    PanelRightOpenIcon,
    SparklesIcon,
    StarIcon,
    Trash2Icon,
    UploadIcon,
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
import { KeyboardShortcut } from '@/components/keyboard/KeyboardShortcut';
import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import {
    ToolbarSegmented,
    ToolbarStatus,
    ToolbarViews
} from '@/components/layout/ToolbarControls';
import { useProgressiveImageSource } from '@/components/media/useProgressiveImageSource';
import { cn } from '@/lib/utils';
import type {
    ScreenshotFacet,
    ScreenshotPeopleMatch
} from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import { Table, TableBody, TableHeader } from '@/ui/shadcn/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    type NormalizedScreenshotMetadata,
    type ScreenshotSearchRow,
    type ScreenshotSearchScope,
    type ScreenshotSearchSort
} from '../screenshotMetadataValues';
import type { ScreenshotSearchLayout } from '../useScreenshotMetadataSearch';
import { EmptyState, SearchSortHead } from './ScreenshotMetadataParts';
import { ScreenshotSearchBox } from './ScreenshotSearchBox';

export { ScreenshotMetadataDetailsCard } from './ScreenshotMetadataDetailsCard';

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

export function ScreenshotDetailActions({
    metadata,
    isVrcPlusSupporter,
    isUploadingScreenshot,
    isDeletingMetadata,
    isDeletingFile,
    onBackToGallery,
    onOpenFolder,
    onCopyImage,
    onUpload,
    onDelete,
    onDeleteFile,
    isFavorite,
    onToggleFavorite
}: {
    metadata: NormalizedScreenshotMetadata | null;
    isVrcPlusSupporter: boolean;
    isUploadingScreenshot: boolean;
    isDeletingMetadata: boolean;
    isDeletingFile: boolean;
    onBackToGallery: () => void;
    onOpenFolder: () => void;
    onCopyImage: () => void;
    onUpload: () => void;
    onDelete: () => void;
    onDeleteFile: () => void;
    isFavorite: boolean;
    onToggleFavorite: () => void;
}) {
    const { t } = useTranslation();

    return (
        <div className="mb-2 flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={onBackToGallery}>
                <ArrowLeftIcon data-icon="inline-start" />
                {t('dialog.screenshot_metadata.gallery')}
            </Button>
            <Button
                variant="outline"
                size="sm"
                disabled={!metadata?.filePath}
                aria-pressed={isFavorite}
                onClick={onToggleFavorite}
            >
                <StarIcon
                    data-icon="inline-start"
                    className={cn(isFavorite && 'fill-current text-amber-400')}
                />
                {t(
                    isFavorite
                        ? 'dialog.screenshot_metadata.unfavorite'
                        : 'dialog.screenshot_metadata.favorite'
                )}
            </Button>
            <Button
                variant="outline"
                size="sm"
                disabled={!metadata?.filePath}
                onClick={onOpenFolder}
            >
                <FolderOpenIcon data-icon="inline-start" />
                {t('dialog.screenshot_metadata.open_folder')}
            </Button>
            <Button
                variant="outline"
                size="sm"
                disabled={!metadata?.filePath}
                onClick={onCopyImage}
            >
                <CopyIcon data-icon="inline-start" />
                {t('dialog.screenshot_metadata.copy_image')}
            </Button>
            <Button
                variant="outline"
                size="sm"
                disabled={
                    !metadata?.filePath ||
                    !isVrcPlusSupporter ||
                    isUploadingScreenshot
                }
                onClick={onUpload}
            >
                <UploadIcon data-icon="inline-start" />
                {t('dialog.screenshot_metadata.upload')}
            </Button>
            <Button
                variant="outline"
                size="sm"
                disabled={!metadata?.filePath || isDeletingMetadata}
                onClick={onDelete}
            >
                <Trash2Icon data-icon="inline-start" />
                {t('dialog.screenshot_metadata.delete_metadata')}
            </Button>
            <Button
                variant="destructive"
                size="sm"
                disabled={!metadata?.filePath || isDeletingFile}
                onClick={onDeleteFile}
            >
                <Trash2Icon data-icon="inline-start" />
                {t('dialog.screenshot_metadata.delete_file')}
            </Button>
        </div>
    );
}

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
    searchNavigationCount,
    selectedPathIndex,
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
    searchNavigationCount: number;
    selectedPathIndex: number;
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
                    ) : searchNavigationCount && selectedPathIndex >= 0 ? (
                        <ToolbarStatus>
                            {selectedPathIndex + 1}/{searchNavigationCount}
                        </ToolbarStatus>
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

export function ScreenshotMetadataPreviewCard({
    metadata,
    imageUrl,
    placeholderUrl,
    isMetadataLoading,
    canNavigatePrev,
    canNavigateNext,
    isDetailsVisible,
    onNavigatePrev,
    onNavigateNext,
    onToggleDetails,
    onImagePreview
}: {
    metadata: NormalizedScreenshotMetadata | null;
    imageUrl: string;
    placeholderUrl: string;
    isMetadataLoading: boolean;
    canNavigatePrev: boolean;
    canNavigateNext: boolean;
    isDetailsVisible: boolean;
    onNavigatePrev: () => void;
    onNavigateNext: () => void;
    onToggleDetails: () => void;
    onImagePreview: () => void;
}) {
    const { t } = useTranslation();
    const { shownSrc, status } = useProgressiveImageSource(
        imageUrl,
        placeholderUrl
    );

    return (
        <Card className="flex min-h-0 flex-col">
            <CardHeader>
                <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col gap-1">
                        <CardTitle>{t('view.tools.action.preview')}</CardTitle>
                        <CardDescription>
                            {metadata?.fileName ||
                                t('dialog.screenshot_metadata.drag')}
                        </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={!canNavigatePrev}
                            onClick={onNavigatePrev}
                        >
                            <ArrowLeftIcon data-icon="inline-start" />
                            {t('view.tools.label.prev')}
                            <KeyboardShortcut keys="ArrowLeft" />
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={!canNavigateNext}
                            onClick={onNavigateNext}
                        >
                            {t('table.pagination.next')}
                            <KeyboardShortcut keys="ArrowRight" />
                            <ArrowRightIcon data-icon="inline-end" />
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onToggleDetails}
                        >
                            {isDetailsVisible ? (
                                <PanelRightCloseIcon data-icon="inline-start" />
                            ) : (
                                <PanelRightOpenIcon data-icon="inline-start" />
                            )}
                            {t(
                                isDetailsVisible
                                    ? 'dialog.screenshot_metadata.hide_details'
                                    : 'dialog.screenshot_metadata.show_details'
                            )}
                            <KeyboardShortcut keys="I" />
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 items-center justify-center">
                {shownSrc ? (
                    <Button
                        type="button"
                        variant="ghost"
                        className="h-auto w-full p-0"
                        onClick={onImagePreview}
                    >
                        <img
                            src={shownSrc}
                            alt={metadata?.fileName || 'Screenshot preview'}
                            className="max-h-[70vh] w-full rounded-lg object-contain transition-none"
                        />
                    </Button>
                ) : isMetadataLoading || status === 'loading' ? (
                    <EmptyState
                        loading
                        title={t('view.tools.loading.loading_screenshot')}
                        description={t(
                            'view.tools.loading.fetching_embedded_metadata_and_file_details'
                        )}
                    />
                ) : status === 'error' ? (
                    <EmptyState title={t('message.image.load_failed')} />
                ) : (
                    <EmptyState
                        title={t('dialog.screenshot_metadata.drag')}
                        description={t(
                            'view.tools.description.browse_for_a_screenshot_load_the_latest_screenshot_or_run_a_metadata_search'
                        )}
                    />
                )}
            </CardContent>
        </Card>
    );
}
