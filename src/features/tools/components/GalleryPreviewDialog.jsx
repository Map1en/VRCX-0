import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';

export function GalleryPreviewDialog({ t, preview, onClose }) {
    return (
        <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-5xl">
                <DialogHeader>
                    <DialogTitle>
                        {preview?.title ||
                            preview?.id ||
                            t('dialog.gallery_icons.gallery')}
                    </DialogTitle>
                    <DialogDescription>{preview?.id || ''}</DialogDescription>
                </DialogHeader>
                {preview?.url ? (
                    <img
                        src={preview.url}
                        alt={preview?.title || preview.id}
                        className="max-h-[75vh] w-full rounded-lg object-contain"
                    />
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
