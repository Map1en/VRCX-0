import { useCallback, useMemo, useState } from 'react';

import {
    readScreenshotGridSort,
    sortScreenshotGridImages,
    writeScreenshotGridSort,
    type ScreenshotGridSort
} from '@/components/media/screenshotGridPreferences';
import type { ScreenshotLibraryImage } from '@/platform/tauri/bindings';

export function useScreenshotBrowseImages(
    sourceImages: readonly ScreenshotLibraryImage[]
) {
    const [sort, setSortState] = useState(readScreenshotGridSort);
    const images = useMemo(
        () => sortScreenshotGridImages(sourceImages, sort),
        [sort, sourceImages]
    );
    const paths = useMemo(() => images.map((image) => image.path), [images]);
    const setSort = useCallback((next: ScreenshotGridSort) => {
        setSortState(next);
        writeScreenshotGridSort(next);
    }, []);

    return { images, paths, setSort, sort };
}
