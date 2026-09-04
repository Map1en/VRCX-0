import { lazy } from 'react';

import { MountOnFirstOpen } from '@/components/hosts/MountOnFirstOpen';
import { useAssistantChatStore } from '@/state/assistantChatStore';

import { useAssistantEvents } from './useAssistantEvents';

const AssistantDialog = lazy(() =>
    import('./AssistantDialog').then((module) => ({
        default: module.AssistantDialog
    }))
);

export function AssistantDialogHost() {
    useAssistantEvents();
    const open = useAssistantChatStore((state) => state.open);
    return (
        <MountOnFirstOpen open={open}>
            <AssistantDialog />
        </MountOnFirstOpen>
    );
}
