import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS } from '@/repositories/avatarSearchProviderRepository';
import avatarSearchProviderRepository from '@/repositories/avatarSearchProviderRepository';
import vrchatSearchRepository from '@/repositories/vrchatSearchRepository';
import { onPreferenceChanged } from '@/shared/events/preferenceEvents';
import { normalizeLanguageOptionsFromConfig } from '@/shared/utils/userLanguage';

import { emptyArray } from './searchResults';

export function useSearchConfig() {
    const { t } = useTranslation();
    const [worldCategories, setWorldCategories] = useState<any[]>([]);
    const [languageOptionsMap, setLanguageOptionsMap] = useState(
        () => new Map()
    );
    const [avatarProviderEnabled, setAvatarProviderEnabled] = useState(false);
    const [avatarProviderList, setAvatarProviderList] = useState<any[]>([]);
    const [selectedAvatarProvider, setSelectedAvatarProvider] = useState('');
    const [isAvatarProviderDialogOpen, setIsAvatarProviderDialogOpen] =
        useState(false);

    function applyAvatarProviderConfig(config: any) {
        setAvatarProviderEnabled(config.enabled);
        setAvatarProviderList(config.providerList);
        setSelectedAvatarProvider(config.selectedProvider || '');
    }

    useEffect(() => {
        let active = true;

        vrchatSearchRepository
            .getConfig()
            .then(({ json }: any) => {
                if (!active) {
                    return;
                }

                setWorldCategories(
                    emptyArray(json?.dynamicWorldRows).filter(
                        (row: any) => row?.index != null
                    )
                );
                setLanguageOptionsMap(
                    new Map(
                        normalizeLanguageOptionsFromConfig(json).map(
                            (option: any) => [option.key, option]
                        )
                    )
                );
            })
            .catch((error: any) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.search.toast.failed_to_load_world_categories')
                );
            });

        return () => {
            active = false;
        };
    }, [t]);

    useEffect(() => {
        let active = true;
        const unsubscribe = onPreferenceChanged(
            AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS,
            () => {
                avatarSearchProviderRepository
                    .getConfig()
                    .then((config: any) => {
                        if (active) {
                            applyAvatarProviderConfig(config);
                        }
                    })
                    .catch((error: any) => {
                        console.warn(
                            'Failed to refresh avatar providers:',
                            error
                        );
                    });
            }
        );

        avatarSearchProviderRepository
            .getConfig()
            .then((config: any) => {
                if (!active) {
                    return;
                }

                applyAvatarProviderConfig(config);
            })
            .catch((error: any) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.search.toast.failed_to_load_avatar_providers')
                );
            });

        return () => {
            active = false;
            unsubscribe();
        };
    }, [t]);

    function handleAvatarProviderChange(provider: any) {
        setSelectedAvatarProvider(provider);
        avatarSearchProviderRepository
            .saveSelectedProvider(provider)
            .catch((error: any) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.search.toast.failed_to_save_avatar_provider')
                );
            });
    }

    return {
        applyAvatarProviderConfig,
        avatarProviderEnabled,
        avatarProviderList,
        handleAvatarProviderChange,
        isAvatarProviderDialogOpen,
        languageOptionsMap,
        selectedAvatarProvider,
        setIsAvatarProviderDialogOpen,
        worldCategories
    };
}
