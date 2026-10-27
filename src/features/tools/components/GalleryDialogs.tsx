import { useTranslation } from 'react-i18next';

import { ImageCropDialog } from '@/components/media/ImageCropDialog';

import type { GalleryCropRequest, GalleryUploadOptions } from '../galleryTypes';

export function GalleryDialogs({
    cropRequest,
    onClearCropRequest,
    onConfirmCrop
}: {
    cropRequest: GalleryCropRequest | null;
    onClearCropRequest: () => void;
    onConfirmCrop: (blob: Blob, options?: GalleryUploadOptions) => void;
}) {
    const { t } = useTranslation();
    const printNoteField =
        cropRequest?.tab === 'prints'
            ? {
                  label: t('dialog.gallery_icons.note'),
                  placeholder: t('dialog.gallery_icons.note'),
                  maxLength: 32
              }
            : undefined;
    const printCropWhiteBorderField =
        cropRequest?.tab === 'prints'
            ? {
                  label: t('dialog.gallery_icons.crop_print_border'),
                  defaultChecked: true
              }
            : undefined;

    return (
        <>
            <ImageCropDialog
                open={Boolean(cropRequest)}
                file={cropRequest?.file || null}
                aspectRatio={cropRequest?.aspectRatio || 1}
                title={t('dialog.change_content_image.upload')}
                noteField={printNoteField}
                cropWhiteBorderField={printCropWhiteBorderField}
                onOpenChange={(open) => {
                    if (!open) {
                        onClearCropRequest();
                    }
                }}
                onConfirm={onConfirmCrop}
            />
        </>
    );
}
