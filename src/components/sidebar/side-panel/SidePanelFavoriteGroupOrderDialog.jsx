import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';

import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';

export function SidePanelFavoriteGroupOrderDialog({
    open,
    onOpenChange,
    favoriteGroupOrderDraft,
    onMove,
    onReset,
    onConfirm,
    t
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[80vh] sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>
                        {t('side_panel.settings.edit_group_order')}
                    </DialogTitle>
                </DialogHeader>
                <div className="flex max-h-[50vh] flex-col gap-1 overflow-auto py-2">
                    {favoriteGroupOrderDraft.map((group, index) => (
                        <div
                            key={group.key}
                            className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
                        >
                            <span className="min-w-0 flex-1 truncate">
                                {group.label}
                            </span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Move ${group.label} up`}
                                disabled={index === 0}
                                onClick={() => onMove(index, -1)}
                            >
                                <ArrowUpIcon data-icon="inline-start" />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Move ${group.label} down`}
                                disabled={
                                    index === favoriteGroupOrderDraft.length - 1
                                }
                                onClick={() => onMove(index, 1)}
                            >
                                <ArrowDownIcon data-icon="inline-start" />
                            </Button>
                        </div>
                    ))}
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={onReset}
                    >
                        {t('common.actions.reset')}
                    </Button>
                    <Button type="button" size="sm" onClick={onConfirm}>
                        {t('common.actions.confirm')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
