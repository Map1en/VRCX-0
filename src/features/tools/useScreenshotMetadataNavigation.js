import { useCallback, useEffect, useRef } from 'react';

export function useScreenshotMetadataNavigation({
    loadScreenshot,
    metadata,
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
                setSelectedPath(searchNavigationPaths[prevIndex]);
                await loadScreenshotRef.current(
                    searchNavigationPaths[prevIndex],
                    false
                );
                return;
            }
        }

        if (metadata?.previousFilePath) {
            await loadScreenshotRef.current(metadata.previousFilePath, true);
        }
    }, [
        metadata?.previousFilePath,
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
                setSelectedPath(searchNavigationPaths[nextIndex]);
                await loadScreenshotRef.current(
                    searchNavigationPaths[nextIndex],
                    false
                );
                return;
            }
        }

        if (metadata?.nextFilePath) {
            await loadScreenshotRef.current(metadata.nextFilePath, true);
        }
    }, [
        metadata?.nextFilePath,
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
