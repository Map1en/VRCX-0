import { WorldDialogContentWorkflow } from './WorldDialogContentWorkflow';
import type { WorldDialogWorkflowProps } from './WorldDialogContentWorkflow';

export function WorldDialogContentController(props: WorldDialogWorkflowProps) {
    return <WorldDialogContentWorkflow {...props} />;
}
