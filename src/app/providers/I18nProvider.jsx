import { useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';

import { appI18n, buildTimeUnitLabels, changeI18nLocale } from '@/services/i18nService.js';
import { DEFAULT_TIME_UNIT_LABELS, useShellStore } from '@/state/shellStore.js';

export function I18nProvider({ children }) {
    const locale = useShellStore((state) => state.locale);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let active = true;
        setReady(false);

        async function loadMessages() {
            const { fallbackMessages, localizedMessages } = await changeI18nLocale(locale || 'en');

            if (!active) {
                return;
            }

            useShellStore.getState().setTimeUnitLabels(
                buildTimeUnitLabels(localizedMessages, fallbackMessages, DEFAULT_TIME_UNIT_LABELS)
            );
            if (active) {
                setReady(true);
            }
        }

        loadMessages().catch((error) => {
            console.error('Failed to load localization payload:', error);
            if (active) {
                setReady(true);
            }
        });

        return () => {
            active = false;
        };
    }, [locale]);

    return <I18nextProvider i18n={appI18n}>{ready ? children : null}</I18nextProvider>;
}
