import { useCallback, useEffect, useRef } from 'react';

import type { NormalizedScreenshotMetadata } from './screenshotMetadataValues';

type NavigationTarget = {
    path: string;
    folderPath: string;
    inList: boolean;
};

type NavigationMetadata = Pick<
    NormalizedScreenshotMetadata,
    | 'nextFilePath'
    | 'nextFolderPath'
    | 'previousFilePath'
    | 'previousFolderPath'
> | null;

function metadataTarget(
    metadata: NavigationMetadata,
    direction: 'previous' | 'next'
): NavigationTarget | null {
    const path =
        direction === 'previous'
            ? metadata?.previousFilePath
            : metadata?.nextFilePath;
    if (!path) {
        return null;
    }
    return {
        path,
        folderPath:
            (direction === 'previous'
                ? metadata?.previousFolderPath
                : metadata?.nextFolderPath) || '',
        inList: false
    };
}

function listTarget(path: string | undefined): NavigationTarget | null {
    return path ? { path, folderPath: '', inList: true } : null;
}

export function useScreenshotMetadataNavigation({
    browseNavigationPaths = [],
    crossFolderAtEdges = true,
    enabled = true,
    loadScreenshot,
    metadata,
    onPathChange,
    reverseMetadataOrder = false,
    searchNavigationPaths,
    selectedPath,
    setSelectedPath
}: {
    browseNavigationPaths?: readonly string[];
    crossFolderAtEdges?: boolean;
    enabled?: boolean;
    loadScreenshot: (path: string, withCarousel: boolean) => Promise<void>;
    metadata: NavigationMetadata;
    onPathChange?: (path: string, folderPath?: string) => void;
    reverseMetadataOrder?: boolean;
    searchNavigationPaths: string[];
    selectedPath: string;
    setSelectedPath: (path: string) => void;
}) {
    const loadScreenshotRef = useRef(loadScreenshot);
    const searchNavigationIndex = searchNavigationPaths.indexOf(selectedPath);
    const isSearchNavigationActive = searchNavigationIndex !== -1;
    const browseNavigationIndex = isSearchNavigationActive
        ? -1
        : browseNavigationPaths.indexOf(selectedPath);

    let prevTarget: NavigationTarget | null = null;
    let nextTarget: NavigationTarget | null = null;
    if (isSearchNavigationActive) {
        const lastIndex = searchNavigationPaths.length - 1;
        prevTarget = listTarget(
            searchNavigationPaths[
                searchNavigationIndex > 0
                    ? searchNavigationIndex - 1
                    : lastIndex
            ]
        );
        nextTarget = listTarget(
            searchNavigationPaths[
                searchNavigationIndex < lastIndex
                    ? searchNavigationIndex + 1
                    : 0
            ]
        );
    } else {
        const metadataPrev = metadataTarget(
            metadata,
            reverseMetadataOrder ? 'next' : 'previous'
        );
        const metadataNext = metadataTarget(
            metadata,
            reverseMetadataOrder ? 'previous' : 'next'
        );
        const outsideList = (target: NavigationTarget | null) =>
            target &&
            target.path !== selectedPath &&
            !browseNavigationPaths.includes(target.path)
                ? target
                : null;
        if (browseNavigationIndex === -1) {
            prevTarget = crossFolderAtEdges ? metadataPrev : null;
            nextTarget = crossFolderAtEdges ? metadataNext : null;
        } else {
            prevTarget =
                browseNavigationIndex > 0
                    ? listTarget(
                          browseNavigationPaths[browseNavigationIndex - 1]
                      )
                    : crossFolderAtEdges
                      ? outsideList(metadataPrev)
                      : null;
            nextTarget =
                browseNavigationIndex < browseNavigationPaths.length - 1
                    ? listTarget(
                          browseNavigationPaths[browseNavigationIndex + 1]
                      )
                    : crossFolderAtEdges
                      ? outsideList(metadataNext)
                      : null;
        }
    }

    const canNavigatePrev = Boolean(prevTarget);
    const canNavigateNext = Boolean(nextTarget);
    const prevPath = prevTarget?.path ?? '';
    const prevFolderPath = prevTarget?.folderPath ?? '';
    const prevInList = prevTarget?.inList ?? false;
    const nextPath = nextTarget?.path ?? '';
    const nextFolderPath = nextTarget?.folderPath ?? '';
    const nextInList = nextTarget?.inList ?? false;

    useEffect(() => {
        loadScreenshotRef.current = loadScreenshot;
    }, [loadScreenshot]);

    const navigateToPath = useCallback(
        async (path: string) => {
            setSelectedPath(path);
            if (onPathChange) {
                onPathChange(path);
                return;
            }
            await loadScreenshotRef.current(path, false);
        },
        [onPathChange, setSelectedPath]
    );

    const navigateToMetadataPath = useCallback(
        async (path: string, folderPath: string) => {
            if (onPathChange) {
                if (folderPath) {
                    onPathChange(path, folderPath);
                } else {
                    onPathChange(path);
                }
                return;
            }
            await loadScreenshotRef.current(path, true);
        },
        [onPathChange]
    );

    const navigateTo = useCallback(
        async (path: string, folderPath: string, inList: boolean) => {
            if (!path) {
                return;
            }
            if (inList) {
                await navigateToPath(path);
                return;
            }
            await navigateToMetadataPath(path, folderPath);
        },
        [navigateToMetadataPath, navigateToPath]
    );

    const navigatePrev = useCallback(
        () => navigateTo(prevPath, prevFolderPath, prevInList),
        [navigateTo, prevFolderPath, prevInList, prevPath]
    );

    const navigateNext = useCallback(
        () => navigateTo(nextPath, nextFolderPath, nextInList),
        [navigateTo, nextFolderPath, nextInList, nextPath]
    );

    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            const target = event.target;
            if (
                !enabled ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey ||
                (target instanceof HTMLElement &&
                    (target.isContentEditable ||
                        target.tagName === 'INPUT' ||
                        target.tagName === 'TEXTAREA' ||
                        target.tagName === 'SELECT'))
            ) {
                return;
            }

            if (event.key === 'ArrowLeft' && canNavigatePrev) {
                event.preventDefault();
                navigatePrev();
            }

            if (event.key === 'ArrowRight' && canNavigateNext) {
                event.preventDefault();
                navigateNext();
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [canNavigateNext, canNavigatePrev, enabled, navigateNext, navigatePrev]);

    return {
        canNavigateNext,
        canNavigatePrev,
        navigateNext,
        navigatePrev,
        nextFolderPath,
        nextPath,
        prevFolderPath,
        prevPath
    };
}
