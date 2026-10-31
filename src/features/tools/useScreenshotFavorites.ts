import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type ScreenshotLibraryImage
} from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';

export function useScreenshotFavorites(enabled: boolean) {
    const { t } = useTranslation();
    const requestRef = useRef(0);
    const [favoriteImages, setFavoriteImages] = useState<
        ScreenshotLibraryImage[]
    >([]);
    const [favoritePaths, setFavoritePaths] = useState<ReadonlySet<string>>(
        () => new Set()
    );
    const [missingCount, setMissingCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);

    const reloadFavorites = useCallback(async () => {
        const requestId = requestRef.current + 1;
        requestRef.current = requestId;
        setIsLoading(true);
        try {
            const favorites = await commands.appGetFavoriteScreenshots();
            if (requestRef.current !== requestId) {
                return;
            }
            setFavoriteImages(favorites.images);
            setFavoritePaths(new Set(favorites.paths));
            setMissingCount(favorites.missingCount);
        } catch (error) {
            if (requestRef.current === requestId) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('common.errors.action_failed')
                });
            }
        } finally {
            if (requestRef.current === requestId) {
                setIsLoading(false);
            }
        }
    }, [t]);

    useEffect(() => {
        if (enabled) {
            void reloadFavorites();
        }
    }, [enabled, reloadFavorites]);

    const forgetFavoritePaths = useCallback((paths: string[]) => {
        requestRef.current += 1;
        setIsLoading(false);
        const removed = new Set(paths);
        setFavoriteImages((current) =>
            current.filter((image) => !removed.has(image.path))
        );
        setFavoritePaths(
            (current) =>
                new Set([...current].filter((path) => !removed.has(path)))
        );
    }, []);

    const setFavorite = useCallback(
        async (path: string, favorite: boolean) => {
            try {
                await commands.appSetScreenshotFavorite(path, favorite);
                if (favorite) {
                    await reloadFavorites();
                } else {
                    forgetFavoritePaths([path]);
                }
            } catch (error) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('common.errors.action_failed')
                });
            }
        },
        [forgetFavoritePaths, reloadFavorites, t]
    );

    const forgetMissingFavorites = useCallback(async () => {
        try {
            await commands.appForgetMissingScreenshotFavorites();
            await reloadFavorites();
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('common.errors.action_failed')
            });
        }
    }, [reloadFavorites, t]);

    return useMemo(
        () => ({
            favoriteImages,
            favoritePaths,
            forgetFavoritePaths,
            forgetMissingFavorites,
            isLoading,
            missingCount,
            reloadFavorites,
            setFavorite
        }),
        [
            favoriteImages,
            favoritePaths,
            forgetFavoritePaths,
            forgetMissingFavorites,
            isLoading,
            missingCount,
            reloadFavorites,
            setFavorite
        ]
    );
}
