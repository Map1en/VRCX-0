import { useRef, useState } from 'react';

import { avatarSearchProviderRepository } from '@/repositories/index.js';

export function useAvatarProviderConfig({ commit }) {
    const [avatarProviderConfig, setAvatarProviderConfig] = useState({
        enabled: true,
        providerList: [],
        selectedProvider: ''
    });
    const avatarProviderConfigRef = useRef(avatarProviderConfig);
    const avatarProviderSaveQueueRef = useRef(Promise.resolve());
    const avatarProviderSaveSeqRef = useRef(0);

    function applyAvatarProviderConfig(nextConfig) {
        avatarProviderConfigRef.current = nextConfig;
        setAvatarProviderConfig(nextConfig);
    }

    async function saveAvatarProviderConfig(nextConfig) {
        const saveSeq = avatarProviderSaveSeqRef.current + 1;
        avatarProviderSaveSeqRef.current = saveSeq;
        const saveTask = avatarProviderSaveQueueRef.current
            .catch(() => {})
            .then(() => avatarSearchProviderRepository.saveConfig(nextConfig));

        avatarProviderSaveQueueRef.current = saveTask.catch(() => {});
        const saved = await saveTask;
        if (saveSeq === avatarProviderSaveSeqRef.current) {
            applyAvatarProviderConfig(saved);
        }
        return saved;
    }

    function updateAvatarProvider(index, value) {
        setAvatarProviderConfig((current) => ({
            ...current,
            providerList: current.providerList.map((provider, providerIndex) =>
                providerIndex === index ? value : provider
            )
        }));
        avatarProviderConfigRef.current = {
            ...avatarProviderConfigRef.current,
            providerList: avatarProviderConfigRef.current.providerList.map(
                (provider, providerIndex) =>
                    providerIndex === index ? value : provider
            )
        };
    }

    function saveAvatarProviderField(index, value) {
        const currentConfig = avatarProviderConfigRef.current;
        const providerList = currentConfig.providerList.map(
            (provider, providerIndex) =>
                providerIndex === index ? value : provider
        );
        const nextConfig = {
            ...currentConfig,
            enabled:
                currentConfig.enabled &&
                providerList.some((provider) => provider.trim()),
            providerList
        };
        applyAvatarProviderConfig(nextConfig);
        void commit(() =>
            saveAvatarProviderConfig({
                ...nextConfig
            })
        );
    }

    function addAvatarProvider() {
        const nextConfig = {
            ...avatarProviderConfigRef.current,
            providerList: [...avatarProviderConfigRef.current.providerList, '']
        };
        applyAvatarProviderConfig(nextConfig);
    }

    function removeAvatarProvider(index) {
        const currentConfig = avatarProviderConfigRef.current;
        const nextProviderList = currentConfig.providerList.filter(
            (_, providerIndex) => providerIndex !== index
        );
        const nextConfig = {
            ...currentConfig,
            enabled: currentConfig.enabled && nextProviderList.length > 0,
            providerList: nextProviderList
        };
        applyAvatarProviderConfig(nextConfig);
        void commit(() => saveAvatarProviderConfig(nextConfig));
    }

    return {
        addAvatarProvider,
        applyAvatarProviderConfig,
        avatarProviderConfig,
        avatarProviderConfigRef,
        removeAvatarProvider,
        saveAvatarProviderConfig,
        saveAvatarProviderField,
        updateAvatarProvider
    };
}
