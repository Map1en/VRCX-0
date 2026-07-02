import { useEffect, useState } from 'react';

import { commands } from '@/platform/tauri/bindings';
import { useAssistantChatStore } from '@/state/assistantChatStore';

export type AssistantHealth = 'checking' | 'ok' | 'error' | 'unconfigured';

export function useAssistantHealth(endpointId: string | null): AssistantHealth {
    const open = useAssistantChatStore((state) => state.open);
    const [health, setHealth] = useState<AssistantHealth>('unconfigured');

    useEffect(() => {
        if (!open) {
            return;
        }
        if (!endpointId) {
            setHealth('unconfigured');
            return;
        }
        let active = true;
        setHealth('checking');
        commands
            .appLlmEndpointDetectModels({
                id: endpointId,
                baseUrl: null,
                apiKey: null,
                persist: false
            })
            .then(() => {
                if (active) {
                    setHealth('ok');
                }
            })
            .catch(() => {
                if (active) {
                    setHealth('error');
                }
            });
        return () => {
            active = false;
        };
    }, [open, endpointId]);

    return health;
}
