import {
    ArrowLeftIcon,
    ArrowRightIcon,
    CopyIcon,
    FolderOpenIcon,
    SearchIcon,
    Trash2Icon,
    UploadIcon,
    UsersIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { KeyboardShortcut } from '@/components/keyboard/KeyboardShortcut';
import {
    PageBackButton,
    PageHeader,
    PageToolbar,
    PageToolbarRow,
    PageTitle
} from '@/components/layout/PageScaffold';
import { Badge } from '@/ui/shadcn/badge';
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table';

import { SCREENSHOT_METADATA_SEARCH_TYPES } from '../screenshotMetadataValues';
import { EmptyState, SearchSortHead } from './ScreenshotMetadataParts';

export { ScreenshotMetadataDetailsCard } from './ScreenshotMetadataDetailsCard';

export function ScreenshotMetadataHeader({
    backLabel,
    title,
    deleting,
    uploading,
    deletingLabel,
    uploadingLabel,
    onBack
}: any) {
    return (
        <PageToolbar>
            <PageToolbarRow className="items-center">
                <PageBackButton label={backLabel} onClick={onBack} />
                <PageHeader className="min-w-0 p-0">
                    <PageTitle>{title}</PageTitle>
                </PageHeader>
                {deleting ? (
                    <Badge variant="outline">{deletingLabel}</Badge>
                ) : null}
                {uploading ? (
                    <Badge variant="outline">{uploadingLabel}</Badge>
                ) : null}
            </PageToolbarRow>
        </PageToolbar>
    );
}

export function ScreenshotMetadataToolbar({
    metadata,
    isVrcPlusSupporter,
    isUploadingScreenshot,
    isDeletingMetadata,
    searchQuery,
    searchType,
    searchViewMode,
    searchRowsCount,
    searchNavigationCount,
    selectedPathIndex,
    onSearchQueryChange,
    onSearchTypeChange,
    onSearch,
    onOpenFolder,
    onCopyImage,
    onUpload,
    onDelete
}: any) {
    const { t } = useTranslation();

    return (
        <div className="my-2 flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="flex flex-wrap gap-2">
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
                    variant="destructive"
                    size="sm"
                    disabled={!metadata?.filePath || isDeletingMetadata}
                    onClick={onDelete}
                >
                    <Trash2Icon data-icon="inline-start" />
                    {t('dialog.screenshot_metadata.delete_metadata')}
                </Button>
            </div>

            <div className="flex flex-1 flex-col gap-2 lg:flex-row xl:justify-end">
                <InputGroup className="min-w-0 flex-1 xl:max-w-sm">
                    <InputGroupAddon>
                        <SearchIcon />
                    </InputGroupAddon>
                    <InputGroupInput
                        value={searchQuery}
                        placeholder={t(
                            'dialog.screenshot_metadata.search_placeholder'
                        )}
                        onChange={(event: any) =>
                            onSearchQueryChange(event.target.value)
                        }
                        onKeyDown={(event: any) => {
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
                <Select value={searchType} onValueChange={onSearchTypeChange}>
                    <SelectTrigger className="w-full lg:w-52">
                        <SelectValue
                            placeholder={t(
                                'dialog.screenshot_metadata.search_type_placeholder'
                            )}
                        />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {SCREENSHOT_METADATA_SEARCH_TYPES.map(
                                (type: any) => (
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
                <Button onClick={onSearch}>{t('common.actions.search')}</Button>
                {searchViewMode === 'table' && searchRowsCount ? (
                    <span className="text-xs whitespace-pre-wrap">
                        {t('dialog.screenshot_metadata.result_count', {
                            count: searchRowsCount
                        })}
                    </span>
                ) : searchNavigationCount && selectedPathIndex >= 0 ? (
                    <span className="text-xs whitespace-pre-wrap">
                        {selectedPathIndex + 1}/{searchNavigationCount}
                    </span>
                ) : null}
            </div>
        </div>
    );
}

export function ScreenshotMetadataResultsTable({
    isSearchLoading,
    currentSearchType,
    searchSort,
    sortedSearchRows,
    selectedPath,
    onToggleSearchSort,
    onOpenResult
}: any) {
    const { t } = useTranslation();

    return (
        <div className="min-h-0 flex-1 overflow-auto">
            {isSearchLoading ? (
                <EmptyState
                    loading
                    title={t('view.tools.loading.searching_screenshots')}
                    description={t(
                        'view.tools.loading.resolving_file_list_and_metadata_summaries'
                    )}
                />
            ) : (
                <Table className="app-data-table">
                    <TableHeader>
                        <TableRow>
                            <TableHead>
                                <SearchSortHead
                                    label={t(
                                        'dialog.screenshot_metadata.col_date'
                                    )}
                                    sortKey="dateTime"
                                    sort={searchSort}
                                    onToggle={onToggleSearchSort}
                                />
                            </TableHead>
                            <TableHead>
                                <SearchSortHead
                                    label={t(
                                        'dialog.screenshot_metadata.col_world'
                                    )}
                                    sortKey="world"
                                    sort={searchSort}
                                    onToggle={onToggleSearchSort}
                                />
                            </TableHead>
                            {currentSearchType.index <= 1 ? (
                                <TableHead>
                                    <SearchSortHead
                                        label={t(
                                            'dialog.screenshot_metadata.col_match'
                                        )}
                                        sortKey="match"
                                        sort={searchSort}
                                        onToggle={onToggleSearchSort}
                                    />
                                </TableHead>
                            ) : null}
                            <TableHead>
                                <SearchSortHead
                                    label={t(
                                        'dialog.screenshot_metadata.col_author'
                                    )}
                                    sortKey="author"
                                    sort={searchSort}
                                    onToggle={onToggleSearchSort}
                                />
                            </TableHead>
                            <TableHead>
                                <SearchSortHead
                                    label={t(
                                        'dialog.screenshot_metadata.col_players'
                                    )}
                                    sortKey="playerCount"
                                    sort={searchSort}
                                    onToggle={onToggleSearchSort}
                                />
                            </TableHead>
                            <TableHead>
                                {t('dialog.screenshot_metadata.col_resolution')}
                            </TableHead>
                            <TableHead className="w-8" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sortedSearchRows.map((row: any) => (
                            <TableRow
                                key={row.filePath}
                                data-state={
                                    row.filePath === selectedPath
                                        ? 'selected'
                                        : undefined
                                }
                            >
                                <TableCell>{row.dateLabel}</TableCell>
                                <TableCell>{row.world}</TableCell>
                                {currentSearchType.index <= 1 ? (
                                    <TableCell>{row.match}</TableCell>
                                ) : null}
                                <TableCell>{row.author}</TableCell>
                                <TableCell>
                                    <span className="inline-flex items-center gap-1">
                                        <UsersIcon className="text-muted-foreground size-3" />
                                        {row.playerCount}
                                    </span>
                                </TableCell>
                                <TableCell>{row.resolution}</TableCell>
                                <TableCell className="text-right">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={t('common.actions.open')}
                                        onClick={() => onOpenResult(row)}
                                    >
                                        <ArrowRightIcon data-icon="inline-start" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </div>
    );
}

export function ScreenshotMetadataPreviewCard({
    metadata,
    imageUrl,
    isMetadataLoading,
    onNavigatePrev,
    onNavigateNext,
    onImagePreview,
    onDragOver,
    onDrop
}: any) {
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
                            onClick={onNavigatePrev}
                        >
                            <ArrowLeftIcon data-icon="inline-start" />
                            {t('view.tools.label.prev')}
                            <KeyboardShortcut keys={['Alt', 'ArrowLeft']} />
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onNavigateNext}
                        >
                            {t('table.pagination.next')}
                            <KeyboardShortcut keys={['Alt', 'ArrowRight']} />
                            <ArrowRightIcon data-icon="inline-end" />
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
                            className="max-h-[70vh] w-full rounded-lg object-contain"
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
