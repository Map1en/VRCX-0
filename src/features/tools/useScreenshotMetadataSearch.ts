import { useEffect, useMemo, useState } from 'react';

import type { ScreenshotLibraryImage } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';

import {
    DEFAULT_SCREENSHOT_SEARCH_SORT,
    EMPTY_SCREENSHOT_SEARCH,
    SCREENSHOT_SEARCH_LAYOUT_CONFIG_KEY,
    sortScreenshotSearchRows,
    type ScreenshotSearchRow,
    type ScreenshotSearchScope,
    type ScreenshotSearchSort
} from './screenshotMetadataValues';

export type ScreenshotSearchLayout = 'grid' | 'list';

export function useScreenshotMetadataSearch() {
    const [searchDraft, setSearchDraft] = useState('');
    const [searchScope, setSearchScope] = useState<ScreenshotSearchScope>(
        EMPTY_SCREENSHOT_SEARCH
    );
    const [withoutPeopleCount, setWithoutPeopleCount] = useState(0);
    const [searchRows, setSearchRows] = useState<ScreenshotSearchRow[]>([]);
    const [searchImages, setSearchImages] = useState<ScreenshotLibraryImage[]>(
        []
    );
    const [searchViewMode, setSearchViewMode] = useState<'detail' | 'results'>(
        'detail'
    );
    const [searchLayout, setSearchLayoutState] =
        useState<ScreenshotSearchLayout>('grid');
    const [searchSort, setSearchSort] = useState(
        DEFAULT_SCREENSHOT_SEARCH_SORT
    );
    const [selectedPath, setSelectedPath] = useState('');

    useEffect(() => {
        let active = true;
        configRepository
            .getString(SCREENSHOT_SEARCH_LAYOUT_CONFIG_KEY, 'grid')
            .then((storedLayout) => {
                if (active && storedLayout === 'list') {
                    setSearchLayoutState('list');
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    const sortedSearchRows = useMemo(
        () => sortScreenshotSearchRows(searchRows, searchSort),
        [searchRows, searchSort]
    );

    const sortedSearchImages = useMemo(() => {
        const imagesByPath = new Map(
            searchImages.map((image) => [image.path, image])
        );
        return sortedSearchRows.flatMap((row) => {
            const image = imagesByPath.get(row.filePath);
            return image ? [image] : [];
        });
    }, [searchImages, sortedSearchRows]);

    const searchNavigationPaths = useMemo(
        () => sortedSearchRows.map((row) => row.filePath),
        [sortedSearchRows]
    );

    function setSearchLayout(layout: ScreenshotSearchLayout) {
        setSearchLayoutState(layout);
        configRepository
            .setString(SCREENSHOT_SEARCH_LAYOUT_CONFIG_KEY, layout)
            .catch(() => {});
    }

    function setSearchResults({
        rows,
        images,
        withoutPeople = 0
    }: {
        rows: ScreenshotSearchRow[];
        images: ScreenshotLibraryImage[];
        withoutPeople?: number;
    }) {
        setSearchRows(rows);
        setSearchImages(images);
        setWithoutPeopleCount(withoutPeople);
    }

    function removeSearchPaths(paths: string[]) {
        const removedPaths = new Set(paths);
        setSearchRows((current) =>
            current.filter((row) => !removedPaths.has(row.filePath))
        );
        setSearchImages((current) =>
            current.filter((image) => !removedPaths.has(image.path))
        );
    }

    function resetSearchResults({ clearQuery = false } = {}) {
        setSearchRows([]);
        setSearchImages([]);
        setWithoutPeopleCount(0);
        setSelectedPath('');
        if (clearQuery) {
            setSearchDraft('');
            setSearchScope(EMPTY_SCREENSHOT_SEARCH);
        }
        setSearchViewMode('detail');
    }

    function toggleSearchSort(key: string) {
        setSearchSort((current: ScreenshotSearchSort) => {
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

    return {
        removeSearchPaths,
        resetSearchResults,
        searchLayout,
        searchNavigationPaths,
        searchDraft,
        searchRows,
        searchScope,
        searchSort,
        searchViewMode,
        selectedPath,
        setSearchLayout,
        setSearchDraft,
        setSearchResults,
        setSearchScope,
        setSearchViewMode,
        setSelectedPath,
        sortedSearchImages,
        sortedSearchRows,
        toggleSearchSort,
        withoutPeopleCount
    };
}
