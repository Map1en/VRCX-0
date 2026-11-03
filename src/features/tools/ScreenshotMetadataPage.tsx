import {
    useCallback,
    useEffect,
    useEffectEvent,
    useRef,
    useState
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { FileDropOverlay } from '@/components/file-drop/FileDropOverlay';
import { useFileDropTarget } from '@/components/file-drop/useFileDropTarget';
import {
    hasCommandModifier,
    isImeComposing,
    isKeyboardControlTarget
} from '@/components/keyboard/keyboardShortcutGuards';
import { PageScaffold } from '@/components/layout/PageScaffold';
import { ToolPageHeader } from '@/components/layout/ToolPageHeader';
import { preloadImages } from '@/components/media/imageDecodeCache';
import { getRememberedScreenshotThumbnailUrl } from '@/components/media/screenshotThumbnailUrlCache';
import { convertFileSrc } from '@/platform/tauri/assets';
import { commands } from '@/platform/tauri/bindings';
import mediaFileRepository from '@/repositories/mediaFileRepository';
import vrchatMediaRepository from '@/repositories/vrchatMediaRepository';
import { openFolderAndSelectItem } from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import { withUploadTimeout } from '@/shared/utils/imageUpload';
import { useAssistantChatStore } from '@/state/assistantChatStore';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Badge } from '@/ui/shadcn/badge';

import { ScreenshotGalleryView } from './components/ScreenshotGalleryView';
import {
    ScreenshotDetailActions,
    ScreenshotMetadataDetailsCard,
    ScreenshotMetadataPreviewCard,
    ScreenshotSearchToolbar
} from './components/ScreenshotMetadataSections';
import { ScreenshotSearchResultsView } from './components/ScreenshotSearchResultsView';
import {
    hasScreenshotSearch,
    libraryImageSearchRow,
    normalizeScreenshotMetadata,
    parseScreenshotFilterParam,
    resolvePathAfterScreenshotDelete,
    SCREENSHOT_FAVORITES_FOLDER,
    screenshotFilterFromScope,
    screenshotScopeFromFilter,
    type ScreenshotSearchScope
} from './screenshotMetadataValues';
import { useScreenshotBrowseImages } from './useScreenshotBrowseImages';
import { useScreenshotBrowseSelection } from './useScreenshotBrowseSelection';
import { useScreenshotBulkDelete } from './useScreenshotBulkDelete';
import { useScreenshotFavorites } from './useScreenshotFavorites';
import { useScreenshotGalleryController } from './useScreenshotGalleryController';
import { useScreenshotMetadataNavigation } from './useScreenshotMetadataNavigation';
import { useScreenshotMetadataSearch } from './useScreenshotMetadataSearch';
import { useScreenshotSearchFacets } from './useScreenshotSearchFacets';
import { useScreenshotZipExport } from './useScreenshotZipExport';

const DETAILS_VISIBLE_STORAGE_KEY = 'VRCX_0_ScreenshotDetailsVisible';

function readDetailsVisible() {
    return localStorage.getItem(DETAILS_VISIBLE_STORAGE_KEY) !== 'false';
}

function writeDetailsVisible(visible: boolean) {
    localStorage.setItem(DETAILS_VISIBLE_STORAGE_KEY, String(visible));
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value))
        : {};
}

export function ScreenshotMetadataPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const { i18n, t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const screenshotCacheStatus = useRuntimeStore(
        (state) => state.hostCapabilities.screenshotCache
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const isVrcPlusSupporter = Boolean(
        currentUserSnapshot?.$isVRCPlus ||
        currentUserSnapshot?.tags?.includes?.('system_supporter') ||
        globalThis.$debug?.debugVrcPlus
    );
    const imageVersionsRef = useRef(new Map<string, number>());
    const metadataRequestRef = useRef(0);
    const searchRequestRef = useRef(0);
    const routePath = searchParams.get('path') || '';
    const routeFolder = searchParams.get('folder') || '';
    const isGalleryMode = !routePath;
    const routeFilter = searchParams.get('filter') || '';
    const {
        removeSearchPaths,
        resetSearchResults,
        searchDraft,
        searchLayout,
        searchNavigationPaths,
        searchRows,
        searchScope,
        searchSort,
        searchViewMode,
        selectedPath,
        selectedPathIndex,
        setSearchDraft,
        setSearchLayout,
        setSearchResults,
        setSearchScope,
        setSearchViewMode,
        setSelectedPath,
        sortedSearchImages,
        sortedSearchRows,
        toggleSearchSort,
        withoutPeopleCount
    } = useScreenshotMetadataSearch();
    const searchKey = JSON.stringify(searchScope);
    const showSearchResults = searchViewMode === 'results';
    const [metadata, setMetadata] = useState<ReturnType<
        typeof normalizeScreenshotMetadata
    > | null>(null);
    const [metadataError, setMetadataError] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [isMetadataLoading, setIsMetadataLoading] = useState(false);
    const [isSearchLoading, setIsSearchLoading] = useState(false);
    const [isDeletingMetadata, setIsDeletingMetadata] = useState(false);
    const [isDeletingFile, setIsDeletingFile] = useState(false);
    const [isUploadingScreenshot, setIsUploadingScreenshot] = useState(false);
    const [isDetailsVisible, setIsDetailsVisible] =
        useState(readDetailsVisible);
    const [galleryRevealPath, setGalleryRevealPath] = useState('');
    const dateLocale = i18n.resolvedLanguage || i18n.language;
    const {
        folderTree,
        galleryImagesError,
        galleryScanError,
        galleryTreeError,
        isGalleryTreeLoading,
        openGalleryRoute,
        refreshGallery,
        refreshGalleryTree,
        removeGalleryImages,
        scanStatus,
        selectedGalleryFolder,
        selectedGalleryScrollTop,
        selectGalleryFolder,
        shouldShowGalleryImagesLoading,
        updateGalleryScrollPosition,
        visibleGalleryImages
    } = useScreenshotGalleryController({
        isGalleryMode,
        routeFolder,
        screenshotCacheStatus,
        setSearchParams
    });
    const {
        favoriteImages,
        favoritePaths,
        forgetFavoritePaths,
        forgetMissingFavorites,
        isLoading: isFavoritesLoading,
        missingCount: favoritesMissingCount,
        reloadFavorites,
        setFavorite
    } = useScreenshotFavorites(Boolean(screenshotCacheStatus?.available));
    const lastScanAt = scanStatus?.lastScanAt;
    const { peopleFacets, worldFacets } = useScreenshotSearchFacets(
        Boolean(screenshotCacheStatus?.available),
        lastScanAt
    );
    useEffect(() => {
        if (lastScanAt) {
            void reloadFavorites();
        }
    }, [lastScanAt, reloadFavorites]);
    const isFavoritesFolder =
        selectedGalleryFolder === SCREENSHOT_FAVORITES_FOLDER;
    const {
        images: browseImages,
        paths: visibleGalleryImagePaths,
        setSort: setGallerySort,
        sort: gallerySort
    } = useScreenshotBrowseImages(
        isFavoritesFolder ? favoriteImages : visibleGalleryImages
    );
    const browseSelection = useScreenshotBrowseSelection(
        visibleGalleryImagePaths
    );
    const { bulkDeleteRunning, deleteScreenshots } = useScreenshotBulkDelete({
        scopeKey: showSearchResults ? `search:${searchKey}` : 'browse',
        removeDeletedImages: (paths) => {
            removeGalleryImages(paths);
            removeSearchPaths(paths);
            forgetFavoritePaths(paths);
            browseSelection.removePaths(paths);
        },
        refreshGalleryTree
    });
    const { exportScreenshots } = useScreenshotZipExport();

    const clearGalleryRevealPath = useCallback(() => {
        setGalleryRevealPath('');
    }, []);

    const toggleDetailsVisible = useCallback(() => {
        const nextVisible = !isDetailsVisible;
        setIsDetailsVisible(nextVisible);
        writeDetailsVisible(nextVisible);
    }, [isDetailsVisible]);

    const screenshotImageUrl = useCallback(
        (path: string) =>
            path
                ? `${convertFileSrc(path, 'vrcx-0-img')}?v=${imageVersionsRef.current.get(path) ?? 0}`
                : '',
        []
    );

    const updateRoutePath = useCallback(
        (path: string, folderPath?: string) => {
            const nextParams = new URLSearchParams();
            nextParams.set('path', path);
            const folder = folderPath || selectedGalleryFolder || routeFolder;
            if (folder) {
                nextParams.set('folder', folder);
            }
            setSearchParams(nextParams);
        },
        [routeFolder, selectedGalleryFolder, setSearchParams]
    );

    const openDetailPath = useCallback(
        (
            path: string,
            { clearPreview = true }: { clearPreview?: boolean } = {}
        ) => {
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

    function openSearchResultPath(path: string) {
        setSelectedPath(path);
        setSearchViewMode('detail');
        openDetailPath(path);
    }

    function resetSearchContext({
        clearQuery = false,
        clearPreview = false
    }: { clearQuery?: boolean; clearPreview?: boolean } = {}) {
        resetSearchResults({ clearQuery });

        if (clearPreview) {
            setMetadata(null);
            setMetadataError('');
            setImageUrl('');
        }
    }

    const loadScreenshot = useCallback(
        async (path: string, withCarousel = true) => {
            if (!path) {
                return;
            }

            const requestId = metadataRequestRef.current + 1;
            metadataRequestRef.current = requestId;
            setIsMetadataLoading(true);
            setMetadataError('');
            setImageUrl(screenshotImageUrl(path));

            try {
                const rawMetadata = recordFromUnknown(
                    await mediaFileRepository.getScreenshotMetadata(path)
                );

                if (metadataRequestRef.current !== requestId) {
                    return;
                }

                const sourceFile =
                    typeof rawMetadata.sourceFile === 'string'
                        ? rawMetadata.sourceFile
                        : '';
                if (!sourceFile) {
                    const message = t(
                        'dialog.screenshot_metadata.invalid_file'
                    );
                    setMetadata(null);
                    setImageUrl('');
                    setMetadataError(message);
                    toast.add({ type: 'error', title: message });
                    return;
                }

                const extra = await mediaFileRepository.getExtraScreenshotData(
                    sourceFile,
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
                setMetadata(nextMetadata);
                setMetadataError(nextMetadataError);
                setSelectedPath(nextMetadata.filePath);
                setGalleryRevealPath(nextMetadata.filePath);
                setImageUrl(screenshotImageUrl(nextMetadata.filePath));
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
                toast.add({ type: 'error', title: message });
            } finally {
                if (metadataRequestRef.current === requestId) {
                    setIsMetadataLoading(false);
                }
            }
        },
        [screenshotImageUrl, setSelectedPath, t]
    );

    useEffect(() => {
        if (!routePath) {
            return;
        }
        setSearchViewMode('detail');
        loadScreenshot(routePath, true);
    }, [loadScreenshot, routePath, setSearchViewMode]);

    const isDetailView = !isGalleryMode && searchViewMode === 'detail';
    const {
        canNavigateNext,
        canNavigatePrev,
        navigateNext,
        navigatePrev,
        nextFolderPath,
        nextPath,
        prevFolderPath,
        prevPath
    } = useScreenshotMetadataNavigation({
        browseNavigationPaths: visibleGalleryImagePaths,
        crossFolderAtEdges: !isFavoritesFolder,
        enabled: isDetailView,
        loadScreenshot,
        metadata,
        onPathChange: updateRoutePath,
        reverseMetadataOrder: gallerySort === 'captured-desc',
        searchNavigationPaths,
        selectedPath,
        setSelectedPath
    });

    useEffect(() => {
        if (isDetailView) {
            preloadImages([
                screenshotImageUrl(prevPath),
                screenshotImageUrl(nextPath)
            ]);
        }
    }, [isDetailView, nextPath, prevPath, screenshotImageUrl]);

    useEffect(() => {
        function handleDetailsShortcut(event: KeyboardEvent) {
            if (
                isGalleryMode ||
                searchViewMode !== 'detail' ||
                isImeComposing(event) ||
                hasCommandModifier(event) ||
                event.shiftKey ||
                event.key.toLowerCase() !== 'i' ||
                isKeyboardControlTarget(event.target)
            ) {
                return;
            }

            event.preventDefault();
            toggleDetailsVisible();
        }

        window.addEventListener('keydown', handleDetailsShortcut);
        return () => {
            window.removeEventListener('keydown', handleDetailsShortcut);
        };
    }, [isGalleryMode, searchViewMode, toggleDetailsVisible]);

    async function openFolder() {
        if (!metadata?.filePath) {
            return;
        }

        try {
            await openFolderAndSelectItem(metadata.filePath, false);
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.tools.toast.failed_to_open_folder')
            });
        }
    }

    async function copyImage() {
        if (!metadata?.filePath) {
            return;
        }

        try {
            await commands.appCopyImageToClipboard(metadata.filePath);
            toast.add({
                type: 'success',
                title: t('message.image.copied_to_clipboard')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.tools.toast.failed_to_copy_image')
            });
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
                await commands.appDeleteScreenshotMetadata(filePath);
            if (!deleted) {
                toast.add({
                    type: 'error',
                    title: t('message.screenshot_metadata.delete_failed')
                });
                return;
            }

            toast.add({
                type: 'success',
                title: t('message.screenshot_metadata.deleted')
            });
            imageVersionsRef.current.set(
                filePath,
                (imageVersionsRef.current.get(filePath) ?? 0) + 1
            );
            await loadScreenshot(filePath, true);
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('message.screenshot_metadata.delete_failed')
            });
        } finally {
            setIsDeletingMetadata(false);
        }
    }

    async function deleteScreenshotFile() {
        const filePath = metadata?.filePath || '';
        if (!filePath) {
            return;
        }

        const result = await confirm({
            title: t('dialog.screenshot_metadata.delete_file_confirm_title'),
            description: t(
                'dialog.screenshot_metadata.delete_file_confirm_description'
            ),
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        const neighborPath = nextPath || prevPath;
        const neighborFolderPath = nextPath ? nextFolderPath : prevFolderPath;
        const fallbackTarget = neighborPath
            ? null
            : resolvePathAfterScreenshotDelete(metadata);
        setIsDeletingFile(true);

        try {
            await commands.appDeleteScreenshotFile(filePath);
            forgetFavoritePaths([filePath]);
            removeGalleryImages([filePath]);
            removeSearchPaths([filePath]);
            toast.add({
                type: 'success',
                title: t('message.screenshot_metadata.file_deleted')
            });
            if (neighborPath) {
                if (neighborFolderPath) {
                    updateRoutePath(neighborPath, neighborFolderPath);
                } else {
                    updateRoutePath(neighborPath);
                }
                return;
            }
            if (fallbackTarget) {
                updateRoutePath(
                    fallbackTarget.filePath,
                    fallbackTarget.folderPath
                );
                return;
            }
            openGalleryRoute();
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('message.screenshot_metadata.file_delete_failed')
            });
        } finally {
            setIsDeletingFile(false);
        }
    }

    async function confirmForgetMissingFavorites() {
        const result = await confirm({
            title: t(
                'dialog.screenshot_metadata.forget_missing_favorites_confirm_title'
            ),
            description: t(
                'dialog.screenshot_metadata.forget_missing_favorites_confirm_description',
                { count: favoritesMissingCount }
            ),
            confirmText: t(
                'dialog.screenshot_metadata.forget_missing_favorites'
            ),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (result.ok) {
            await forgetMissingFavorites();
        }
    }

    async function uploadScreenshotToGallery() {
        if (!metadata?.filePath) {
            return;
        }
        if (!isVrcPlusSupporter) {
            toast.add({ type: 'error', title: t('message.vrcplus.required') });
            return;
        }
        if (metadata.fileSizeBytes > 10_000_000) {
            toast.add({ type: 'error', title: t('message.file.too_large') });
            return;
        }

        setIsUploadingScreenshot(true);
        try {
            const base64Body = await commands.appGetFileBase64(
                metadata.filePath
            );
            await withUploadTimeout(
                vrchatMediaRepository.uploadGalleryImage(base64Body)
            );
            toast.add({
                type: 'success',
                title: t('message.gallery.uploaded')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('message.gallery.failed')
            });
        } finally {
            setIsUploadingScreenshot(false);
        }
    }

    async function runSearch(scope: ScreenshotSearchScope) {
        if (!hasScreenshotSearch(scope)) {
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
        setSearchViewMode('results');

        try {
            const result = await commands.appQueryScreenshots(
                screenshotFilterFromScope(scope)
            );

            if (searchRequestRef.current !== requestId) {
                return;
            }

            setSearchResults({
                rows: result.images.map((image) =>
                    libraryImageSearchRow(image, scope, dateLocale)
                ),
                images: result.images,
                withoutPeople: result.withoutPeople
            });
            setMetadataError('');
            setSelectedPath('');
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Failed to search screenshot metadata.';
            setSearchResults({ rows: [], images: [] });
            setMetadataError(message);
            toast.add({ type: 'error', title: message });
        } finally {
            if (searchRequestRef.current === requestId) {
                setIsSearchLoading(false);
            }
        }
    }

    function updateSearchScope(patch: Partial<ScreenshotSearchScope>) {
        const next = { ...searchScope, ...patch };
        setSearchScope(next);
        void runSearch(next);
    }

    function askAssistant() {
        const [personId] = searchScope.people;
        const [worldId] = searchScope.worlds;
        const onlyPerson =
            searchScope.people.length === 1 && !searchScope.worlds.length;
        const onlyWorld =
            searchScope.worlds.length === 1 && !searchScope.people.length;
        const facet = onlyPerson
            ? peopleFacets.find((item) => item.id === personId)
            : onlyWorld
              ? worldFacets.find((item) => item.id === worldId)
              : undefined;
        useAssistantChatStore.getState().startAssistantDraft({
            topic: 'screenshots',
            target: facet
                ? {
                      kind: onlyPerson ? 'user' : 'world',
                      id: facet.id,
                      name: facet.name || facet.id
                  }
                : null
        });
    }

    const applyRouteFilter = useEffectEvent((value: string) => {
        const filter = parseScreenshotFilterParam(value);
        setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.delete('filter');
            return next;
        });
        if (!filter) {
            return;
        }
        const scope = screenshotScopeFromFilter(filter);
        setSearchScope(scope);
        setSearchDraft(scope.text);
        void runSearch(scope);
    });

    useEffect(() => {
        if (routeFilter) {
            applyRouteFilter(routeFilter);
        }
    }, [routeFilter]);

    const fileDropActive = useFileDropTarget({
        enabled: Boolean(screenshotCacheStatus?.available),
        onDrop: (paths) => {
            resetSearchContext({ clearQuery: true });
            openDetailPath(paths[0]);
        }
    });

    if (!screenshotCacheStatus?.available) {
        return (
            <PageScaffold className="screenshot-metadata-page flex-1">
                <ToolPageHeader toolKey="screenshot-metadata" />
                <div className="text-muted-foreground mt-4 rounded-md border p-4 text-sm">
                    {screenshotCacheStatus?.reason ||
                        'Screenshot cache is unavailable on this platform.'}
                </div>
            </PageScaffold>
        );
    }

    return (
        <PageScaffold className="screenshot-metadata-page flex-1">
            <ToolPageHeader
                toolKey="screenshot-metadata"
                status={
                    <>
                        {isDeletingMetadata || isDeletingFile ? (
                            <Badge variant="outline">
                                {isDeletingFile
                                    ? t(
                                          'view.tools.loading.deleting_screenshot'
                                      )
                                    : t('view.tools.loading.deleting_metadata')}
                            </Badge>
                        ) : null}
                        {isUploadingScreenshot ? (
                            <Badge variant="outline">
                                {t('view.tools.loading.uploading_screenshot')}
                            </Badge>
                        ) : null}
                    </>
                }
            />

            <ScreenshotSearchToolbar
                scope={searchScope}
                draft={searchDraft}
                peopleFacets={peopleFacets}
                worldFacets={worldFacets}
                isSearching={isSearchLoading}
                searchLayout={searchLayout}
                showResultControls={showSearchResults}
                searchRowsCount={searchRows.length}
                withoutPeopleCount={withoutPeopleCount}
                searchNavigationCount={searchNavigationPaths.length}
                selectedPathIndex={selectedPathIndex}
                onDraftChange={setSearchDraft}
                onScopeChange={(people, worlds) =>
                    updateSearchScope({ people, worlds })
                }
                onCommitText={() => updateSearchScope({ text: searchDraft })}
                onDateRangeChange={(dateFrom, dateTo) =>
                    updateSearchScope({ dateFrom, dateTo })
                }
                onPeopleMatchChange={(peopleMatch) =>
                    updateSearchScope({ peopleMatch })
                }
                onSearchLayoutChange={setSearchLayout}
                onClearSearch={() => {
                    resetSearchContext({ clearQuery: true });
                }}
                onAskAssistant={askAssistant}
            />

            {showSearchResults ? (
                <ScreenshotSearchResultsView
                    isSearchLoading={isSearchLoading}
                    layout={searchLayout}
                    images={sortedSearchImages}
                    rows={sortedSearchRows}
                    showMatch={Boolean(
                        searchScope.people.length || searchScope.text.trim()
                    )}
                    searchSort={searchSort}
                    searchKey={searchKey}
                    selectedPath={selectedPath}
                    isDeleteRunning={bulkDeleteRunning}
                    onToggleSearchSort={toggleSearchSort}
                    onOpenResultPath={openSearchResultPath}
                    onDeleteSelection={(paths) => {
                        deleteScreenshots(paths);
                    }}
                    onExportSelection={(paths, groupByFolder) => {
                        exportScreenshots(paths, groupByFolder);
                    }}
                />
            ) : isGalleryMode ? (
                <ScreenshotGalleryView
                    folderTree={folderTree}
                    images={browseImages}
                    sort={gallerySort}
                    onSortChange={setGallerySort}
                    isImagesLoading={
                        isFavoritesFolder
                            ? isFavoritesLoading && favoriteImages.length === 0
                            : shouldShowGalleryImagesLoading
                    }
                    isTreeLoading={isGalleryTreeLoading && !folderTree}
                    error={
                        galleryScanError ||
                        galleryTreeError ||
                        galleryImagesError
                    }
                    scanStatus={scanStatus}
                    selectedFolder={selectedGalleryFolder}
                    onOpenImage={(path) => {
                        resetSearchContext();
                        openDetailPath(path);
                    }}
                    onRefresh={() => {
                        refreshGallery(true);
                    }}
                    onSelectFolder={selectGalleryFolder}
                    onDeleteSelection={(paths) => {
                        deleteScreenshots(paths);
                    }}
                    onExportSelection={(paths, groupByFolder) => {
                        exportScreenshots(paths, groupByFolder);
                    }}
                    onScrollPositionChange={updateGalleryScrollPosition}
                    isDeleteRunning={bulkDeleteRunning}
                    restoreScrollTop={selectedGalleryScrollTop}
                    revealPath={galleryRevealPath}
                    onRevealPathConsumed={clearGalleryRevealPath}
                    selection={browseSelection}
                    favorites={{
                        paths: favoritePaths,
                        count: favoriteImages.length,
                        missingCount: favoritesMissingCount,
                        onToggle: (path, favorite) => {
                            void setFavorite(path, favorite);
                        },
                        onForgetMissing: () => {
                            void confirmForgetMissingFavorites();
                        }
                    }}
                />
            ) : (
                <>
                    <ScreenshotDetailActions
                        metadata={metadata}
                        isVrcPlusSupporter={isVrcPlusSupporter}
                        isUploadingScreenshot={isUploadingScreenshot}
                        isDeletingMetadata={isDeletingMetadata}
                        isDeletingFile={isDeletingFile}
                        onBackToGallery={openGalleryRoute}
                        onOpenFolder={() => {
                            openFolder();
                        }}
                        onCopyImage={() => {
                            copyImage();
                        }}
                        onUpload={() => {
                            uploadScreenshotToGallery();
                        }}
                        onDelete={() => {
                            deleteMetadata();
                        }}
                        onDeleteFile={() => {
                            deleteScreenshotFile();
                        }}
                        isFavorite={favoritePaths.has(metadata?.filePath || '')}
                        onToggleFavorite={() => {
                            const filePath = metadata?.filePath;
                            if (filePath) {
                                void setFavorite(
                                    filePath,
                                    !favoritePaths.has(filePath)
                                );
                            }
                        }}
                    />

                    <div
                        className={
                            isDetailsVisible
                                ? 'grid min-h-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_380px]'
                                : 'grid min-h-0 flex-1'
                        }
                    >
                        <ScreenshotMetadataPreviewCard
                            metadata={metadata}
                            imageUrl={imageUrl}
                            placeholderUrl={
                                imageUrl
                                    ? getRememberedScreenshotThumbnailUrl(
                                          routePath
                                      )
                                    : ''
                            }
                            isMetadataLoading={isMetadataLoading}
                            canNavigatePrev={canNavigatePrev}
                            canNavigateNext={canNavigateNext}
                            isDetailsVisible={isDetailsVisible}
                            onNavigatePrev={() => {
                                navigatePrev();
                            }}
                            onNavigateNext={() => {
                                navigateNext();
                            }}
                            onToggleDetails={toggleDetailsVisible}
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
                        />

                        {isDetailsVisible ? (
                            <ScreenshotMetadataDetailsCard
                                metadata={metadata}
                                metadataError={metadataError}
                                searchRowsCount={searchRows.length}
                                onBackToResults={() =>
                                    setSearchViewMode('results')
                                }
                            />
                        ) : null}
                    </div>
                </>
            )}

            <FileDropOverlay
                active={fileDropActive}
                label={t('view.tools.file_drop.open_screenshot')}
            />
        </PageScaffold>
    );
}
