import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
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
} from './components/ScreenshotMetadataSections.jsx';
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
    { setSelectedPath, setSearchViewMode, loadScreenshot }
) {
    setSelectedPath(row.filePath);
    setSearchViewMode('detail');
    void loadScreenshot(row.filePath, false);
}

export function ScreenshotMetadataPage() {
    const navigate = useNavigate();
    const { t } = useTranslation();
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

    const { navigateNext, navigatePrev } = useScreenshotMetadataNavigation({
        loadScreenshot,
        metadata,
        searchNavigationPaths,
        selectedPath,
        setSelectedPath
    });

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
                    : t(
                          'view.tools.generated_toast.failed_to_open_screenshot_picker'
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
                    : t('view.tools.generated_toast.failed_to_open_folder')
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
                    : t('view.tools.generated_toast.failed_to_copy_image')
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
            toast.error(
                t(
                    'view.tools.generated.dropped_screenshot_path_is_not_available'
                )
            );
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

    return (
        <div className="screenshot-metadata-page x-container flex min-h-0 flex-1 flex-col overflow-hidden p-6">
            <ScreenshotMetadataHeader
                backLabel={t('nav_tooltip.tools')}
                title={t('dialog.screenshot_metadata.header')}
                deleting={isDeletingMetadata}
                uploading={isUploadingScreenshot}
                deletingLabel={t('view.tools.generated.deleting_metadata')}
                uploadingLabel={t('view.tools.generated.uploading_screenshot')}
                onBack={() => navigate('/tools')}
            />

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
                            setSelectedPath,
                            setSearchViewMode,
                            loadScreenshot
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
                                    metadata?.fileName || 'Screenshot preview',
                                fileName: metadata?.fileName || '',
                                sourcePath: metadata?.filePath || ''
                            })
                        }
                        onDragOver={handleScreenshotDragOver}
                        onDrop={(event) => void handleScreenshotDrop(event)}
                    />

                    <ScreenshotMetadataDetailsCard
                        metadata={metadata}
                        metadataError={metadataError}
                        searchRowsCount={searchRows.length}
                        currentEndpoint={currentEndpoint}
                        onBackToResults={() => setSearchViewMode('table')}
                    />
                </div>
            )}
        </div>
    );
}
