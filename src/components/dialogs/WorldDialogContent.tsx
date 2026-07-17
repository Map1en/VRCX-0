import { WorldDialogContentController } from './WorldDialogContentController';
import type { WorldDialogWorkflowProps } from './WorldDialogContentWorkflow';

export function WorldDialogContent({
    worldId,
    seedData = null,
    initialAction = '',
    openNonce = 0,
    initialActionNonce = 0,
    initialNewInstanceDefaults = null
}: WorldDialogWorkflowProps) {
    return (
        <WorldDialogContentController
            worldId={worldId}
            seedData={seedData}
            initialAction={initialAction}
            openNonce={openNonce}
            initialActionNonce={initialActionNonce}
            initialNewInstanceDefaults={initialNewInstanceDefaults}
        />
    );
}
