import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import configRepository from '@/repositories/configRepository';
import type { ScreenshotLibraryStatus } from '@/repositories/mediaFileRepository';
import mediaRepository from '@/repositories/mediaRepository';

import {
    getGalleryFolderPathSet,
    normalizeGalleryScrollPositions,
    normalizeGalleryScrollTop,
    resolveGalleryFolder,
    SCREENSHOT_GALLERY_FOLDER_CONFIG_KEY,
    SCREENSHOT_GALLERY_SCROLL_CONFIG_KEY,
    SCREENSHOT_GALLERY_SCROLL_SAVE_DELAY_MS,
    serializeGalleryScrollPositions
} from './screenshotMetadataValues';

function persistGalleryScrollPositions(positions: Map<unknown, unknown>) {
    return configRepository
        .setObject(
            SCREENSHOT_GALLERY_SCROLL_CONFIG_KEY,
            serializeGalleryScrollPositions(positions)
        )
        .catch(() => {});
}

export function useScreenshotGalleryController({
    isGalleryMode,
    routeFolder,
    screenshotCacheStatus,
    setSearchParams,
    t
}: any) {
    const galleryRequestRef = useRef(0);
    const selectedGalleryFolderRef = useRef('');
    const galleryScrollPositionsRef = useRef<Map<string, number>>(new Map());
    const galleryScrollPersistTimerRef = useRef<number | null>(null);
    const [folderTree, setFolderTree] = useState<unknown>(null);
    const [galleryImages, setGalleryImages] = useState<unknown[]>([]);
    const [galleryImagesFolder, setGalleryImagesFolder] = useState('');
    const [selectedGalleryFolder, setSelectedGalleryFolder] = useState('');
    const [storedGalleryFolder, setStoredGalleryFolder] = useState('');
    const [
        isGalleryFolderPreferenceLoaded,
        setIsGalleryFolderPreferenceLoaded
    ] = useState(false);
    const [scanStatus, setScanStatus] =
        useState<ScreenshotLibraryStatus | null>(null);
    const [galleryScanError, setGalleryScanError] = useState('');
    const [galleryTreeError, setGalleryTreeError] = useState('');
    const [galleryImagesError, setGalleryImagesError] = useState('');
    const [isGalleryTreeLoading, setIsGalleryTreeLoading] = useState(false);
    const [isGalleryImagesLoading, setIsGalleryImagesLoading] = useState(false);
    const [galleryRevision, setGalleryRevision] = useState(0);

    const visibleGalleryImages =
        galleryImagesFolder === selectedGalleryFolder ? galleryImages : [];
    const selectedGalleryScrollTop =
        galleryScrollPositionsRef.current.get(selectedGalleryFolder) || 0;
    const shouldShowGalleryImagesLoading =
        isGalleryImagesLoading && visibleGalleryImages.length === 0;

    useEffect(() => {
        let active = true;
        Promise.all([
            configRepository.getString(
                SCREENSHOT_GALLERY_FOLDER_CONFIG_KEY,
                ''
            ),
            configRepository.getObject(SCREENSHOT_GALLERY_SCROLL_CONFIG_KEY, {})
        ])
            .then(([folder, scrollPositions]) => {
                if (!active) {
                    return;
                }
                setStoredGalleryFolder(folder || '');
                galleryScrollPositionsRef.current =
                    normalizeGalleryScrollPositions(scrollPositions);
            })
            .catch(() => {})
            .finally(() => {
                if (active) {
                    setIsGalleryFolderPreferenceLoaded(true);
                }
            });

        return () => {
            active = false;
            if (galleryScrollPersistTimerRef.current !== null) {
                window.clearTimeout(galleryScrollPersistTimerRef.current);
                galleryScrollPersistTimerRef.current = null;
                persistGalleryScrollPositions(
                    galleryScrollPositionsRef.current
                );
            }
        };
    }, []);

    useEffect(() => {
        selectedGalleryFolderRef.current = selectedGalleryFolder;
    }, [selectedGalleryFolder]);

    useEffect(() => {
        if (
            !isGalleryMode ||
            !isGalleryFolderPreferenceLoaded ||
            !selectedGalleryFolder ||
            selectedGalleryFolder === storedGalleryFolder
        ) {
            return;
        }

        setStoredGalleryFolder(selectedGalleryFolder);
        configRepository
            .setString(
                SCREENSHOT_GALLERY_FOLDER_CONFIG_KEY,
                selectedGalleryFolder
            )
            .catch(() => {});
    }, [
        isGalleryFolderPreferenceLoaded,
        isGalleryMode,
        selectedGalleryFolder,
        storedGalleryFolder
    ]);

    const openGalleryRoute = useCallback(
        (folder: string = selectedGalleryFolder || routeFolder) => {
            const nextParams = new URLSearchParams();
            if (folder) {
                nextParams.set('folder', folder);
            }
            setSearchParams(nextParams);
        },
        [routeFolder, selectedGalleryFolder, setSearchParams]
    );

    const loadGalleryTree = useCallback(
        async ({
            preferPopulated = false
        }: { preferPopulated?: boolean } = {}) => {
            setIsGalleryTreeLoading(true);
            try {
                const tree = await mediaRepository.getScreenshotFolderTree();
                setFolderTree(tree || null);
                setGalleryTreeError('');
                const folderPathSet = getGalleryFolderPathSet(tree);
                galleryScrollPositionsRef.current = new Map(
                    Array.from(
                        galleryScrollPositionsRef.current.entries()
                    ).filter(([path]) => folderPathSet.has(path))
                );
                setSelectedGalleryFolder((current) =>
                    resolveGalleryFolder(
                        tree,
                        preferPopulated
                            ? [
                                  routeFolder,
                                  selectedGalleryFolderRef.current,
                                  storedGalleryFolder
                              ]
                            : [
                                  routeFolder,
                                  routeFolder ? '' : current,
                                  storedGalleryFolder
                              ]
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
        },
        [routeFolder, storedGalleryFolder, t]
    );

    const refreshGallery = useCallback(
        async (force = false) => {
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
        },
        [loadGalleryTree, t]
    );

    useEffect(() => {
        if (
            !isGalleryMode ||
            !screenshotCacheStatus?.available ||
            !isGalleryFolderPreferenceLoaded
        ) {
            return;
        }
        refreshGallery(false);
    }, [
        isGalleryFolderPreferenceLoaded,
        isGalleryMode,
        screenshotCacheStatus?.available
    ]);

    useEffect(() => {
        if (!isGalleryMode || !folderTree) {
            return;
        }
        setSelectedGalleryFolder(
            resolveGalleryFolder(folderTree, [
                routeFolder,
                routeFolder ? '' : selectedGalleryFolder,
                storedGalleryFolder
            ])
        );
    }, [
        folderTree,
        isGalleryMode,
        routeFolder,
        selectedGalleryFolder,
        storedGalleryFolder
    ]);

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
                        loadGalleryTree({ preferPopulated: true });
                    }
                })
                .catch((error: any) => {
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
    }, [isGalleryMode, loadGalleryTree, scanStatus?.running, t]);

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
            .catch((error: any) => {
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

    function selectGalleryFolder(folder: string) {
        setSelectedGalleryFolder(folder);
        const nextParams = new URLSearchParams();
        if (folder) {
            nextParams.set('folder', folder);
        }
        setSearchParams(nextParams);
    }

    const updateGalleryScrollPosition = useCallback(
        (folder: string, scrollTop: unknown) => {
            if (!folder) {
                return;
            }
            const normalizedScrollTop = normalizeGalleryScrollTop(scrollTop);
            const positions = galleryScrollPositionsRef.current;
            positions.delete(folder);
            positions.set(folder, normalizedScrollTop);

            if (galleryScrollPersistTimerRef.current !== null) {
                window.clearTimeout(galleryScrollPersistTimerRef.current);
            }
            galleryScrollPersistTimerRef.current = window.setTimeout(() => {
                galleryScrollPersistTimerRef.current = null;
                persistGalleryScrollPositions(
                    galleryScrollPositionsRef.current
                );
            }, SCREENSHOT_GALLERY_SCROLL_SAVE_DELAY_MS);
        },
        []
    );

    useEffect(() => {
        if (!isGalleryFolderPreferenceLoaded || !folderTree) {
            return;
        }
        persistGalleryScrollPositions(galleryScrollPositionsRef.current);
    }, [folderTree, isGalleryFolderPreferenceLoaded]);

    return {
        folderTree,
        galleryImagesError,
        galleryScanError,
        galleryTreeError,
        isGalleryImagesLoading,
        isGalleryTreeLoading,
        openGalleryRoute,
        refreshGallery,
        scanStatus,
        selectedGalleryFolder,
        selectedGalleryScrollTop,
        selectGalleryFolder,
        shouldShowGalleryImagesLoading,
        updateGalleryScrollPosition,
        visibleGalleryImages
    };
}
