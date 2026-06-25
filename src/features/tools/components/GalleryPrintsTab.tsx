import { ImageIcon, RefreshCwIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import { TabsContent } from '@/ui/shadcn/tabs';

import { EmptyState, LoadingState } from './GalleryViewParts';
import { MediaAssetTile } from './MediaAssetTile';
import { MediaLibraryToolbar } from './MediaLibraryToolbar';

export function GalleryPrintsTab({ printsTab }: any) {
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

    return (
        <TabsContent
            value="prints"
            className="mt-2 min-h-0 flex-1 data-[state=active]:flex data-[state=inactive]:hidden"
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
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                    {loading ? (
                        <LoadingState />
                    ) : prints.length > 0 ? (
                        <div
                            className={`${gridDensityConfig.printsGridClass} p-1`}
                        >
                            {prints.map((print: any) => {
                                const imageUrl = print?.files?.image || '';
                                const isMutating =
                                    mutatingKey === `prints:${print.id}`;

                                return (
                                    <MediaAssetTile
                                        key={print.id}
                                        imageUrl={imageUrl}
                                        alt={print.note || print.id}
                                        aspectClass="aspect-[2048/1440]"
                                        imageFit="contain"
                                        imagePosition="top"
                                        hideContent
                                        placeholderIcon={ImageIcon}
                                        onPreview={() =>
                                            onPreview({
                                                id: print.id,
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
                                                key: 'delete',
                                                label: t(
                                                    'common.actions.delete'
                                                ),
                                                icon: Trash2Icon,
                                                destructive: true,
                                                disabled: isMutating,
                                                onSelect: () =>
                                                    onDeletePrint(print.id)
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
