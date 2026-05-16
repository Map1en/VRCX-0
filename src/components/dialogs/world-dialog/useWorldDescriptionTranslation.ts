// @ts-nocheck
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    getTranslationConfig,
    translateText
} from '@/services/translationService.js';

export function useWorldDescriptionTranslation({ world }) {
    const { t } = useTranslation();
    const worldId = world?.id || '';
    const source = world?.description || '';
    const [descriptionTranslation, setDescriptionTranslation] = useState({
        worldId,
        source,
        text: ''
    });
    const [descriptionTranslationLoading, setDescriptionTranslationLoading] =
        useState(false);
    const translatedDescriptionActive = Boolean(
        descriptionTranslation.worldId === worldId &&
        descriptionTranslation.source === source &&
        descriptionTranslation.text
    );
    const visibleDescription = translatedDescriptionActive
        ? descriptionTranslation.text
        : source;

    useEffect(() => {
        setDescriptionTranslation({
            worldId,
            source,
            text: ''
        });
        setDescriptionTranslationLoading(false);
    }, [source, worldId]);

    async function toggleDescriptionTranslation() {
        if (!source || descriptionTranslationLoading) {
            return;
        }
        if (translatedDescriptionActive) {
            setDescriptionTranslation({
                worldId,
                source,
                text: ''
            });
            return;
        }

        setDescriptionTranslationLoading(true);
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
            setDescriptionTranslation({
                worldId,
                source,
                text: translated
            });
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.toast.translation_failed', {
                          defaultValue: 'Translation failed'
                      })
            );
        } finally {
            setDescriptionTranslationLoading(false);
        }
    }

    return {
        descriptionTranslationLoading,
        translatedDescriptionActive,
        toggleDescriptionTranslation,
        visibleDescription
    };
}
