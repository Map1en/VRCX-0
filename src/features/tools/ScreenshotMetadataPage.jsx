import { useEffect, useMemo, useRef, useState } from 'react';
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
    LoaderCircleIcon,
    SearchIcon,
    Trash2Icon,
    UploadIcon,
    UsersIcon
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Location } from '@/components/Location.jsx';
import { useI18n } from '@/app/hooks/use-i18n.js';
import { convertFileSrc } from '@/platform/tauri/index.js';
import { mediaRepository, userProfileRepository } from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { withUploadTimeout } from '@/shared/utils/imageUpload.js';
import { parseVrchatScreenshotDateFromFileName } from '@/shared/utils/screenshot.js';
import { Badge } from '@/ui/shadcn/badge.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card.jsx';
import { Input } from '@/ui/shadcn/input.jsx';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select.jsx';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table.jsx';

const searchTypes = [
    {
        value: 'Player Name',
        index: 0,
        labelKey: 'dialog.screenshot_metadata.search_types.player_name'
    },
    {
        value: 'Player ID',
        index: 1,
        labelKey: 'dialog.screenshot_metadata.search_types.player_id'
    },
    {
        value: 'World Name',
        index: 2,
        labelKey: 'dialog.screenshot_metadata.search_types.world_name'
    },
    {
        value: 'World ID',
        index: 3,
        labelKey: 'dialog.screenshot_metadata.search_types.world_id'
    }
];

const DEFAULT_SEARCH_SORT = {
    key: 'dateTime',
    asc: false
};

function normalizeDroppedFilePath(value) {
    const text = String(value || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);

    if (!text) {
        return '';
    }

    if (text.startsWith('file://')) {
        try {
            const url = new URL(text);
            const pathname = decodeURIComponent(url.pathname);
            return /^[A-Za-z]:/.test(pathname.slice(1)) ? pathname.slice(1) : pathname;
        } catch {
            return text;
        }
    }

    return text;
}

function getDroppedScreenshotPath(event) {
    const file = event.dataTransfer?.files?.[0] || null;
    const filePath = file?.path || file?.webkitRelativePath || '';
    if (filePath) {
        return filePath;
    }

    return normalizeDroppedFilePath(
        event.dataTransfer?.getData('text/uri-list') ||
            event.dataTransfer?.getData('text/plain') ||
            ''
    );
}

function getSearchSortValue(row, key) {
    if (key === 'dateTime') {
        return row?.dateTime?.getTime?.() ?? 0;
    }
    if (key === 'playerCount') {
        return Number(row?.playerCount) || 0;
    }
    return String(row?.[key] || '').toLowerCase();
}

function sortScreenshotSearchRows(rows, sort) {
    const sortKey = sort?.key || DEFAULT_SEARCH_SORT.key;
    const direction = sort?.asc ? 1 : -1;
    return [...rows].sort((left, right) => {
        const leftValue = getSearchSortValue(left, sortKey);
        const rightValue = getSearchSortValue(right, sortKey);
        if (leftValue < rightValue) {
            return -1 * direction;
        }
        if (leftValue > rightValue) {
            return 1 * direction;
        }
        const leftTime = left?.dateTime?.getTime?.() ?? 0;
        const rightTime = right?.dateTime?.getTime?.() ?? 0;
        return rightTime - leftTime;
    });
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    const precision = size >= 100 || unitIndex === 0 ? 0 : 1;
    return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function formatDateTime(value) {
    if (!value) {
        return '—';
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
}

function getFileNameFromPath(path) {
    return String(path || '')
        .split(/[\\/]/)
        .filter(Boolean)
        .at(-1) || '';
}

function resolveMetadataDate(metadata, extra, fileName) {
    if (metadata?.timestamp) {
        const parsed = Date.parse(metadata.timestamp);
        if (Number.isFinite(parsed)) {
            return new Date(parsed);
        }
    }

    const fileNameTimestamp = parseVrchatScreenshotDateFromFileName(fileName);
    if (Number.isFinite(fileNameTimestamp)) {
        return new Date(fileNameTimestamp);
    }

    if (extra?.creationDate) {
        const parsed = Date.parse(extra.creationDate);
        if (Number.isFinite(parsed)) {
            return new Date(parsed);
        }
    }

    return null;
}

function normalizeMetadata(metadata, extra) {
    const fileName =
        extra?.fileName || getFileNameFromPath(extra?.filePath || metadata?.sourceFile);
    const dateTime = resolveMetadataDate(metadata, extra, fileName);

    return {
        filePath: extra?.filePath || metadata?.sourceFile || '',
        fileName,
        previousFilePath: extra?.previousFilePath || '',
        nextFilePath: extra?.nextFilePath || '',
        resolution: extra?.resolution || '',
        fileSizeBytes: extra?.fileSizeBytes ?? 0,
        dateTime,
        world: metadata?.world ?? {},
        author: metadata?.author ?? {},
        players: Array.isArray(metadata?.players) ? metadata.players : [],
        note: metadata?.note || '',
        application: metadata?.application || ''
    };
}

function EmptyState({ title, description, loading = false }) {
    return (
        <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6 text-center">
            <div className="max-w-sm space-y-2">
                {loading ? (
                    <div className="flex justify-center">
                        <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" />
                    </div>
                ) : null}
                <div className="text-sm font-medium">{title}</div>
                <div className="text-sm text-muted-foreground">{description}</div>
            </div>
        </div>
    );
}

function SearchSortHead({ label, sortKey, sort, onToggle }) {
    const active = sort?.key === sortKey;
    const Icon = active ? (sort.asc ? ArrowUpIcon : ArrowDownIcon) : ArrowUpDownIcon;

    return (
        <button
            type="button"
            className="inline-flex items-center gap-1 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
            onClick={() => onToggle(sortKey)}>
            <span>{label}</span>
            <Icon className="size-3.5" />
        </button>
    );
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
                    setDisplayName(profile?.displayName || profile?.username || userId);
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
        <button
            type="button"
            className="flex items-center gap-1 text-left text-sm text-muted-foreground hover:underline"
            title={userId}
            onClick={() =>
                openUserDialog({
                    userId,
                    title: displayName || userId
                })
            }>
            <CameraIcon className="size-3.5 shrink-0" />
            <span className="truncate">{displayName || userId}</span>
        </button>
    );
}

export function ScreenshotMetadataPage() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const confirm = useModalStore((state) => state.confirm);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentUserSnapshot = useRuntimeStore((state) => state.auth.currentUserSnapshot);
    const isVrcPlusSupporter = Boolean(
        currentUserSnapshot?.$isVRCPlus ||
            currentUserSnapshot?.tags?.includes?.('system_supporter') ||
            globalThis?.$debug?.debugVrcPlus
    );
    const imageVersionRef = useRef(0);
    const metadataRequestRef = useRef(0);
    const searchRequestRef = useRef(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchType, setSearchType] = useState(searchTypes[0].value);
    const [searchRows, setSearchRows] = useState([]);
    const [searchViewMode, setSearchViewMode] = useState('detail');
    const [searchSort, setSearchSort] = useState(DEFAULT_SEARCH_SORT);
    const [selectedPath, setSelectedPath] = useState('');
    const [metadata, setMetadata] = useState(null);
    const [metadataError, setMetadataError] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [isMetadataLoading, setIsMetadataLoading] = useState(false);
    const [isSearchLoading, setIsSearchLoading] = useState(false);
    const [isDeletingMetadata, setIsDeletingMetadata] = useState(false);
    const [isUploadingScreenshot, setIsUploadingScreenshot] = useState(false);

    const currentSearchType = useMemo(
        () => searchTypes.find((type) => type.value === searchType) ?? searchTypes[0],
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

    function resetSearchContext({ clearQuery = false, clearPreview = false } = {}) {
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
            const rawMetadata = await mediaRepository.getScreenshotMetadata(path);

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

            const nextMetadata = normalizeMetadata(rawMetadata, extra);
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
            const message = error instanceof Error ? error.message : 'Failed to load screenshot metadata.';
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
            const message = error instanceof Error ? error.message : 'Failed to load last screenshot.';
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
                error instanceof Error ? error.message : 'Failed to open screenshot picker.'
            );
        }
    }

    async function openFolder() {
        if (!metadata?.filePath) {
            return;
        }

        try {
            await mediaRepository.openFolderAndSelectItem(metadata.filePath, false);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to open folder.');
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
            toast.error(error instanceof Error ? error.message : 'Failed to copy image.');
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
            cancelText: 'Cancel',
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        setIsDeletingMetadata(true);

        try {
            const deleted = await mediaRepository.deleteScreenshotMetadata(filePath);
            if (!deleted) {
                toast.error(t('message.screenshot_metadata.delete_failed'));
                return;
            }

            toast.success(t('message.screenshot_metadata.deleted'));
            await loadScreenshot(filePath, true);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t('message.screenshot_metadata.delete_failed'));
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
            const base64Body = await mediaRepository.getFileBase64(metadata.filePath);
            await withUploadTimeout(
                mediaRepository.uploadGalleryImage(base64Body, { endpoint: currentEndpoint })
            );
            toast.success(t('message.gallery.uploaded'));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t('message.gallery.failed'));
        } finally {
            setIsUploadingScreenshot(false);
        }
    }

    async function runSearch(nextSearchType = searchType, nextSearchQuery = searchQuery) {
        const query = nextSearchQuery.trim();
        const selectedSearchType =
            searchTypes.find((type) => type.value === nextSearchType) ?? searchTypes[0];

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
                        const normalized = normalizeMetadata(rawMetadata ?? {}, extra ?? {});

                        let match = '';
                        if (selectedSearchType.index === 0) {
                            const hits = normalized.players
                                .filter((player) =>
                                    String(player.displayName || '')
                                        .toLowerCase()
                                        .includes(query.toLowerCase())
                                )
                                .map((player) => player.displayName);
                            match = hits.join(', ');
                        } else if (selectedSearchType.index === 1) {
                            match =
                                normalized.players.find((player) => player.id === query)
                                    ?.displayName || '';
                        }

                        return {
                            filePath: normalized.filePath,
                            dateTime: normalized.dateTime,
                            dateLabel: formatDateTime(normalized.dateTime),
                            world: normalized.world?.name || '—',
                            author: normalized.author?.displayName || '—',
                            playerCount: normalized.players.length,
                            resolution: normalized.resolution || '—',
                            match: match || '—'
                        };
                    } catch (error) {
                        console.error('Failed to enrich screenshot search result:', path, error);
                        return null;
                    }
                })
            );

            if (searchRequestRef.current !== requestId) {
                return;
            }

            const nextRows = rows.filter(Boolean).sort((left, right) => {
                const leftTime = left?.dateTime?.getTime?.() ?? 0;
                const rightTime = right?.dateTime?.getTime?.() ?? 0;
                return rightTime - leftTime;
            });

            setSearchRows(nextRows);
            setMetadataError('');
            setSelectedPath('');
            setSearchViewMode('table');
        } catch (error) {
            const message = error instanceof Error
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
            toast.error('Dropped screenshot path is not available.');
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
                const prevIndex = currentIndex > 0 ? currentIndex - 1 : searchNavigationPaths.length - 1;
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
                const nextIndex = currentIndex < searchNavigationPaths.length - 1 ? currentIndex + 1 : 0;
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
                <Button variant="ghost" size="sm" className="mr-3" onClick={() => navigate('/tools')}>
                    <ArrowLeftIcon className="size-4" />
                    {t('nav_tooltip.tools')}
                </Button>
                <span className="header">{t('dialog.screenshot_metadata.header')}</span>
                {isDeletingMetadata ? <Badge variant="outline">Deleting metadata</Badge> : null}
                {isUploadingScreenshot ? <Badge variant="outline">Uploading screenshot</Badge> : null}
            </div>

            <div className="my-2 flex flex-col gap-3 xl:flex-row xl:items-center">
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => void browseForScreenshot()}>
                            <FolderSearchIcon className="size-4" />
                            {t('dialog.screenshot_metadata.browse')}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => void loadLastScreenshot()}>
                            <ImageIcon className="size-4" />
                            {t('dialog.screenshot_metadata.last_screenshot')}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={!metadata?.filePath}
                            onClick={() => void openFolder()}
                        >
                            <FolderOpenIcon className="size-4" />
                            {t('dialog.screenshot_metadata.open_folder')}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={!metadata?.filePath}
                            onClick={() => void copyImage()}
                        >
                            <CopyIcon className="size-4" />
                            {t('dialog.screenshot_metadata.copy_image')}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={!metadata?.filePath || !isVrcPlusSupporter || isUploadingScreenshot}
                            onClick={() => void uploadScreenshotToGallery()}
                        >
                            <UploadIcon className="size-4" />
                            {t('dialog.screenshot_metadata.upload')}
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            disabled={!metadata?.filePath || isDeletingMetadata}
                            onClick={() => void deleteMetadata()}
                        >
                            <Trash2Icon className="size-4" />
                            {t('dialog.screenshot_metadata.delete_metadata')}
                        </Button>
                    </div>

                    <div className="flex flex-1 flex-col gap-2 lg:flex-row xl:justify-end">
                        <div className="relative min-w-0 flex-1 xl:max-w-sm">
                            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={searchQuery}
                                className="pl-9"
                                placeholder={t('dialog.screenshot_metadata.search_placeholder')}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        void runSearch();
                                    }
                                }}
                            />
                        </div>
                        <Select value={searchType} onValueChange={handleSearchTypeChange}>
                            <SelectTrigger className="w-full lg:w-52">
                                <SelectValue
                                    placeholder={t('dialog.screenshot_metadata.search_type_placeholder')}
                                />
                            </SelectTrigger>
                            <SelectContent>
                                {searchTypes.map((type) => (
                                    <SelectItem key={type.value} value={type.value}>
                                        {t(type.labelKey)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button onClick={() => void runSearch()}>Search</Button>
                        {searchViewMode === 'table' && searchRows.length ? (
                            <span className="whitespace-pre-wrap text-xs">
                                {t('dialog.screenshot_metadata.result_count', {
                                    count: searchRows.length
                                })}
                            </span>
                        ) : searchNavigationPaths.length && selectedPath ? (
                            <span className="whitespace-pre-wrap text-xs">
                                {searchNavigationPaths.indexOf(selectedPath) + 1}/{searchNavigationPaths.length}
                            </span>
                        ) : null}
                    </div>
            </div>

            {searchViewMode === 'table' ? (
                <div className="min-h-0 flex-1 overflow-auto">
                    {isSearchLoading ? (
                        <EmptyState
                            loading
                            title="Searching screenshots"
                            description="Resolving file list and metadata summaries."
                        />
                    ) : (
                        <Table className="vrcx-data-table">
                            <TableHeader>
                                <TableRow>
                                    <TableHead>
                                        <SearchSortHead
                                            label={t('dialog.screenshot_metadata.col_date')}
                                            sortKey="dateTime"
                                            sort={searchSort}
                                            onToggle={toggleSearchSort}
                                        />
                                    </TableHead>
                                    <TableHead>
                                        <SearchSortHead
                                            label={t('dialog.screenshot_metadata.col_world')}
                                            sortKey="world"
                                            sort={searchSort}
                                            onToggle={toggleSearchSort}
                                        />
                                    </TableHead>
                                    {currentSearchType.index <= 1 ? (
                                        <TableHead>
                                            <SearchSortHead
                                                label={t('dialog.screenshot_metadata.col_match')}
                                                sortKey="match"
                                                sort={searchSort}
                                                onToggle={toggleSearchSort}
                                            />
                                        </TableHead>
                                    ) : null}
                                    <TableHead>
                                        <SearchSortHead
                                            label={t('dialog.screenshot_metadata.col_author')}
                                            sortKey="author"
                                            sort={searchSort}
                                            onToggle={toggleSearchSort}
                                        />
                                    </TableHead>
                                    <TableHead>
                                        <SearchSortHead
                                            label={t('dialog.screenshot_metadata.col_players')}
                                            sortKey="playerCount"
                                            sort={searchSort}
                                            onToggle={toggleSearchSort}
                                        />
                                    </TableHead>
                                    <TableHead>{t('dialog.screenshot_metadata.col_resolution')}</TableHead>
                                    <TableHead className="w-8" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedSearchRows.map((row) => (
                                    <TableRow
                                        key={row.filePath}
                                        data-state={row.filePath === selectedPath ? 'selected' : undefined}
                                        className="cursor-pointer"
                                        onClick={() => {
                                            setSelectedPath(row.filePath);
                                            setSearchViewMode('detail');
                                            void loadScreenshot(row.filePath, false);
                                        }}>
                                        <TableCell>{row.dateLabel}</TableCell>
                                        <TableCell>{row.world}</TableCell>
                                        {currentSearchType.index <= 1 ? (
                                            <TableCell>{row.match}</TableCell>
                                        ) : null}
                                        <TableCell>{row.author}</TableCell>
                                        <TableCell>
                                            <span className="inline-flex items-center gap-1">
                                                <UsersIcon className="size-3 text-muted-foreground" />
                                                {row.playerCount}
                                            </span>
                                        </TableCell>
                                        <TableCell>{row.resolution}</TableCell>
                                        <TableCell>
                                            <ArrowRightIcon className="size-4 text-muted-foreground" />
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
                            <div className="space-y-1">
                                <CardTitle>Preview</CardTitle>
                                <CardDescription>
                                    {metadata?.fileName || t('dialog.screenshot_metadata.drag')}
                                </CardDescription>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" onClick={() => void navigatePrev()}>
                                    <ArrowLeftIcon className="size-4" />
                                    Prev
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => void navigateNext()}>
                                    Next
                                    <ArrowRightIcon className="size-4" />
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent
                        className="flex min-h-0 flex-1 items-center justify-center"
                        onDragOver={handleScreenshotDragOver}
                        onDragEnter={handleScreenshotDragOver}
                        onDrop={(event) => void handleScreenshotDrop(event)}>
                        {isMetadataLoading ? (
                            <EmptyState
                                loading
                                title="Loading screenshot"
                                description="Fetching embedded metadata and file details."
                            />
                        ) : imageUrl ? (
                            <img
                                src={imageUrl}
                                alt={metadata?.fileName || 'Screenshot preview'}
                                className="max-h-[70vh] w-full cursor-pointer rounded-lg object-contain"
                                onClick={() =>
                                    openImagePreview({
                                        url: imageUrl,
                                        title: metadata?.fileName || 'Screenshot preview'
                                    })
                                }
                            />
                        ) : (
                            <EmptyState
                                title={t('dialog.screenshot_metadata.drag')}
                                description="Browse for a screenshot, load the latest screenshot, or run a metadata search."
                            />
                        )}
                    </CardContent>
                </Card>

                <Card className="flex min-h-0 flex-col">
                    <CardHeader>
                        <CardTitle>Details</CardTitle>
                        <CardDescription>
                            Metadata extracted from the selected VRChat screenshot.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6 overflow-y-auto">
                        {searchRows.length ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="mb-2"
                                onClick={() => setSearchViewMode('table')}>
                                <ArrowLeftIcon className="size-3.5" />
                                {t('dialog.screenshot_metadata.back_to_results', {
                                    count: searchRows.length
                                })}
                            </Button>
                        ) : null}
                        {metadataError ? (
                            <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
                                {metadataError}
                            </pre>
                        ) : metadata ? (
                            <>
                                <section className="space-y-2">
                                    <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                        {t('dialog.screenshot_metadata.section_location')}
                                    </div>
                                    {metadata.world?.instanceId || metadata.world?.id ? (
                                        <Location
                                            location={metadata.world?.instanceId || metadata.world?.id}
                                            hint={metadata.world?.name || ''}
                                            enableContextMenu
                                            showLaunchActions
                                        />
                                    ) : (
                                        <div className="text-sm">{metadata.world?.name || '—'}</div>
                                    )}
                                    <MetadataAuthorLink author={metadata.author} endpoint={currentEndpoint} />
                                </section>

                                <section className="space-y-2 border-t pt-4">
                                    <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                        {t('dialog.screenshot_metadata.section_players')} (
                                        {metadata.players.length})
                                    </div>
                                    {metadata.players.length ? (
                                        <div className="flex flex-wrap gap-2">
                                            {metadata.players.map((player) => (
                                                <Badge
                                                    key={`${player.id}-${player.displayName}`}
                                                    variant="secondary"
                                                    className={player.id ? 'cursor-pointer' : ''}
                                                    onClick={() =>
                                                        player.id &&
                                                        openUserDialog({
                                                            userId: player.id,
                                                            title: player.displayName || player.id
                                                        })
                                                    }>
                                                    <UsersIcon className="size-3" />
                                                    {player.displayName}
                                                </Badge>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-sm text-muted-foreground">
                                            No player metadata.
                                        </div>
                                    )}
                                </section>

                                <section className="space-y-2 border-t pt-4">
                                    <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                        {t('dialog.screenshot_metadata.section_file_info')}
                                    </div>
                                    <div className="text-sm">{formatDateTime(metadata.dateTime)}</div>
                                    <div className="text-sm text-muted-foreground">
                                        {[metadata.resolution, formatBytes(metadata.fileSizeBytes)]
                                            .filter(Boolean)
                                            .join(' · ') || '—'}
                                    </div>
                                    <div className="break-all text-xs text-muted-foreground">
                                        {metadata.fileName || metadata.filePath}
                                    </div>
                                </section>

                                {metadata.note ? (
                                    <section className="space-y-2 border-t pt-4">
                                        <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                            {t('dialog.screenshot_metadata.section_note')}
                                        </div>
                                        <div className="text-sm text-muted-foreground">
                                            {metadata.note}
                                        </div>
                                    </section>
                                ) : null}

                                {metadata.application ? (
                                    <section className="space-y-2 border-t pt-4">
                                        <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                            Application
                                        </div>
                                        <div className="text-sm text-muted-foreground">
                                            {metadata.application}
                                        </div>
                                    </section>
                                ) : null}
                            </>
                        ) : (
                            <EmptyState
                                title="No screenshot selected."
                                description="Load a screenshot to inspect embedded world, player and file metadata."
                            />
                        )}
                    </CardContent>
                </Card>
            </div>
            )}
        </div>
    );
}
