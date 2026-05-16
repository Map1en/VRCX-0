// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { convertFileSrc } from '@/platform/tauri/index.js';
import { mediaRepository } from '@/repositories/index.js';
import { withUploadTimeout } from '@/shared/utils/imageUpload.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import {
    ScreenshotMetadataDetailsCard,
    ScreenshotMetadataHeader,
    ScreenshotMetadataPreviewCard,
    ScreenshotMetadataResultsTable,
    ScreenshotMetadataToolbar
} from './components/ScreenshotMetadataSections';
import { ScreenshotGalleryView } from './components/ScreenshotGalleryView';
import {
    buildScreenshotSearchRow,
    DEFAULT_SCREENSHOT_SEARCH_SORT,
    getDroppedScreenshotPath,
    normalizeScreenshotMetadata,
    SCREENSHOT_METADATA_SEARCH_TYPES,
    sortScreenshotRowsByNewest,
    sortScreenshotSearchRows
} from './screenshotMetadataValues.js';
import { useScreenshotMetadataNavigation } from './useScreenshotMetadataNavigation.js';

function openSearchResult(
    row,
    { openDetailPath, setSelectedPath, setSearchViewMode }
) {
    setSelectedPath(row.filePath);
    setSearchViewMode('detail');
    openDetailPath(row.filePath);
}

function getFolderLatestModifiedAt(folder) {
    return Number(folder?.latestModifiedAt) || 0;
}

function resolveGalleryFolder(folderTree, preferredFolder) {
    const folders = Array.isArray(folderTree?.folders) ? folderTree.folders : [];
    if (
        preferredFolder &&
        folders.some((folder) => folder.path === preferredFolder)
    ) {
        return preferredFolder;
    }
    const latestFolder = folders
        .filter((folder) => Number(folder.imageCount) > 0)
        .sort(
            (left, right) =>
                getFolderLatestModifiedAt(right) -
                    getFolderLatestModifiedAt(left) ||
                String(right.path || '').localeCompare(String(left.path || ''))
        )[0];
    return (
        latestFolder?.path ||
        folderTree?.rootPath ||
        folders[0]?.path ||
        ''
    );
}

export function ScreenshotMetadataPage() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { i18n, t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const screenshotCacheStatus = useRuntimeStore(
        (state) => state.hostCapabilities.screenshotCache
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
    const galleryRequestRef = useRef(0);
    const routePath = searchParams.get('path') || '';
    const routeFolder = searchParams.get('folder') || '';
    const isGalleryMode = !routePath;
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
    const [folderTree, setFolderTree] = useState(null);
    const [galleryImages, setGalleryImages] = useState([]);
    const [galleryImagesFolder, setGalleryImagesFolder] = useState('');
    const [selectedGalleryFolder, setSelectedGalleryFolder] = useState('');
    const [scanStatus, setScanStatus] = useState(null);
    const [galleryScanError, setGalleryScanError] = useState('');
    const [galleryTreeError, setGalleryTreeError] = useState('');
    const [galleryImagesError, setGalleryImagesError] = useState('');
    const [isGalleryTreeLoading, setIsGalleryTreeLoading] = useState(false);
    const [isGalleryImagesLoading, setIsGalleryImagesLoading] =
        useState(false);
    const [galleryRevision, setGalleryRevision] = useState(0);

    const currentSearchType =
        SCREENSHOT_METADATA_SEARCH_TYPES.find(
            (type) => type.value === searchType
        ) ?? SCREENSHOT_METADATA_SEARCH_TYPES[0];

    const sortedSearchRows = useMemo(
        () => sortScreenshotSearchRows(searchRows, searchSort),
        [searchRows, searchSort]
    );

    const searchNavigationPaths = useMemo(
        () => sortedSearchRows.map((row) => row.filePath),
        [sortedSearchRows]
    );
    const selectedPathIndex = searchNavigationPaths.indexOf(selectedPath);
    const dateLocale = i18n.resolvedLanguage || i18n.language;
    const visibleGalleryImages =
        galleryImagesFolder === selectedGalleryFolder ? galleryImages : [];
    const shouldShowGalleryImagesLoading =
        isGalleryImagesLoading && visibleGalleryImages.length === 0;

    const updateRoutePath = useCallback(
        (path) => {
            const nextParams = new URLSearchParams();
            nextParams.set('path', path);
            const folder = selectedGalleryFolder || routeFolder;
            if (folder) {
                nextParams.set('folder', folder);
            }
            setSearchParams(nextParams);
        },
        [routeFolder, selectedGalleryFolder, setSearchParams]
    );

    const openDetailPath = useCallback(
        (path, { clearPreview = true } = {}) => {
            if (path) {
                if (clearPreview) {
                    metadataRequestRef.current += 1;
                    setMetadata(null);
                    setMetadataError('');
                    setImageUrl('');
                }
                updateRoutePath(path);
            }
        },
        [updateRoutePath]
    );

    const openGalleryRoute = useCallback(
        (folder = selectedGalleryFolder || routeFolder) => {
            const nextParams = new URLSearchParams();
            if (folder) {
                nextParams.set('folder', folder);
            }
            setSearchParams(nextParams);
        },
        [routeFolder, selectedGalleryFolder, setSearchParams]
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
            const nextMetadataError = rawMetadata?.error
                ? String(rawMetadata.error)
                : '';
            imageVersionRef.current += 1;

            setMetadata(nextMetadata);
            setMetadataError(nextMetadataError);
            setSelectedPath(nextMetadata.filePath);
            setImageUrl(
                `${convertFileSrc(nextMetadata.filePath, 'vrcx-0-img')}?v=${imageVersionRef.current}`
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
            openDetailPath(path);
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
        if (!routePath) {
            return;
        }
        setSearchViewMode('detail');
        void loadScreenshot(routePath, true);
    }, [routePath]);

    const { navigateNext, navigatePrev } = useScreenshotMetadataNavigation({
        loadScreenshot,
        metadata,
        onPathChange: updateRoutePath,
        searchNavigationPaths,
        selectedPath,
        setSelectedPath
    });

    async function loadGalleryTree({ preferPopulated = false } = {}) {
        setIsGalleryTreeLoading(true);
        try {
            const tree = await mediaRepository.getScreenshotFolderTree();
            setFolderTree(tree || null);
            setGalleryTreeError('');
            setSelectedGalleryFolder((current) =>
                resolveGalleryFolder(
                    tree,
                    preferPopulated ? routeFolder : routeFolder || current
                )
            );
            setGalleryRevision((current) => current + 1);
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : t('dialog.screenshot_metadata.gallery_load_failed');
            setGalleryTreeError(message);
            toast.error(message);
        } finally {
            setIsGalleryTreeLoading(false);
        }
    }

    async function refreshGallery(force = false) {
        setGalleryScanError('');
        setGalleryTreeError('');
        setGalleryImagesError('');
        try {
            const status =
                await mediaRepository.startScreenshotLibraryScan(force);
            setScanStatus(status || null);
            setGalleryScanError(status?.error || '');
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : t('dialog.screenshot_metadata.scan_failed');
            setGalleryScanError(message);
            toast.error(message);
        }
        await loadGalleryTree({ preferPopulated: force });
    }

    useEffect(() => {
        if (!isGalleryMode || !screenshotCacheStatus?.available) {
            return;
        }
        void refreshGallery(false);
    }, [isGalleryMode, screenshotCacheStatus?.available]);

    useEffect(() => {
        if (!isGalleryMode || !folderTree) {
            return;
        }
        setSelectedGalleryFolder(resolveGalleryFolder(folderTree, routeFolder));
    }, [folderTree, isGalleryMode, routeFolder]);

    useEffect(() => {
        if (!isGalleryMode || !scanStatus?.running) {
            return undefined;
        }

        let active = true;
        let pollInFlight = false;
        let scanCompleted = false;
        const timer = window.setInterval(() => {
            if (pollInFlight || scanCompleted) {
                return;
            }
            pollInFlight = true;
            mediaRepository
                .getScreenshotLibraryStatus()
                .then((status) => {
                    if (!active) {
                        return;
                    }
                    setScanStatus(status || null);
                    setGalleryScanError(status?.error || '');
                    if (!status?.running) {
                        scanCompleted = true;
                        window.clearInterval(timer);
                        void loadGalleryTree({ preferPopulated: true });
                    }
                })
                .catch((error) => {
                    if (!active) {
                        return;
                    }
                    const message =
                        error instanceof Error
                            ? error.message
                            : t('dialog.screenshot_metadata.scan_failed');
                    setGalleryScanError(message);
                    setScanStatus((current) =>
                        current ? { ...current, running: false } : current
                    );
                })
                .finally(() => {
                    pollInFlight = false;
                });
        }, 1000);

        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, [isGalleryMode, scanStatus?.running, t]);

    useEffect(() => {
        if (!isGalleryMode || !selectedGalleryFolder) {
            galleryRequestRef.current += 1;
            setGalleryImages([]);
            setGalleryImagesFolder('');
            setIsGalleryImagesLoading(false);
            return;
        }

        const requestId = galleryRequestRef.current + 1;
        galleryRequestRef.current = requestId;
        const requestedFolder = selectedGalleryFolder;
        setIsGalleryImagesLoading(true);

        mediaRepository
            .getScreenshotFolderImages(requestedFolder)
            .then((images) => {
                if (galleryRequestRef.current === requestId) {
                    setGalleryImagesError('');
                    setGalleryImages(Array.isArray(images) ? images : []);
                    setGalleryImagesFolder(requestedFolder);
                }
            })
            .catch((error) => {
                if (galleryRequestRef.current === requestId) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : t(
                                  'dialog.screenshot_metadata.gallery_load_failed'
                        );
                    setGalleryImagesError(message);
                    setGalleryImages([]);
                    setGalleryImagesFolder(requestedFolder);
                    toast.error(message);
                }
            })
            .finally(() => {
                if (galleryRequestRef.current === requestId) {
                    setIsGalleryImagesLoading(false);
                }
            });
    }, [galleryRevision, isGalleryMode, selectedGalleryFolder, t]);

    function selectGalleryFolder(folder) {
        setSelectedGalleryFolder(folder);
        const nextParams = new URLSearchParams();
        if (folder) {
            nextParams.set('folder', folder);
        }
        setSearchParams(nextParams);
    }

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
            openDetailPath(filePath);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'view.tools.toast.failed_to_open_screenshot_picker'
                      )
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
                    : t('view.tools.toast.failed_to_open_folder')
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
                error instanceof Error
                    ? error.message
                    : t('view.tools.toast.failed_to_copy_image')
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
            cancelText: t('common.actions.cancel'),
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
                            query,
                            dateLocale
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
            toast.error(
                t(
                    'view.tools.error.dropped_screenshot_path_is_not_available'
                )
            );
            return;
        }
        resetSearchContext({ clearQuery: true });
        openDetailPath(filePath);
    }

    function handleScreenshotDragOver(event) {
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
    }

    if (!screenshotCacheStatus?.available) {
        return (
            <div className="screenshot-metadata-page x-container flex min-h-0 flex-1 flex-col overflow-hidden p-6">
                <ScreenshotMetadataHeader
                    backLabel={t('nav_tooltip.tools')}
                    title={t('dialog.screenshot_metadata.header')}
                    deleting={false}
                    uploading={false}
                    deletingLabel={t('view.tools.loading.deleting_metadata')}
                    uploadingLabel={t(
                        'view.tools.loading.uploading_screenshot'
                    )}
                    onBack={() => navigate('/tools')}
                />
                <div className="text-muted-foreground mt-4 rounded-md border p-4 text-sm">
                    {screenshotCacheStatus?.reason ||
                        'Screenshot cache is unavailable on this platform.'}
                </div>
            </div>
        );
    }

    return (
        <div className="screenshot-metadata-page x-container flex min-h-0 flex-1 flex-col overflow-hidden p-6">
            <ScreenshotMetadataHeader
                backLabel={t('nav_tooltip.tools')}
                title={t('dialog.screenshot_metadata.header')}
                deleting={isDeletingMetadata}
                uploading={isUploadingScreenshot}
                deletingLabel={t('view.tools.loading.deleting_metadata')}
                uploadingLabel={t('view.tools.loading.uploading_screenshot')}
                onBack={() =>
                    isGalleryMode ? navigate('/tools') : openGalleryRoute()
                }
            />

            {isGalleryMode ? (
                <ScreenshotGalleryView
                    folderTree={folderTree}
                    images={visibleGalleryImages}
                    isImagesLoading={shouldShowGalleryImagesLoading}
                    isTreeLoading={isGalleryTreeLoading && !folderTree}
                    error={
                        galleryScanError ||
                        galleryTreeError ||
                        galleryImagesError
                    }
                    scanStatus={scanStatus}
                    selectedFolder={selectedGalleryFolder}
                    onOpenImage={openDetailPath}
                    onRefresh={() => void refreshGallery(true)}
                    onSelectFolder={selectGalleryFolder}
                />
            ) : (
                <>
                    <ScreenshotMetadataToolbar
                        metadata={metadata}
                        isVrcPlusSupporter={isVrcPlusSupporter}
                        isUploadingScreenshot={isUploadingScreenshot}
                        isDeletingMetadata={isDeletingMetadata}
                        searchQuery={searchQuery}
                        searchType={searchType}
                        searchViewMode={searchViewMode}
                        searchRowsCount={searchRows.length}
                        searchNavigationCount={searchNavigationPaths.length}
                        selectedPathIndex={selectedPathIndex}
                        onSearchQueryChange={setSearchQuery}
                        onSearchTypeChange={handleSearchTypeChange}
                        onSearch={() => void runSearch()}
                        onBrowse={() => void browseForScreenshot()}
                        onLoadLast={() => void loadLastScreenshot()}
                        onOpenFolder={() => void openFolder()}
                        onCopyImage={() => void copyImage()}
                        onUpload={() => void uploadScreenshotToGallery()}
                        onDelete={() => void deleteMetadata()}
                    />

                    {searchViewMode === 'table' ? (
                        <ScreenshotMetadataResultsTable
                            isSearchLoading={isSearchLoading}
                            currentSearchType={currentSearchType}
                            searchSort={searchSort}
                            sortedSearchRows={sortedSearchRows}
                            selectedPath={selectedPath}
                            onToggleSearchSort={toggleSearchSort}
                            onOpenResult={(row) =>
                                openSearchResult(row, {
                                    openDetailPath,
                                    setSelectedPath,
                                    setSearchViewMode
                                })
                            }
                        />
                    ) : (
                        <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_380px]">
                            <ScreenshotMetadataPreviewCard
                                metadata={metadata}
                                imageUrl={imageUrl}
                                isMetadataLoading={isMetadataLoading}
                                onNavigatePrev={() => void navigatePrev()}
                                onNavigateNext={() => void navigateNext()}
                                onImagePreview={() =>
                                    openImagePreview({
                                        url: imageUrl,
                                        title:
                                            metadata?.fileName ||
                                            'Screenshot preview',
                                        fileName: metadata?.fileName || '',
                                        sourcePath: metadata?.filePath || ''
                                    })
                                }
                                onDragOver={handleScreenshotDragOver}
                                onDrop={(event) =>
                                    void handleScreenshotDrop(event)
                                }
                            />

                            <ScreenshotMetadataDetailsCard
                                metadata={metadata}
                                metadataError={metadataError}
                                searchRowsCount={searchRows.length}
                                currentEndpoint={currentEndpoint}
                                onBackToResults={() =>
                                    setSearchViewMode('table')
                                }
                            />
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
