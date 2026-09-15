import {
    AlertTriangleIcon,
    ImageIcon,
    StarIcon,
    StarOffIcon,
    Trash2Icon,
    UploadIcon
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTileSelectionState } from '@/lib/useTileSelectionState';
import mediaRepository from '@/repositories/vrchatMediaRepository';
import { toast } from '@/services/toastService';
import {
    printCleanupWarningMessageKey,
    printFavoriteWarningMessageKey
} from '@/shared/utils/printFavoriteMessages';
import { usePrintFavoriteStore } from '@/state/printFavoriteStore';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import { TabsContent } from '@/ui/shadcn/tabs';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

import type { GalleryBulkCommands } from '../galleryTypes';
import { GallerySelectionBar } from './GallerySelectionBar';
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

type PrintFavoriteFilter = 'all' | 'favorites' | 'others';

const PRINT_FAVORITE_FILTERS: PrintFavoriteFilter[] = [
    'all',
    'favorites',
    'others'
];

export type GalleryPrintsTabState = {
    activeTab: string;
    gridDensityConfig: GridDensityConfig;
    isVrcPlusSupporter: boolean;
    loading: boolean;
    mutatingKey?: string;
    onBeginUpload: (tab: 'prints') => void;
    onDeletePrint: (printId: string) => void;
    onPreview: (preview: { id: string; title: string; url: string }) => void;
    onRefresh: (tab: 'prints') => void;
    prints: GalleryPrint[];
    uploadingTab?: string;
} & GalleryBulkCommands;

type GalleryPrintsTabProps = {
    printsTab: GalleryPrintsTabState;
};

export function GalleryPrintsTab({ printsTab }: GalleryPrintsTabProps) {
    const {
        activeTab,
        bulkRunning,
        prints,
        loading,
        uploadingTab,
        mutatingKey,
        isVrcPlusSupporter,
        gridDensityConfig,
        onRefresh,
        onBeginUpload,
        onPreview,
        onBulkDelete,
        onBulkSetFavorite,
        onDeletePrint
    } = printsTab;
    const { t } = useTranslation();
    const [favoriteMutatingId, setFavoriteMutatingId] = useState('');
    const [favoriteFilter, setFavoriteFilter] =
        useState<PrintFavoriteFilter>('all');
    const favoriteIds = usePrintFavoriteStore((state) => state.favoriteIds);
    const maxFavorites = usePrintFavoriteStore((state) => state.maxFavorites);
    const favoriteWarning = usePrintFavoriteStore((state) => state.warning);
    const lastCleanup = usePrintFavoriteStore((state) => state.lastCleanup);
    const hydratePrintFavorites = usePrintFavoriteStore(
        (state) => state.hydratePrintFavorites
    );
    const favoritePrintIds = useMemo(() => new Set(favoriteIds), [favoriteIds]);
    const visiblePrints = useMemo(() => {
        const withId = prints.filter((print) =>
            Boolean(String(print.id || '').trim())
        );
        if (favoriteFilter === 'favorites') {
            return withId.filter((print) => favoritePrintIds.has(print.id));
        }
        if (favoriteFilter === 'others') {
            return withId.filter((print) => !favoritePrintIds.has(print.id));
        }
        return withId;
    }, [favoriteFilter, favoritePrintIds, prints]);
    const visiblePrintIds = useMemo(
        () => visiblePrints.map((print) => print.id),
        [visiblePrints]
    );
    const selection = useTileSelectionState({
        keys: visiblePrintIds,
        resetToken: `${activeTab}:${favoriteFilter}`
    });
    const selectedPrintIds = useMemo(
        () => visiblePrintIds.filter((id) => selection.selectedKeysSet.has(id)),
        [selection.selectedKeysSet, visiblePrintIds]
    );
    const deletablePrintIds = useMemo(
        () => selectedPrintIds.filter((id) => !favoritePrintIds.has(id)),
        [favoritePrintIds, selectedPrintIds]
    );
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
                toast.add({
                    type: 'error',
                    title: t(
                        'view.tools.prints_favorites.favorite_limit_toast',
                        {
                            max: state.maxFavorites
                        }
                    )
                });
                return;
            }
            toast.add({
                type: 'success',
                title: t(
                    nextFavorite
                        ? 'view.tools.prints_favorites.favorited_toast'
                        : 'view.tools.prints_favorites.unfavorited_toast'
                )
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.tools.toast.failed_to_update_print_favorite')
            });
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
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                <MediaLibraryToolbar
                    leading={
                        <ToggleGroup
                            value={[favoriteFilter]}
                            onValueChange={(next) => {
                                const selected = PRINT_FAVORITE_FILTERS.find(
                                    (filter) => filter === next[0]
                                );
                                if (selected) {
                                    setFavoriteFilter(selected);
                                }
                            }}
                            variant="outline"
                            size="sm"
                        >
                            {PRINT_FAVORITE_FILTERS.map((filter, index) => (
                                <Fragment key={filter}>
                                    {index > 0 ? (
                                        <ToggleGroupSeparator />
                                    ) : null}
                                    <ToggleGroupItem value={filter}>
                                        {t(
                                            `view.tools.prints_filter.${filter}`
                                        )}
                                    </ToggleGroupItem>
                                </Fragment>
                            ))}
                        </ToggleGroup>
                    }
                    actions={
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
                    ) : visiblePrints.length > 0 ? (
                        <div
                            className={`${gridDensityConfig.printsGridClass} p-1`}
                        >
                            {visiblePrints.map((print) => {
                                const printId = print.id;
                                const imageUrl = print?.files?.image || '';
                                const isMutating =
                                    mutatingKey === `prints:${printId}` ||
                                    favoriteMutatingId === printId ||
                                    bulkRunning;
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
                                        selectable
                                        selected={selection.selectedKeysSet.has(
                                            printId
                                        )}
                                        selectionActive={selection.hasSelection}
                                        selectLabel={`${t('common.actions.select')} ${print.note || printId}`}
                                        onToggleSelect={(checked, shift) =>
                                            selection.selectItem(
                                                printId,
                                                checked,
                                                { shift }
                                            )
                                        }
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
                                                label: isFavorite
                                                    ? t(
                                                          'view.tools.gallery_selection.delete_locked_favorite'
                                                      )
                                                    : t(
                                                          'common.actions.delete'
                                                      ),
                                                icon: Trash2Icon,
                                                destructive: true,
                                                disabled:
                                                    isMutating || isFavorite,
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
                            icon={ImageIcon}
                            title={t('empty_state.prints_title')}
                            description={t('empty_state.prints_description')}
                        >
                            <Button
                                type="button"
                                variant="link"
                                onClick={() => onRefresh('prints')}
                            >
                                {t('dialog.gallery_icons.refresh')}
                            </Button>
                        </EmptyState>
                    )}
                </div>
                <GallerySelectionBar
                    selectedCount={selectedPrintIds.length}
                    deletableCount={deletablePrintIds.length}
                    isAllSelected={selection.isAllSelected}
                    actionsDisabled={bulkRunning}
                    favoriteActions={{
                        onFavorite: () =>
                            onBulkSetFavorite({
                                printIds: selectedPrintIds,
                                favorite: true
                            }),
                        onUnfavorite: () =>
                            onBulkSetFavorite({
                                printIds: selectedPrintIds,
                                favorite: false
                            })
                    }}
                    onSelectAll={selection.toggleSelectAll}
                    onClearSelection={selection.clearSelection}
                    onDelete={() =>
                        onBulkDelete({
                            tab: 'prints',
                            assetIds: deletablePrintIds,
                            lockedCount:
                                selectedPrintIds.length -
                                deletablePrintIds.length
                        })
                    }
                />
            </div>
        </TabsContent>
    );
}
