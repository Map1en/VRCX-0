import { useTranslation } from 'react-i18next';

import { copyTextToClipboard } from '@/services/clipboardService';

export function useAvatarDialogClipboard() {
    const { t } = useTranslation();

    return function copyAvatarText(text: string, label: string) {
        return copyTextToClipboard(text, {
            successMessage: t('dialog.avatar.dynamic.value_copied', {
                value: label
            })
        });
    };
}
