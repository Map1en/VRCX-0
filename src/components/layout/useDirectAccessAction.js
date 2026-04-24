import { useCallback, useRef } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { backend } from '@/platform/index.js';
import { directAccessParse } from '@/services/directAccessService.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

export function useDirectAccessAction() {
    const { t } = useTranslation();
    const prompt = useModalStore((state) => state.prompt);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const busyRef = useRef(false);

    const openPrompt = useCallback(
        async (inputValue = '') => {
            const result = await prompt({
                title: t('prompt.direct_access_omni.header'),
                description: t('prompt.direct_access_omni.description'),
                confirmText: t('prompt.direct_access_omni.ok'),
                cancelText: t('prompt.direct_access_omni.cancel'),
                inputValue,
                pattern: /\S+/
            });

            if (!result.ok) {
                return;
            }

            try {
                if (await directAccessParse(result.value, currentEndpoint)) {
                    toast.success(
                        t('prompt.direct_access_omni.message.opened')
                    );
                    return;
                }
                toast.error(t('prompt.direct_access_omni.message.error'));
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('prompt.direct_access_omni.message.failed')
                );
            }
        },
        [currentEndpoint, prompt, t]
    );

    const openFromClipboard = useCallback(async () => {
        if (busyRef.current) {
            return;
        }

        busyRef.current = true;
        try {
            const clipboardText = await backend.app.GetClipboard().catch(
                () => ''
            );
            const input =
                typeof clipboardText === 'string' ? clipboardText.trim() : '';
            if (input) {
                try {
                    if (await directAccessParse(input, currentEndpoint)) {
                        toast.success(
                            t(
                                'prompt.direct_access_omni.message.opened_from_clipboard'
                            )
                        );
                        return;
                    }
                } catch (error) {
                    toast.error(
                        error instanceof Error
                            ? error.message
                            : t('prompt.direct_access_omni.message.failed')
                    );
                    return;
                }
            }
            await openPrompt(input);
        } finally {
            busyRef.current = false;
        }
    }, [currentEndpoint, openPrompt, t]);

    return {
        openDirectAccessPrompt: openPrompt,
        openDirectAccessFromClipboard: openFromClipboard
    };
}
