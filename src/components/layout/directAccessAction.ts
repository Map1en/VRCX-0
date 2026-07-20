import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { directAccessParse } from '@/services/directAccessService';
import { getClipboardText } from '@/services/shellIntegrationService';
import { useModalStore } from '@/state/modalStore';

export function useDirectAccessAction() {
    const { t } = useTranslation();
    const prompt = useModalStore((state) => state.prompt);
    const busyRef = useRef(false);

    const tryOpenDirectAccess = useCallback(
        async (input: any) => {
            const toastId = toast.loading(
                t('prompt.direct_access_omni.message.opening')
            );
            try {
                return await directAccessParse(input);
            } catch (error) {
                console.warn('Direct access failed:', error);
                return false;
            } finally {
                toast.dismiss(toastId);
            }
        },
        [t]
    );

    const openPrompt = useCallback(
        async (
            inputValue: any = '',
            description: any = t('prompt.direct_access_omni.description')
        ) => {
            const result = await prompt({
                title: t('prompt.direct_access_omni.header'),
                description,
                confirmText: t('prompt.direct_access_omni.ok'),
                cancelText: t('prompt.direct_access_omni.cancel'),
                inputValue,
                pattern: /\S+/
            });

            if (!result.ok) {
                return;
            }

            if (await tryOpenDirectAccess(result.value)) {
                return;
            }

            await openPrompt(
                result.value,
                t('prompt.direct_access_omni.description_failed')
            );
        },
        [prompt, t, tryOpenDirectAccess]
    );

    const openFromClipboard = useCallback(async () => {
        if (busyRef.current) {
            return;
        }

        busyRef.current = true;
        try {
            const toastId = toast.loading(
                t('prompt.direct_access_omni.message.opening')
            );
            const input = (await getClipboardText()).trim();
            try {
                if (input && (await directAccessParse(input))) {
                    return;
                }
            } catch (error) {
                console.warn('Direct access failed:', error);
            } finally {
                toast.dismiss(toastId);
            }

            await openPrompt(
                input,
                input
                    ? t('prompt.direct_access_omni.description_failed')
                    : t('prompt.direct_access_omni.description')
            );
        } finally {
            busyRef.current = false;
        }
    }, [openPrompt, t]);

    return {
        openDirectAccessPrompt: openPrompt,
        openDirectAccessFromClipboard: openFromClipboard
    };
}
