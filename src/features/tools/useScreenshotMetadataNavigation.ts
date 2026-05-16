// @ts-nocheck
import { useCallback, useEffect, useRef } from 'react';

export function useScreenshotMetadataNavigation({
    loadScreenshot,
    metadata,
    onPathChange,
    searchNavigationPaths,
    selectedPath,
    setSelectedPath
}) {
    const loadScreenshotRef = useRef(loadScreenshot);

    useEffect(() => {
        loadScreenshotRef.current = loadScreenshot;
    }, [loadScreenshot]);

    const navigatePrev = useCallback(async () => {
        if (searchNavigationPaths.length && selectedPath) {
            const currentIndex = searchNavigationPaths.indexOf(selectedPath);
            if (currentIndex !== -1) {
                const prevIndex =
                    currentIndex > 0
                        ? currentIndex - 1
                        : searchNavigationPaths.length - 1;
                const nextPath = searchNavigationPaths[prevIndex];
                setSelectedPath(nextPath);
                if (onPathChange) {
                    onPathChange(nextPath);
                    return;
                }
                await loadScreenshotRef.current(nextPath, false);
                return;
            }
        }

        if (metadata?.previousFilePath) {
            if (onPathChange) {
                onPathChange(metadata.previousFilePath);
                return;
            }
            await loadScreenshotRef.current(metadata.previousFilePath, true);
        }
    }, [
        metadata?.previousFilePath,
        onPathChange,
        searchNavigationPaths,
        selectedPath,
        setSelectedPath
    ]);

    const navigateNext = useCallback(async () => {
        if (searchNavigationPaths.length && selectedPath) {
            const currentIndex = searchNavigationPaths.indexOf(selectedPath);
            if (currentIndex !== -1) {
                const nextIndex =
                    currentIndex < searchNavigationPaths.length - 1
                        ? currentIndex + 1
                        : 0;
                const nextPath = searchNavigationPaths[nextIndex];
                setSelectedPath(nextPath);
                if (onPathChange) {
                    onPathChange(nextPath);
                    return;
                }
                await loadScreenshotRef.current(nextPath, false);
                return;
            }
        }

        if (metadata?.nextFilePath) {
            if (onPathChange) {
                onPathChange(metadata.nextFilePath);
                return;
            }
            await loadScreenshotRef.current(metadata.nextFilePath, true);
        }
    }, [
        metadata?.nextFilePath,
        onPathChange,
        searchNavigationPaths,
        selectedPath,
        setSelectedPath
    ]);

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
    }, [navigateNext, navigatePrev]);

    return {
        navigateNext,
        navigatePrev
    };
}
