import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { copyTextToClipboard } from '@/services/clipboardService';
import { openDiscordProfile as openShellDiscordProfile } from '@/services/shellIntegrationService';

export function useUserDialogClipboardActions() {
    const { t } = useTranslation();

    function copyUserText(text: string, label: string) {
        return copyTextToClipboard(text, {
            successMessage: t('dialog.user.dynamic.value_copied', {
                value: label
            })
        });
    }

    async function openDiscordProfile(discordId: any) {
        try {
            await openShellDiscordProfile(discordId);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.toast.failed_to_open_discord_profile')
            );
        }
    }

    return {
        copyUserText,
        openDiscordProfile
    };
}
