import { useTranslation } from 'react-i18next';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from '@/ui/shadcn/alert-dialog';

import { getLoginUserDisplayName as getUserDisplayName } from '../loginDisplay.js';

export function DeleteSavedAccountDialog({
    deleteTarget,
    isDeleting,
    onOpenChange,
    onConfirm
}) {
    const { t } = useTranslation();
    const deleteTargetName = deleteTarget?.user
        ? getUserDisplayName(deleteTarget.user)
        : '';

    return (
        <AlertDialog
            open={Boolean(deleteTarget)}
            onOpenChange={(open) => onOpenChange(open)}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {t('view.login.saved_account_remove.title')}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {t('view.login.saved_account_remove.description', {
                            name: deleteTargetName
                        })}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting}>
                        {t('confirm.cancel_button')}
                    </AlertDialogCancel>
                    <AlertDialogAction
                        disabled={isDeleting}
                        onClick={() => void onConfirm()}
                    >
                        {isDeleting
                            ? t('view.login.saved_account_remove.removing')
                            : t('view.login.saved_account_remove.confirm')}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
