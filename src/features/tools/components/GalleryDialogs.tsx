// @ts-nocheck
import { ImageCropDialog } from '@/components/media/ImageCropDialog';

export function GalleryDialogs({
    cropRequest,
    onClearCropRequest,
    onConfirmCrop,
    onResetUploadAuthTarget,
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
        </>
    );
}
