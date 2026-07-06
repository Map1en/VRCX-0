import {
    AlertTriangleIcon,
    ImageIcon,
    RefreshCwIcon,
    StarIcon,
    StarOffIcon,
    Trash2Icon,
    UploadIcon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import mediaRepository from '@/repositories/vrchatMediaRepository';
import {
    printCleanupWarningMessageKey,
    printFavoriteWarningMessageKey
} from '@/shared/utils/printFavoriteMessages';
import { usePrintFavoriteStore } from '@/state/printFavoriteStore';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import { TabsContent } from '@/ui/shadcn/tabs';

import { EmptyState, LoadingState } from './GalleryViewParts';
import { MediaAssetTile } from './MediaAssetTile';
import { MediaLibraryToolbar } from './MediaLibraryToolbar';

type GalleryPrint = {
    files?: {
        image?: string;
    };
    id: string;
    note?: string;
};

type GridDensityConfig = {
    printsGridClass: string;
};

type GalleryPrintsTabState = {
    gridDensityConfig: GridDensityConfig;
    isVrcPlusSupporter: boolean;
    loading: boolean;
    mutatingKey?: string;
    onBeginUpload: (tab: 'prints') => unknown;
    onDeletePrint: (printId: string) => unknown;
    onPreview: (preview: { id: string; title: string; url: string }) => unknown;
    onRefresh: (tab: 'prints') => unknown;
    prints: GalleryPrint[];
    uploadingTab?: string;
};

type GalleryPrintsTabProps = {
    printsTab: GalleryPrintsTabState;
};

export function GalleryPrintsTab({ printsTab }: GalleryPrintsTabProps) {
    const {
        prints,
        loading,
        uploadingTab,
        mutatingKey,
        isVrcPlusSupporter,
        gridDensityConfig,
        onRefresh,
        onBeginUpload,
        onPreview,
        onDeletePrint
    } = printsTab;
    const { t } = useTranslation();
    const [favoriteMutatingId, setFavoriteMutatingId] = useState('');
    const favoriteIds = usePrintFavoriteStore((state) => state.favoriteIds);
    const maxFavorites = usePrintFavoriteStore((state) => state.maxFavorites);
    const favoriteWarning = usePrintFavoriteStore((state) => state.warning);
    const lastCleanup = usePrintFavoriteStore((state) => state.lastCleanup);
    const hydratePrintFavorites = usePrintFavoriteStore(
        (state) => state.hydratePrintFavorites
    );
    const favoritePrintIds = useMemo(() => new Set(favoriteIds), [favoriteIds]);
    const warningKey = printFavoriteWarningMessageKey(favoriteWarning);
    const cleanupWarningKey = printCleanupWarningMessageKey(
        lastCleanup?.warning
    );
    const favoriteWarningMessage = warningKey
        ? t(warningKey, {
              favorites: favoriteWarning?.favorites ?? 0,
              max: favoriteWarning?.max ?? maxFavorites,
              over: favoriteWarning?.over ?? 0
          })
        : '';
    const cleanupWarningMessage =
        !favoriteWarningMessage && cleanupWarningKey
            ? t(cleanupWarningKey, {
                  remaining: lastCleanup?.remaining ?? 0
              })
            : '';
    const cleanupMessage =
        !favoriteWarningMessage &&
        !cleanupWarningMessage &&
        lastCleanup &&
        lastCleanup.deleted > 0
            ? t('view.tools.prints_favorites.cleanup_deleted', {
                  count: lastCleanup.deleted,
                  remaining: lastCleanup.remaining
              })
            : '';
    const noticeMessage =
        favoriteWarningMessage || cleanupWarningMessage || cleanupMessage;
    const hasWarningNotice = Boolean(
        favoriteWarningMessage || cleanupWarningMessage
    );

    useEffect(() => {
        let cancelled = false;
        mediaRepository
            .getPrintFavorites()
            .then((state) => {
                if (!cancelled) {
                    hydratePrintFavorites(state);
                }
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    console.warn('Failed to load print favorites:', error);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [hydratePrintFavorites]);

    async function handleFavoriteToggle(
        printId: string,
        nextFavorite: boolean
    ) {
        setFavoriteMutatingId(printId);
        try {
            const state = await mediaRepository.setPrintFavorite(
                printId,
                nextFavorite
            );
            hydratePrintFavorites(state);
            if (nextFavorite && !state.favoriteIds.includes(printId)) {
                toast.error(
                    t('view.tools.prints_favorites.favorite_limit_toast', {
                        max: state.maxFavorites
                    })
                );
                return;
            }
            toast.success(
                t(
                    nextFavorite
                        ? 'view.tools.prints_favorites.favorited_toast'
                        : 'view.tools.prints_favorites.unfavorited_toast'
                )
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.tools.toast.failed_to_update_print_favorite')
            );
        } finally {
            setFavoriteMutatingId((current) =>
                current === printId ? '' : current
            );
        }
    }

    return (
        <TabsContent
            value="prints"
            className="mt-2 flex min-h-0 flex-1 data-hidden:hidden"
        >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <MediaLibraryToolbar
                    actions={
                        <>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onRefresh('prints')}
                            >
                                <RefreshCwIcon data-icon="inline-start" />
                                {t('dialog.gallery_icons.refresh')}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={
                                    !isVrcPlusSupporter || Boolean(uploadingTab)
                                }
                                onClick={() => onBeginUpload('prints')}
                            >
                                <UploadIcon data-icon="inline-start" />
                                {t('dialog.gallery_icons.upload')}
                            </Button>
                        </>
                    }
                />
                {noticeMessage ? (
                    <Alert
                        variant={hasWarningNotice ? 'destructive' : 'default'}
                        className="mb-2"
                    >
                        {hasWarningNotice ? (
                            <AlertTriangleIcon className="size-4" />
                        ) : null}
                        <AlertDescription>{noticeMessage}</AlertDescription>
                    </Alert>
                ) : null}
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                    {loading ? (
                        <LoadingState />
                    ) : prints.length > 0 ? (
                        <div
                            className={`${gridDensityConfig.printsGridClass} p-1`}
                        >
                            {prints.map((print) => {
                                const printId = String(print.id || '').trim();
                                if (!printId) {
                                    return null;
                                }
                                const imageUrl = print?.files?.image || '';
                                const isMutating =
                                    mutatingKey === `prints:${printId}` ||
                                    favoriteMutatingId === printId;
                                const isFavorite =
                                    favoritePrintIds.has(printId);

                                return (
                                    <MediaAssetTile
                                        key={printId}
                                        imageUrl={imageUrl}
                                        alt={print.note || printId}
                                        aspectClass="aspect-[2048/1440]"
                                        imageFit="contain"
                                        imagePosition="top"
                                        hideContent
                                        badges={
                                            isFavorite
                                                ? [
                                                      {
                                                          key: 'favorite',
                                                          label: t(
                                                              'view.tools.prints_favorites.favorite_badge'
                                                          ),
                                                          variant: 'secondary'
                                                      }
                                                  ]
                                                : undefined
                                        }
                                        placeholderIcon={ImageIcon}
                                        onPreview={() =>
                                            onPreview({
                                                id: printId,
                                                url: imageUrl,
                                                title:
                                                    print.note ||
                                                    t(
                                                        'dialog.gallery_icons.prints'
                                                    )
                                            })
                                        }
                                        menuLabel={t('aria.more')}
                                        menuActions={[
                                            {
                                                key: isFavorite
                                                    ? 'unfavorite'
                                                    : 'favorite',
                                                label: t(
                                                    isFavorite
                                                        ? 'view.tools.prints_favorites.unfavorite'
                                                        : 'view.tools.prints_favorites.favorite'
                                                ),
                                                icon: isFavorite
                                                    ? StarOffIcon
                                                    : StarIcon,
                                                disabled: isMutating,
                                                onSelect: () => {
                                                    void handleFavoriteToggle(
                                                        printId,
                                                        !isFavorite
                                                    );
                                                }
                                            },
                                            {
                                                key: 'delete',
                                                label: t(
                                                    'common.actions.delete'
                                                ),
                                                icon: Trash2Icon,
                                                destructive: true,
                                                disabled: isMutating,
                                                onSelect: () =>
                                                    onDeletePrint(printId)
                                            }
                                        ]}
                                    />
                                );
                            })}
                        </div>
                    ) : (
                        <EmptyState
                            title={t('view.tools.empty.no_prints_loaded')}
                            description={t(
                                'view.tools.action.refresh_this_tab_to_load_your_vrchat_prints'
                            )}
                        />
                    )}
                </div>
            </div>
        </TabsContent>
    );
}
