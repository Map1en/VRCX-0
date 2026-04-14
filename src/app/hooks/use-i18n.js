import { useTranslation } from 'react-i18next';

import { useShellStore } from '@/state/shellStore.js';

export function useI18n() {
    const locale = useShellStore((state) => state.locale);
    const { t, i18n } = useTranslation();

    return { locale, t, i18n };
}
