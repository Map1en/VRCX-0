import { ImageIcon, UploadIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';

import {
    EntityDialogTabContent,
    EntityInfoBlock,
    EntityInfoGrid
} from '../../EntityDialogScaffold';

export function AvatarDialogGalleryTab({
    canManageAvatar,
    actionStatus,
    media,
    onOpenGalleryPreview,
    onGalleryIndexChange,
    onUploadGallery
}: any) {
    const { t } = useTranslation();
    const { galleryImages, currentGalleryImage, galleryIndex, listings } =
        media;

    return (
        <EntityDialogTabContent value="gallery" forceMount>
            <EntityInfoGrid>
                {galleryImages.length || canManageAvatar ? (
                    <EntityInfoBlock
                        label={t('dialog.avatar.info.gallery')}
                        full
                    >
                        <div className="mt-2 flex w-full flex-col gap-2">
                            {canManageAvatar ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={actionStatus === 'gallery-upload'}
                                    onClick={onUploadGallery}
                                >
                                    <UploadIcon data-icon="inline-start" />
                                    {t('dialog.screenshot_metadata.upload')}
                                </Button>
                            ) : null}
                            {galleryImages.length ? (
                                <div className="flex flex-col gap-2">
                                    <Button
                                        type="button"
                                        disabled={!currentGalleryImage}
                                        variant="outline"
                                        className="bg-muted/20 h-52 w-full overflow-hidden p-0"
                                        onClick={onOpenGalleryPreview}
                                    >
                                        {currentGalleryImage ? (
                                            <img
                                                src={currentGalleryImage}
                                                alt=""
                                                className="size-full object-contain"
                                            />
                                        ) : (
                                            <span className="text-muted-foreground flex size-full items-center justify-center [&>svg]:size-8">
                                                <ImageIcon />
                                            </span>
                                        )}
                                    </Button>
                                    <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={galleryImages.length <= 1}
                                            onClick={() =>
                                                onGalleryIndexChange(
                                                    (currentIndex: any) =>
                                                        (currentIndex +
                                                            galleryImages.length -
                                                            1) %
                                                        galleryImages.length
                                                )
                                            }
                                        >
                                            {t('table.pagination.previous')}
                                        </Button>
                                        <span>
                                            {galleryIndex + 1} /{' '}
                                            {galleryImages.length}
                                        </span>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={galleryImages.length <= 1}
                                            onClick={() =>
                                                onGalleryIndexChange(
                                                    (currentIndex: any) =>
                                                        (currentIndex + 1) %
                                                        galleryImages.length
                                                )
                                            }
                                        >
                                            {t('table.pagination.next')}
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-muted-foreground rounded-md border border-dashed p-4 text-xs">
                                    {t('dialog.avatar.empty.no_gallery_images')}
                                </div>
                            )}
                        </div>
                    </EntityInfoBlock>
                ) : null}
                {listings.length ? (
                    <EntityInfoBlock
                        label={t('dialog.avatar.info.listings')}
                        full
                    >
                        <div className="flex flex-col gap-2">
                            {listings.map((listing: any, index: any) => (
                                <div
                                    key={`${listing?.id || listing?.platform || index}`}
                                    className="box-border flex flex-col p-1.5 text-sm"
                                >
                                    <div className="font-medium">
                                        {listing?.displayName ||
                                            listing?.name ||
                                            listing?.platform ||
                                            listing?.id ||
                                            t('dialog.avatar.info.listings')}
                                    </div>
                                    <div className="text-muted-foreground text-xs">
                                        {listing?.description ||
                                            listing?.createdAt ||
                                            listing?.id ||
                                            ''}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </EntityInfoBlock>
                ) : null}
            </EntityInfoGrid>
        </EntityDialogTabContent>
    );
}
