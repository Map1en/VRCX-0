import { ImageCropDialog } from '@/components/media/ImageCropDialog.jsx';

import { GalleryPreviewDialog } from './GalleryPreviewDialog.jsx';

export function GalleryDialogs({
    cropRequest,
    onClearCropRequest,
    onConfirmCrop,
    onResetUploadAuthTarget,
    onClosePreview,
    preview,
    t
}) {
    return (
        <>
            <ImageCropDialog
                open={Boolean(cropRequest)}
                file={cropRequest?.file || null}
                aspectRatio={cropRequest?.aspectRatio || 1}
                title={t('dialog.change_content_image.upload')}
                onOpenChange={(open) => {
                    if (!open) {
                        onClearCropRequest();
                        onResetUploadAuthTarget();
                    }
                }}
                onConfirm={onConfirmCrop}
            />

            <GalleryPreviewDialog
                t={t}
                preview={preview}
                onClose={onClosePreview}
            />
        </>
    );
}
