import { useEffect, useState } from 'react';

import { vrchatAuthRepository } from '@/repositories/index.js';

import { normalizeLanguageOptionsFromConfig } from '../user-dialog/userProfileFields.js';
import { normalizeGroupLanguages } from './GroupDialogViewParts.jsx';

export function useGroupDialogLanguageRows({ currentEndpoint, group }) {
    const [vrchatConfigConstants, setVrchatConfigConstants] = useState(null);

    useEffect(() => {
        let active = true;
        vrchatAuthRepository
            .getConfig({ endpoint: currentEndpoint })
            .then((response) => {
                if (active) {
                    setVrchatConfigConstants(response?.json?.constants || null);
                }
            })
            .catch(() => {
                if (active) {
                    setVrchatConfigConstants(null);
                }
            });
        return () => {
            active = false;
        };
    }, [currentEndpoint]);

    const languageOptions = normalizeLanguageOptionsFromConfig({
        constants: vrchatConfigConstants
    });
    const languageOptionsMap = new Map(
        languageOptions.map((option) => [option.key, option])
    );
    return normalizeGroupLanguages(group, languageOptionsMap);
}
