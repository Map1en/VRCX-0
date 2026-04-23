import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';

export function FriendListUserLoadDialog({
    t,
    open,
    progress,
    percent,
    onCancel
}) {
    return (
        <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
            <DialogContent showCloseButton={false} className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {t('view.friend_list.generated.loading_friend_details')}
                    </DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-2">
                    <div className="bg-muted h-4 overflow-hidden rounded-full border">
                        <div
                            className="bg-primary h-full"
                            role="progressbar"
                            aria-label={t(
                                'view.friend_list.generated.loading_friend_details'
                            )}
                            aria-valuemin={0}
                            aria-valuemax={progress.total || 100}
                            aria-valuenow={progress.current}
                            aria-valuetext={`${progress.current} / ${progress.total}`}
                            style={{ width: `${percent}%` }}
                        />
                    </div>
                    <div className="text-muted-foreground text-right text-xs">
                        {progress.current} / {progress.total}
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={progress.cancelled}
                        onClick={onCancel}
                    >
                        {progress.cancelled
                            ? t('view.friend_list.generated.cancelling')
                            : t('view.friend_list.load_cancel')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
