import { useEffect, useState } from 'react';

import {
    commands,
    type AssistantRuntimeStatus
} from '@/platform/tauri/bindings';
import { useAssistantChatStore } from '@/state/assistantChatStore';

export function useAssistantRuntimeStatus(): AssistantRuntimeStatus | null {
    const open = useAssistantChatStore((state) => state.open);
    const [status, setStatus] = useState<AssistantRuntimeStatus | null>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        let active = true;
        commands
            .appAssistantRuntimeStatus()
            .then((next) => {
                if (active) {
                    setStatus(next);
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [open]);

    return status;
}
