import {
    commands,
    type InstanceLaunchMode,
    type InstanceLaunchOutcome
} from '@/platform/tauri/bindings';
import { normalizeString } from '@/shared/utils/string';

function failedReason(outcome: InstanceLaunchOutcome): string {
    return outcome.status === 'failed'
        ? outcome.reason
        : 'VRChat action failed.';
}

async function runJoinAction({
    location,
    mode,
    shortName = ''
}: {
    location: unknown;
    mode: InstanceLaunchMode;
    shortName?: unknown;
}): Promise<InstanceLaunchOutcome> {
    return commands.appVrchatInstanceJoin({
        location: normalizeString(location),
        shortName: normalizeString(shortName),
        mode
    });
}

async function openInstanceInGame(
    location: unknown,
    shortName: unknown = ''
): Promise<boolean> {
    try {
        const outcome = await runJoinAction({
            location,
            shortName,
            mode: 'openOnly'
        });
        return outcome.status === 'opened';
    } catch (error) {
        console.warn('Failed to open VRChat launch URL through IPC:', error);
        return false;
    }
}

async function sendSelfInviteToInstance(
    location: unknown,
    shortName: unknown = ''
): Promise<void> {
    const outcome = await runJoinAction({
        location,
        shortName,
        mode: 'selfInviteOnly'
    });
    if (outcome.status !== 'selfInvited') {
        throw new Error(failedReason(outcome));
    }
}

async function joinInstanceWithFallback(
    location: unknown,
    shortName: unknown = ''
): Promise<InstanceLaunchOutcome> {
    return runJoinAction({
        location,
        shortName,
        mode: 'auto'
    });
}

export {
    joinInstanceWithFallback,
    openInstanceInGame,
    sendSelfInviteToInstance
};
