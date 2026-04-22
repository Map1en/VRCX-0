import {
    ArrowDownIcon,
    ArrowLeftIcon,
    ArrowRightIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    CameraIcon,
    CopyIcon,
    FolderOpenIcon,
    FolderSearchIcon,
    ImageIcon,
    SearchIcon,
    Trash2Icon,
    UploadIcon,
    UsersIcon
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { EmptyState as AppEmptyState } from '@/components/layout/PageScaffold.jsx';
import { Location } from '@/components/Location.jsx';
import { convertFileSrc } from '@/platform/tauri/index.js';
import {
    mediaRepository,
    userProfileRepository
} from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { withUploadTimeout } from '@/shared/utils/imageUpload.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
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
import { Spinner } from '@/ui/shadcn/spinner';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table';

import {
    buildScreenshotSearchRow,
    DEFAULT_SCREENSHOT_SEARCH_SORT,
    formatScreenshotBytes,
    formatScreenshotDateTime,
    getDroppedScreenshotPath,
    normalizeScreenshotMetadata,
    SCREENSHOT_METADATA_SEARCH_TYPES,
    sortScreenshotRowsByNewest,
    sortScreenshotSearchRows
} from './screenshotMetadataValues.js';
import { appI18n } from '@/services/i18nService.js';

function EmptyState({ title, description, loading = false }) {
    return (
        <AppEmptyState
            className="min-h-72"
            title={title}
            description={description}
            icon={loading ? Spinner : undefined}
        />
    );
}

function SearchSortHead({ label, sortKey, sort, onToggle }) {
    const active = sort?.key === sortKey;
    const Icon = active
        ? sort.asc
            ? ArrowUpIcon
            : ArrowDownIcon
        : ArrowUpDownIcon;

    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-auto justify-start px-0 py-0 text-left text-xs font-medium tracking-wide uppercase"
            onClick={() => onToggle(sortKey)}
        >
            <span>{label}</span>
            <Icon data-icon="inline-end" />
        </Button>
    );
}

function openSearchResult(
    row,
    { setSelectedPath, setSearchViewMode, loadScreenshot }
) {
    setSelectedPath(row.filePath);
    setSearchViewMode('detail');
    void loadScreenshot(row.filePath, false);
}

function MetadataAuthorLink({ author, endpoint }) {
    const userId = String(author?.id || '').trim();
    const hint = String(author?.displayName || '').trim();
    const [displayName, setDisplayName] = useState(hint || userId);

    useEffect(() => {
        let active = true;
        setDisplayName(hint || userId);
        if (!userId || hint) {
            return () => {
                active = false;
            };
        }

        userProfileRepository
            .getUserProfile({ userId, endpoint })
            .then((profile) => {
                if (active) {
                    setDisplayName(
                        profile?.displayName || profile?.username || userId
                    );
                }
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, [endpoint, hint, userId]);

    if (!userId) {
        return <div className="text-sm">{hint || '—'}</div>;
    }

    return (
        <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground hover:text-primary h-auto justify-start gap-1 p-0 text-left"
            title={userId}
            onClick={() =>
                openUserDialog({
                    userId,
                    title: displayName || userId
                })
            }
        >
            <CameraIcon data-icon="inline-start" />
            <span className="truncate">{displayName || userId}</span>
        </Button>
    );
}

export function ScreenshotMetadataPage() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const confirm = useModalStore((state) => state.confirm);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const isVrcPlusSupporter = Boolean(
        currentUserSnapshot?.$isVRCPlus ||
        currentUserSnapshot?.tags?.includes?.('system_supporter') ||
        globalThis?.$debug?.debugVrcPlus
    );
    const imageVersionRef = useRef(0);
    const metadataRequestRef = useRef(0);
    const searchRequestRef = useRef(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchType, setSearchType] = useState(
        SCREENSHOT_METADATA_SEARCH_TYPES[0].value
    );
    const [searchRows, setSearchRows] = useState([]);
    const [searchViewMode, setSearchViewMode] = useState('detail');
    const [searchSort, setSearchSort] = useState(
        DEFAULT_SCREENSHOT_SEARCH_SORT
    );
    const [selectedPath, setSelectedPath] = useState('');
    const [metadata, setMetadata] = useState(null);
    const [metadataError, setMetadataError] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [isMetadataLoading, setIsMetadataLoading] = useState(false);
    const [isSearchLoading, setIsSearchLoading] = useState(false);
    const [isDeletingMetadata, setIsDeletingMetadata] = useState(false);
    const [isUploadingScreenshot, setIsUploadingScreenshot] = useState(false);

    const currentSearchType = useMemo(
        () =>
            SCREENSHOT_METADATA_SEARCH_TYPES.find(
                (type) => type.value === searchType
            ) ?? SCREENSHOT_METADATA_SEARCH_TYPES[0],
        [searchType]
    );

    const sortedSearchRows = useMemo(
        () => sortScreenshotSearchRows(searchRows, searchSort),
        [searchRows, searchSort]
    );

    const searchNavigationPaths = useMemo(
        () => sortedSearchRows.map((row) => row.filePath),
        [sortedSearchRows]
    );

    function resetSearchContext({
        clearQuery = false,
        clearPreview = false
    } = {}) {
        setSearchRows([]);
        setSelectedPath('');

        if (clearQuery) {
            setSearchQuery('');
        }

        if (clearPreview) {
            setMetadata(null);
            setMetadataError('');
            setImageUrl('');
        }

        setSearchViewMode('detail');
    }

    async function loadScreenshot(path, withCarousel = true) {
        if (!path) {
            return;
        }

        const requestId = metadataRequestRef.current + 1;
        metadataRequestRef.current = requestId;
        setIsMetadataLoading(true);
        setMetadataError('');

        try {
            const rawMetadata =
                await mediaRepository.getScreenshotMetadata(path);

            if (metadataRequestRef.current !== requestId) {
                return;
            }

            if (!rawMetadata?.sourceFile) {
                const message = t('dialog.screenshot_metadata.invalid_file');
                setMetadata(null);
                setImageUrl('');
                setMetadataError(message);
                toast.error(message);
                return;
            }

            const extra = await mediaRepository.getExtraScreenshotData(
                rawMetadata.sourceFile,
                withCarousel
            );

            if (metadataRequestRef.current !== requestId) {
                return;
            }

            const nextMetadata = normalizeScreenshotMetadata(
                rawMetadata,
                extra
            );
            imageVersionRef.current += 1;

            setMetadata(nextMetadata);
            setMetadataError('');
            setSelectedPath(nextMetadata.filePath);
            setImageUrl(
                `${convertFileSrc(nextMetadata.filePath, 'vrcx-img')}?v=${imageVersionRef.current}`
            );
        } catch (error) {
            if (metadataRequestRef.current !== requestId) {
                return;
            }

            setMetadata(null);
            setImageUrl('');
            const message =
                error instanceof Error
                    ? error.message
                    : 'Failed to load screenshot metadata.';
            setMetadataError(message);
            toast.error(message);
        } finally {
            if (metadataRequestRef.current === requestId) {
                setIsMetadataLoading(false);
            }
        }
    }

    async function loadLastScreenshot() {
        try {
            resetSearchContext({ clearQuery: true });
            const path = await mediaRepository.getLastScreenshot();
            if (!path) {
                const message = t('dialog.screenshot_metadata.invalid_file');
                setMetadata(null);
                setImageUrl('');
                setMetadataError(message);
                toast.error(message);
                return;
            }
            await loadScreenshot(path, true);
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Failed to load last screenshot.';
            setMetadata(null);
            setImageUrl('');
            setMetadataError(message);
            toast.error(message);
        }
    }

    useEffect(() => {
        void loadLastScreenshot();
    }, []);

    useEffect(() => {
        function handleKeyDown(event) {
            if (!event.altKey) {
                return;
            }

            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                void navigatePrev();
            }

            if (event.key === 'ArrowRight') {
                event.preventDefault();
                void navigateNext();
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [metadata, searchNavigationPaths, selectedPath]);

    async function browseForScreenshot() {
        try {
            const defaultPath = await mediaRepository.getVrchatPhotosLocation();
            const filePath = await mediaRepository.openFileSelectorDialog(
                defaultPath || '',
                '.png',
                'PNG Files (*.png)|*.png'
            );

            if (!filePath) {
                return;
            }

            resetSearchContext({ clearQuery: true });
            await loadScreenshot(filePath, true);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.tools.generated_toast.failed_to_open_screenshot_picker')
            );
        }
    }

    async function openFolder() {
        if (!metadata?.filePath) {
            return;
        }

        try {
            await mediaRepository.openFolderAndSelectItem(
                metadata.filePath,
                false
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.tools.generated_toast.failed_to_open_folder')
            );
        }
    }

    async function copyImage() {
        if (!metadata?.filePath) {
            return;
        }

        try {
            await mediaRepository.copyImageToClipboard(metadata.filePath);
            toast.success(t('message.image.copied_to_clipboard'));
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : appI18n.t('view.tools.generated_toast.failed_to_copy_image')
            );
        }
    }

    async function deleteMetadata() {
        const filePath = metadata?.filePath || '';
        if (!filePath) {
            return;
        }

        const result = await confirm({
            title: t('dialog.screenshot_metadata.delete_metadata'),
            description: metadata?.fileName || filePath,
            confirmText: t('dialog.screenshot_metadata.delete_metadata'),
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        setIsDeletingMetadata(true);

        try {
            const deleted =
                await mediaRepository.deleteScreenshotMetadata(filePath);
            if (!deleted) {
                toast.error(t('message.screenshot_metadata.delete_failed'));
                return;
            }

            toast.success(t('message.screenshot_metadata.deleted'));
            await loadScreenshot(filePath, true);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('message.screenshot_metadata.delete_failed')
            );
        } finally {
            setIsDeletingMetadata(false);
        }
    }

    async function uploadScreenshotToGallery() {
        if (!metadata?.filePath) {
            return;
        }
        if (!isVrcPlusSupporter) {
            toast.error(t('message.vrcplus.required'));
            return;
        }
        if (Number(metadata.fileSizeBytes) > 10_000_000) {
            toast.error(t('message.file.too_large'));
            return;
        }

        setIsUploadingScreenshot(true);
        try {
            const base64Body = await mediaRepository.getFileBase64(
                metadata.filePath
            );
            await withUploadTimeout(
                mediaRepository.uploadGalleryImage(base64Body, {
                    endpoint: currentEndpoint
                })
            );
            toast.success(t('message.gallery.uploaded'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('message.gallery.failed')
            );
        } finally {
            setIsUploadingScreenshot(false);
        }
    }

    async function runSearch(
        nextSearchType = searchType,
        nextSearchQuery = searchQuery
    ) {
        const query = nextSearchQuery.trim();
        const selectedSearchType =
            SCREENSHOT_METADATA_SEARCH_TYPES.find(
                (type) => type.value === nextSearchType
            ) ?? SCREENSHOT_METADATA_SEARCH_TYPES[0];

        if (!query) {
            searchRequestRef.current += 1;
            resetSearchContext();
            if (metadata?.filePath) {
                await loadScreenshot(metadata.filePath, true);
            }
            return;
        }

        const requestId = searchRequestRef.current + 1;
        searchRequestRef.current = requestId;
        setIsSearchLoading(true);

        try {
            const paths = await mediaRepository.findScreenshotsBySearch(
                query,
                selectedSearchType.index
            );

            if (searchRequestRef.current !== requestId) {
                return;
            }

            if (!Array.isArray(paths) || paths.length === 0) {
                const message = t('dialog.screenshot_metadata.no_results');
                resetSearchContext({ clearPreview: true });
                setMetadataError(message);
                toast.error(message);
                return;
            }

            const rows = await Promise.all(
                paths.map(async (path) => {
                    try {
                        const [rawMetadata, extra] = await Promise.all([
                            mediaRepository.getScreenshotMetadata(path),
                            mediaRepository.getExtraScreenshotData(path, false)
                        ]);
                        const normalized = normalizeScreenshotMetadata(
                            rawMetadata ?? {},
                            extra ?? {}
                        );
                        return buildScreenshotSearchRow(
                            normalized,
                            selectedSearchType,
                            query
                        );
                    } catch (error) {
                        console.error(
                            'Failed to enrich screenshot search result:',
                            path,
                            error
                        );
                        return null;
                    }
                })
            );

            if (searchRequestRef.current !== requestId) {
                return;
            }

            const nextRows = sortScreenshotRowsByNewest(rows);

            setSearchRows(nextRows);
            setMetadataError('');
            setSelectedPath('');
            setSearchViewMode('table');
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Failed to search screenshot metadata.';
            setMetadata(null);
            setImageUrl('');
            setMetadataError(message);
            toast.error(message);
        } finally {
            if (searchRequestRef.current === requestId) {
                setIsSearchLoading(false);
            }
        }
    }

    function handleSearchTypeChange(value) {
        setSearchType(value);
        if (searchQuery.trim()) {
            setSearchRows([]);
            setSelectedPath('');
        }
        void runSearch(value);
    }

    function toggleSearchSort(key) {
        setSearchSort((current) => {
            if (current.key === key) {
                return {
                    ...current,
                    asc: !current.asc
                };
            }

            return {
                key,
                asc: key !== 'dateTime'
            };
        });
    }

    async function handleScreenshotDrop(event) {
        event.preventDefault();
        const filePath = getDroppedScreenshotPath(event);
        if (!filePath) {
            toast.error(t('view.tools.generated.dropped_screenshot_path_is_not_available'));
            return;
        }
        resetSearchContext({ clearQuery: true });
        await loadScreenshot(filePath, true);
    }

    function handleScreenshotDragOver(event) {
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
    }

    async function navigatePrev() {
        if (searchNavigationPaths.length && selectedPath) {
            const currentIndex = searchNavigationPaths.indexOf(selectedPath);
            if (currentIndex !== -1) {
                const prevIndex =
                    currentIndex > 0
                        ? currentIndex - 1
                        : searchNavigationPaths.length - 1;
                setSelectedPath(searchNavigationPaths[prevIndex]);
                await loadScreenshot(searchNavigationPaths[prevIndex], false);
                return;
            }
        }

        if (metadata?.previousFilePath) {
            await loadScreenshot(metadata.previousFilePath, true);
        }
    }

    async function navigateNext() {
        if (searchNavigationPaths.length && selectedPath) {
            const currentIndex = searchNavigationPaths.indexOf(selectedPath);
            if (currentIndex !== -1) {
                const nextIndex =
                    currentIndex < searchNavigationPaths.length - 1
                        ? currentIndex + 1
                        : 0;
                setSelectedPath(searchNavigationPaths[nextIndex]);
                await loadScreenshot(searchNavigationPaths[nextIndex], false);
                return;
            }
        }

        if (metadata?.nextFilePath) {
            await loadScreenshot(metadata.nextFilePath, true);
        }
    }

    return (
        <div className="screenshot-metadata-page x-container flex min-h-0 flex-1 flex-col overflow-hidden p-6">
            <div className="ml-2 flex items-center gap-2">
                <Button
                    variant="ghost"
                    size="sm"
                    className="mr-3"
                    onClick={() => navigate('/tools')}
                >
                    <ArrowLeftIcon data-icon="inline-start" />
                    {t('nav_tooltip.tools')}
                </Button>
                <span className="header">
                    {t('dialog.screenshot_metadata.header')}
                </span>
                {isDeletingMetadata ? (
                    <Badge variant="outline">{t('view.tools.generated.deleting_metadata')}</Badge>
                ) : null}
                {isUploadingScreenshot ? (
                    <Badge variant="outline">{t('view.tools.generated.uploading_screenshot')}</Badge>
                ) : null}
            </div>

            <div className="my-2 flex flex-col gap-3 xl:flex-row xl:items-center">
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void browseForScreenshot()}
                    >
                        <FolderSearchIcon data-icon="inline-start" />
                        {t('dialog.screenshot_metadata.browse')}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void loadLastScreenshot()}
                    >
                        <ImageIcon data-icon="inline-start" />
                        {t('dialog.screenshot_metadata.last_screenshot')}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={!metadata?.filePath}
                        onClick={() => void openFolder()}
                    >
                        <FolderOpenIcon data-icon="inline-start" />
                        {t('dialog.screenshot_metadata.open_folder')}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={!metadata?.filePath}
                        onClick={() => void copyImage()}
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
                        onClick={() => void uploadScreenshotToGallery()}
                    >
                        <UploadIcon data-icon="inline-start" />
                        {t('dialog.screenshot_metadata.upload')}
                    </Button>
                    <Button
                        variant="destructive"
                        size="sm"
                        disabled={!metadata?.filePath || isDeletingMetadata}
                        onClick={() => void deleteMetadata()}
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
                            onChange={(event) =>
                                setSearchQuery(event.target.value)
                            }
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void runSearch();
                                }
                            }}
                        />
                    </InputGroup>
                    <Select
                        value={searchType}
                        onValueChange={handleSearchTypeChange}
                    >
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
                    <Button onClick={() => void runSearch()}>{t('common.actions.search')}</Button>
                    {searchViewMode === 'table' && searchRows.length ? (
                        <span className="text-xs whitespace-pre-wrap">
                            {t('dialog.screenshot_metadata.result_count', {
                                count: searchRows.length
                            })}
                        </span>
                    ) : searchNavigationPaths.length && selectedPath ? (
                        <span className="text-xs whitespace-pre-wrap">
                            {searchNavigationPaths.indexOf(selectedPath) + 1}/
                            {searchNavigationPaths.length}
                        </span>
                    ) : null}
                </div>
            </div>

            {searchViewMode === 'table' ? (
                <div className="min-h-0 flex-1 overflow-auto">
                    {isSearchLoading ? (
                        <EmptyState
                            loading
                            title={t('view.tools.generated.searching_screenshots')}
                            description={t('view.tools.generated.resolving_file_list_and_metadata_summaries')}
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
                                            onToggle={toggleSearchSort}
                                        />
                                    </TableHead>
                                    <TableHead>
                                        <SearchSortHead
                                            label={t(
                                                'dialog.screenshot_metadata.col_world'
                                            )}
                                            sortKey="world"
                                            sort={searchSort}
                                            onToggle={toggleSearchSort}
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
                                                onToggle={toggleSearchSort}
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
                                            onToggle={toggleSearchSort}
                                        />
                                    </TableHead>
                                    <TableHead>
                                        <SearchSortHead
                                            label={t(
                                                'dialog.screenshot_metadata.col_players'
                                            )}
                                            sortKey="playerCount"
                                            sort={searchSort}
                                            onToggle={toggleSearchSort}
                                        />
                                    </TableHead>
                                    <TableHead>
                                        {t(
                                            'dialog.screenshot_metadata.col_resolution'
                                        )}
                                    </TableHead>
                                    <TableHead className="w-8" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedSearchRows.map((row) => (
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
                                                aria-label={`Open screenshot ${row.dateLabel || row.fileName || row.filePath}`}
                                                onClick={() =>
                                                    openSearchResult(row, {
                                                        setSelectedPath,
                                                        setSearchViewMode,
                                                        loadScreenshot
                                                    })
                                                }
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
            ) : (
                <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_380px]">
                    <Card className="flex min-h-0 flex-col">
                        <CardHeader>
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex flex-col gap-1">
                                    <CardTitle>{t('view.tools.generated.preview')}</CardTitle>
                                    <CardDescription>
                                        {metadata?.fileName ||
                                            t(
                                                'dialog.screenshot_metadata.drag'
                                            )}
                                    </CardDescription>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void navigatePrev()}
                                    >
                                        <ArrowLeftIcon data-icon="inline-start" />
                                        {t('view.tools.generated.prev')}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void navigateNext()}
                                    >
                                        {t('table.pagination.next')}
                                        <ArrowRightIcon data-icon="inline-end" />
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent
                            className="flex min-h-0 flex-1 items-center justify-center"
                            onDragOver={handleScreenshotDragOver}
                            onDragEnter={handleScreenshotDragOver}
                            onDrop={(event) => void handleScreenshotDrop(event)}
                        >
                            {isMetadataLoading ? (
                                <EmptyState
                                    loading
                                    title={t('view.tools.generated.loading_screenshot')}
                                    description={t('view.tools.generated.fetching_embedded_metadata_and_file_details')}
                                />
                            ) : imageUrl ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-auto w-full p-0"
                                    onClick={() =>
                                        openImagePreview({
                                            url: imageUrl,
                                            title:
                                                metadata?.fileName ||
                                                'Screenshot preview',
                                            fileName: metadata?.fileName || '',
                                            sourcePath: metadata?.filePath || ''
                                        })
                                    }
                                >
                                    <img
                                        src={imageUrl}
                                        alt={
                                            metadata?.fileName ||
                                            'Screenshot preview'
                                        }
                                        className="max-h-[70vh] w-full rounded-lg object-contain"
                                    />
                                </Button>
                            ) : (
                                <EmptyState
                                    title={t('dialog.screenshot_metadata.drag')}
                                    description={t('view.tools.generated.browse_for_a_screenshot_load_the_latest_screenshot_or_run_a_')}
                                />
                            )}
                        </CardContent>
                    </Card>

                    <Card className="flex min-h-0 flex-col">
                        <CardHeader>
                            <CardTitle>{t('view.tools.generated.details')}</CardTitle>
                            <CardDescription>
                                {t('view.tools.generated.metadata_extracted_from_the_selected_vrchat_screenshot')}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-6 overflow-y-auto">
                            {searchRows.length ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="mb-2"
                                    onClick={() => setSearchViewMode('table')}
                                >
                                    <ArrowLeftIcon data-icon="inline-start" />
                                    {t(
                                        'dialog.screenshot_metadata.back_to_results',
                                        {
                                            count: searchRows.length
                                        }
                                    )}
                                </Button>
                            ) : null}
                            {metadataError ? (
                                <pre className="text-muted-foreground text-xs whitespace-pre-wrap">
                                    {metadataError}
                                </pre>
                            ) : metadata ? (
                                <>
                                    <section className="flex flex-col gap-2">
                                        <div className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
                                            {t(
                                                'dialog.screenshot_metadata.section_location'
                                            )}
                                        </div>
                                        {metadata.world?.instanceId ||
                                        metadata.world?.id ? (
                                            <Location
                                                location={
                                                    metadata.world
                                                        ?.instanceId ||
                                                    metadata.world?.id
                                                }
                                                hint={
                                                    metadata.world?.name || ''
                                                }
                                                enableContextMenu
                                                showLaunchActions
                                            />
                                        ) : (
                                            <div className="text-sm">
                                                {metadata.world?.name || '—'}
                                            </div>
                                        )}
                                        <MetadataAuthorLink
                                            author={metadata.author}
                                            endpoint={currentEndpoint}
                                        />
                                    </section>

                                    <section className="flex flex-col gap-2 border-t pt-4">
                                        <div className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
                                            {t(
                                                'dialog.screenshot_metadata.section_players'
                                            )}{' '}
                                            ({metadata.players.length})
                                        </div>
                                        {metadata.players.length ? (
                                            <div className="flex flex-wrap gap-2">
                                                {metadata.players.map(
                                                    (player) => {
                                                        const playerLabel =
                                                            player.displayName ||
                                                            player.id ||
                                                            'Unknown player';
                                                        const playerContent = (
                                                            <>
                                                                <UsersIcon data-icon="inline-start" />
                                                                {playerLabel}
                                                            </>
                                                        );

                                                        return player.id ? (
                                                            <Button
                                                                key={`${player.id}-${player.displayName}`}
                                                                variant="secondary"
                                                                size="xs"
                                                                type="button"
                                                                className="rounded-full"
                                                                onClick={() =>
                                                                    openUserDialog(
                                                                        {
                                                                            userId: player.id,
                                                                            title: playerLabel
                                                                        }
                                                                    )
                                                                }
                                                            >
                                                                {playerContent}
                                                            </Button>
                                                        ) : (
                                                            <Badge
                                                                key={`${player.id}-${player.displayName}`}
                                                                variant="secondary"
                                                            >
                                                                {playerContent}
                                                            </Badge>
                                                        );
                                                    }
                                                )}
                                            </div>
                                        ) : (
                                            <div className="text-muted-foreground text-sm">
                                                {t('view.tools.generated.no_player_metadata')}
                                            </div>
                                        )}
                                    </section>

                                    <section className="flex flex-col gap-2 border-t pt-4">
                                        <div className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
                                            {t(
                                                'dialog.screenshot_metadata.section_file_info'
                                            )}
                                        </div>
                                        <div className="text-sm">
                                            {formatScreenshotDateTime(
                                                metadata.dateTime
                                            )}
                                        </div>
                                        <div className="text-muted-foreground text-sm">
                                            {[
                                                metadata.resolution,
                                                formatScreenshotBytes(
                                                    metadata.fileSizeBytes
                                                )
                                            ]
                                                .filter(Boolean)
                                                .join(' · ') || '—'}
                                        </div>
                                        <div className="text-muted-foreground text-xs break-all">
                                            {metadata.fileName ||
                                                metadata.filePath}
                                        </div>
                                    </section>

                                    {metadata.note ? (
                                        <section className="flex flex-col gap-2 border-t pt-4">
                                            <div className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
                                                {t(
                                                    'dialog.screenshot_metadata.section_note'
                                                )}
                                            </div>
                                            <div className="text-muted-foreground text-sm">
                                                {metadata.note}
                                            </div>
                                        </section>
                                    ) : null}

                                    {metadata.application ? (
                                        <section className="flex flex-col gap-2 border-t pt-4">
                                            <div className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
                                                {t('view.settings.general.application.header')}
                                            </div>
                                            <div className="text-muted-foreground text-sm">
                                                {metadata.application}
                                            </div>
                                        </section>
                                    ) : null}
                                </>
                            ) : (
                                <EmptyState
                                    title={t('view.tools.generated.no_screenshot_selected')}
                                    description={t('view.tools.generated.load_a_screenshot_to_inspect_embedded_world_player_and_file_')}
                                />
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
