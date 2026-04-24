import { FolderPlusIcon, PlusIcon, RotateCcwIcon } from 'lucide-react';

import { Button } from '@/ui/shadcn/button';
import { DialogFooter } from '@/ui/shadcn/dialog';

export function CustomNavDialogFooter({
    onAddDashboard,
    onAddFolder,
    onCancel,
    onReset,
    onSave,
    t
}) {
    return (
        <DialogFooter className="items-center justify-between sm:justify-between">
            <div className="flex flex-wrap gap-2">
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => void onAddFolder()}
                >
                    <FolderPlusIcon data-icon="inline-start" />
                    {t('nav_menu.custom_nav.new_folder')}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => void onAddDashboard()}
                >
                    <PlusIcon data-icon="inline-start" />
                    {t('dashboard.new_dashboard')}
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive"
                    onClick={onReset}
                >
                    <RotateCcwIcon data-icon="inline-start" />
                    {t('nav_menu.custom_nav.restore_default')}
                </Button>
            </div>
            <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={onCancel}>
                    {t('nav_menu.custom_nav.cancel')}
                </Button>
                <Button type="button" onClick={() => void onSave()}>
                    {t('common.actions.confirm')}
                </Button>
            </div>
        </DialogFooter>
    );
}
