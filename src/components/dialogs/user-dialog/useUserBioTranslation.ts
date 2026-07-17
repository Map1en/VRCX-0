import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { UserProfileEntity } from '@/domain/entities/profileEntities';
import {
    getTranslationConfig,
    translateText
} from '@/services/translationService';

type BioTranslation = {
    userId: string;
    source: string;
    text: string;
};

export function useUserBioTranslation({
    profile
}: {
    profile: UserProfileEntity | null;
}) {
    const { t } = useTranslation();
    const userId = profile?.id || '';
    const source = profile?.bio || '';
    const [bioTranslation, setBioTranslation] = useState<BioTranslation>({
        userId,
        source,
        text: ''
    });
    const [bioTranslationLoading, setBioTranslationLoading] = useState(false);
    const translatedBioActive = Boolean(
        bioTranslation.userId === userId &&
        bioTranslation.source === source &&
        bioTranslation.text
    );
    const visibleBio = translatedBioActive
        ? bioTranslation.text
        : source || '\u2014';

    useEffect(() => {
        setBioTranslation({
            userId,
            source,
            text: ''
        });
        setBioTranslationLoading(false);
    }, [source, userId]);

    async function toggleBioTranslation() {
        if (!source || bioTranslationLoading) {
            return;
        }
        if (translatedBioActive) {
            setBioTranslation({
                userId,
                source,
                text: ''
            });
            return;
        }

        setBioTranslationLoading(true);
        try {
            const config = await getTranslationConfig();
            const translated = await translateText(
                source,
                config.bioLanguage,
                config
            );
            if (!translated) {
                throw new Error('No translation returned.');
            }
            setBioTranslation({
                userId,
                source,
                text: translated
            });
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.toast.translation_failed')
            );
        } finally {
            setBioTranslationLoading(false);
        }
    }

    return {
        bioTranslationLoading,
        translatedBioActive,
        toggleBioTranslation,
        visibleBio
    };
}
