import { useEffect, useState } from 'react';

import type { GroupProfileRecord } from '@/domain/entities/profileEntities';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';

import { normalizeLanguageOptionsFromConfig } from '../user-dialog/userProfileFields';
import { normalizeGroupLanguages } from './GroupDialogViewParts';

export function useGroupDialogLanguageRows({
    currentEndpoint,
    group
}: {
    currentEndpoint: string;
    group: GroupProfileRecord;
}) {
    const [vrchatConfigConstants, setVrchatConfigConstants] =
        useState<unknown>(null);

    useEffect(() => {
        let active = true;
        vrchatAuthRepository
            .getConfig({ endpoint: currentEndpoint })
            .then((response) => {
                if (active) {
                    setVrchatConfigConstants(response.json.constants || null);
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
