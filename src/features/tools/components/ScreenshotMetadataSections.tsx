import {
    ArrowLeftIcon,
    ArrowRightIcon,
    CopyIcon,
    FolderOpenIcon,
    LayoutGridIcon,
    ListIcon,
    PanelRightCloseIcon,
    PanelRightOpenIcon,
    SearchIcon,
    Trash2Icon,
    UploadIcon,
    UsersIcon,
    XIcon
} from 'lucide-react';
import type { DragEvent } from 'react';
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
import { KeyboardShortcut } from '@/components/keyboard/KeyboardShortcut';
import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import {
    ToolbarActions,
    ToolbarSegmented,
    ToolbarStatus,
    ToolbarViews
} from '@/components/layout/ToolbarControls';
import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Table, TableBody, TableHeader } from '@/ui/shadcn/table';

import {
    SCREENSHOT_METADATA_SEARCH_TYPES,
    type NormalizedScreenshotMetadata,
    type ScreenshotMetadataSearchType,
    type ScreenshotSearchRow,
    type ScreenshotSearchSort
} from '../screenshotMetadataValues';
import type { ScreenshotSearchLayout } from '../useScreenshotMetadataSearch';
import { EmptyState, SearchSortHead } from './ScreenshotMetadataParts';

export { ScreenshotMetadataDetailsCard } from './ScreenshotMetadataDetailsCard';

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
    onDeleteFile
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
    searchQuery,
    searchType,
    searchLayout,
    showResultControls,
    searchRowsCount,
    searchNavigationCount,
    selectedPathIndex,
    onSearchQueryChange,
    onSearchTypeChange,
    onSearch,
    onSearchLayoutChange,
    onClearSearch
}: {
    searchQuery: string;
    searchType: ScreenshotMetadataSearchType['value'];
    searchLayout: ScreenshotSearchLayout;
    showResultControls: boolean;
    searchRowsCount: number;
    searchNavigationCount: number;
    selectedPathIndex: number;
    onSearchQueryChange: (value: string) => void;
    onSearchTypeChange: (value: string | null) => void;
    onSearch: () => void;
    onSearchLayoutChange: (layout: ScreenshotSearchLayout) => void;
    onClearSearch: () => void;
}) {
    const { t } = useTranslation();

    return (
        <PageToolbar>
            <PageToolbarRow>
                <ToolbarViews className="min-w-0 flex-wrap">
                    {showResultControls ? (
                        <>
                            {searchRowsCount > 0 ? (
                                <ToolbarStatus>
                                    {t(
                                        'dialog.screenshot_metadata.result_count',
                                        {
                                            count: searchRowsCount
                                        }
                                    )}
                                </ToolbarStatus>
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
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={onClearSearch}
                            >
                                <XIcon data-icon="inline-start" />
                                {t('dialog.screenshot_metadata.clear_search')}
                            </Button>
                        </>
                    ) : searchNavigationCount && selectedPathIndex >= 0 ? (
                        <ToolbarStatus>
                            {selectedPathIndex + 1}/{searchNavigationCount}
                        </ToolbarStatus>
                    ) : null}
                </ToolbarViews>

                <ToolbarActions className="w-full max-w-full flex-wrap justify-end sm:ml-auto sm:w-auto">
                    <InputGroup className="min-w-48 flex-1 sm:w-72 sm:flex-none">
                        <InputGroupAddon>
                            <SearchIcon />
                        </InputGroupAddon>
                        <InputGroupInput
                            value={searchQuery}
                            placeholder={t(
                                'dialog.screenshot_metadata.search_placeholder'
                            )}
                            aria-label={t(
                                'dialog.screenshot_metadata.search_placeholder'
                            )}
                            onChange={(event) =>
                                onSearchQueryChange(event.target.value)
                            }
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    onSearch();
                                }
                            }}
                        />
                        <InputGroupAddon align="inline-end">
                            <KeyboardShortcut keys="Enter" />
                        </InputGroupAddon>
                    </InputGroup>
                    <Select
                        value={searchType}
                        items={SCREENSHOT_METADATA_SEARCH_TYPES.map((type) => ({
                            value: type.value,
                            label: t(type.labelKey)
                        }))}
                        onValueChange={onSearchTypeChange}
                    >
                        <SelectTrigger className="w-full sm:w-52">
                            <SelectValue
                                placeholder={t(
                                    'dialog.screenshot_metadata.search_type_placeholder'
                                )}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {SCREENSHOT_METADATA_SEARCH_TYPES.map(
                                    (type) => (
                                        <SelectItem
                                            key={type.value}
                                            value={type.value}
                                        >
                                            {t(type.labelKey)}
                                        </SelectItem>
                                    )
                                )}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <Button onClick={onSearch}>
                        {t('common.actions.search')}
                    </Button>
                </ToolbarActions>
            </PageToolbarRow>
        </PageToolbar>
    );
}

export function ScreenshotMetadataResultsTable({
    currentSearchType,
    searchSort,
    sortedSearchRows,
    selectedPath,
    onToggleSearchSort,
    onOpenResult
}: {
    currentSearchType: ScreenshotMetadataSearchType;
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
                        {currentSearchType.index <= 1 ? (
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
                            {currentSearchType.index <= 1 ? (
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
    isMetadataLoading,
    canNavigatePrev,
    canNavigateNext,
    isDetailsVisible,
    onNavigatePrev,
    onNavigateNext,
    onToggleDetails,
    onImagePreview,
    onDragOver,
    onDrop
}: {
    metadata: NormalizedScreenshotMetadata | null;
    imageUrl: string;
    isMetadataLoading: boolean;
    canNavigatePrev: boolean;
    canNavigateNext: boolean;
    isDetailsVisible: boolean;
    onNavigatePrev: () => void;
    onNavigateNext: () => void;
    onToggleDetails: () => void;
    onImagePreview: () => void;
    onDragOver: (event: DragEvent<HTMLDivElement>) => void;
    onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
    const { t } = useTranslation();

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
            <CardContent
                className="flex min-h-0 flex-1 items-center justify-center"
                onDragOver={onDragOver}
                onDragEnter={onDragOver}
                onDrop={onDrop}
            >
                {isMetadataLoading && !imageUrl ? (
                    <EmptyState
                        loading
                        title={t('view.tools.loading.loading_screenshot')}
                        description={t(
                            'view.tools.loading.fetching_embedded_metadata_and_file_details'
                        )}
                    />
                ) : imageUrl ? (
                    <Button
                        type="button"
                        variant="ghost"
                        className="h-auto w-full p-0"
                        onClick={onImagePreview}
                    >
                        <img
                            src={imageUrl}
                            alt={metadata?.fileName || 'Screenshot preview'}
                            className="max-h-[70vh] w-full rounded-lg object-contain transition-none"
                        />
                    </Button>
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
