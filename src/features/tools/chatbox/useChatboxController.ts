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
    const latestConfig = useRef<ChatboxConfig | null>(null);
    const saveSequence = useRef(0);

    useEffect(() => {
        let active = true;
        void commands.appChatboxPreviewingSet(true);
        void Promise.all([
            commands.appChatboxEditorStateGet(),
            commands.appChatboxStatusGet()
        ]).then(([{ config: loadedConfig, ...loadedMeta }, loadedStatus]) => {
            if (!active) {
                return;
            }
            latestConfig.current = loadedConfig;
            setConfig(loadedConfig);
            setMeta(loadedMeta);
            if (loadedStatus) {
                useChatboxStore.getState().setStatus(loadedStatus);
            }
        });
        return () => {
            active = false;
            void commands.appChatboxPreviewingSet(false);
        };
    }, []);

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
            commands.appChatboxConfigSet(next).then(
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
            );
        },
        [t]
    );

    return { config, meta, status, updateConfig };
}
