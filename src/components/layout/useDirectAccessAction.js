import { useCallback, useRef } from 'react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { backend } from '@/platform/index.js';
import { directAccessParse } from '@/services/directAccessService.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

export function useDirectAccessAction() {
    const { t } = useI18n();
    const prompt = useModalStore((state) => state.prompt);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const busyRef = useRef(false);

    const openPrompt = useCallback(
        async (inputValue = '') => {
            const result = await prompt({
                title: t('prompt.direct_access_omni.header'),
                description:
                    'Open a VRChat user, avatar, world, group, launch URL, short link, or group shortcode.',
                confirmText: 'Open',
                cancelText: 'Cancel',
                inputValue,
                pattern: /\S+/
            });

            if (!result.ok) {
                return;
            }

            try {
                if (await directAccessParse(result.value, currentEndpoint)) {
                    toast.success('Opened direct access target.');
                    return;
                }
                toast.error('Could not parse that VRChat ID or URL.');
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : 'Direct access failed.'
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
                        toast.success('Opened from clipboard.');
                        return;
                    }
                } catch (error) {
                    toast.error(
                        error instanceof Error
                            ? error.message
                            : 'Direct access failed.'
                    );
                    return;
                }
            }
            await openPrompt(input);
        } finally {
            busyRef.current = false;
        }
    }, [currentEndpoint, openPrompt]);

    return {
        openDirectAccessPrompt: openPrompt,
        openDirectAccessFromClipboard: openFromClipboard
    };
}
