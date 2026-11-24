import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type ChatboxConfig,
    type ChatboxEditorState
} from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useChatboxStore } from '@/state/chatboxStore';

import type { ChatboxConfigUpdate } from './chatboxConfig';

export type ChatboxEditorMeta = Omit<ChatboxEditorState, 'config'>;

export function useChatboxController() {
    const { t } = useTranslation();
    const [config, setConfig] = useState<ChatboxConfig | null>(null);
    const [meta, setMeta] = useState<ChatboxEditorMeta | null>(null);
    const status = useChatboxStore((state) => state.status);
    const savedConfig = useChatboxStore((state) => state.savedConfig);
    const latestConfig = useRef<ChatboxConfig | null>(null);
    const saveSequence = useRef(0);
    const pendingSaves = useRef(0);
    const [loadFailed, setLoadFailed] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);

    useEffect(() => {
        void commands.appChatboxPreviewingSet(true);
        return () => {
            void commands.appChatboxPreviewingSet(false);
        };
    }, []);

    useEffect(() => {
        let active = true;
        Promise.all([
            commands.appChatboxEditorStateGet(),
            commands.appChatboxStatusGet()
        ]).then(
            ([{ config: loadedConfig, ...loadedMeta }, loadedStatus]) => {
                if (!active) {
                    return;
                }
                latestConfig.current = loadedConfig;
                setConfig(loadedConfig);
                setMeta(loadedMeta);
                if (loadedStatus) {
                    useChatboxStore.getState().setStatus(loadedStatus);
                }
            },
            (error: unknown) => {
                if (!active) {
                    return;
                }
                console.warn('Failed to load Chatbox settings:', error);
                setLoadFailed(true);
            }
        );
        return () => {
            active = false;
        };
    }, [loadAttempt]);

    const reload = useCallback(() => {
        setLoadFailed(false);
        setLoadAttempt((attempt) => attempt + 1);
    }, []);

    useEffect(() => {
        if (!savedConfig || !latestConfig.current || pendingSaves.current > 0) {
            return;
        }
        latestConfig.current = savedConfig;
        setConfig(savedConfig);
    }, [savedConfig]);

    const updateConfig = useCallback(
        (update: ChatboxConfigUpdate) => {
            const current = latestConfig.current;
            if (!current) {
                return;
            }
            const next = update(current);
            latestConfig.current = next;
            setConfig(next);
            const sequence = ++saveSequence.current;
            pendingSaves.current += 1;
            commands
                .appChatboxConfigSet(next)
                .then(
                    (saved) => {
                        if (sequence === saveSequence.current) {
                            latestConfig.current = saved;
                            setConfig(saved);
                        }
                    },
                    () =>
                        toast.add({
                            type: 'error',
                            title: t('view.tools.chatbox.save_failed')
                        })
                )
                .finally(() => {
                    pendingSaves.current -= 1;
                });
        },
        [t]
    );

    return { config, meta, status, loadFailed, reload, updateConfig };
}
