import { commands } from '@/platform/tauri/bindings';

import { stopRuntimeUpdateLoopAndWaitForIdle } from './updateLoopService';

export async function startBackgroundModeForCurrentSession() {
    await stopRuntimeUpdateLoopAndWaitForIdle();
    return commands.appStartBackgroundMode();
}
