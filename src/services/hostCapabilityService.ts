import { commands } from '@/platform/tauri/bindings';
import type {
    CapabilityStatus as HostCapabilityStatus,
    HostCapabilities
} from '@/platform/tauri/bindings';
import {
    createUnavailableHostCapabilities,
    useRuntimeStore
} from '@/state/runtimeStore';

export type HostCapabilityKey = {
    [
        K in keyof HostCapabilities
    ]: HostCapabilities[K] extends HostCapabilityStatus ? K : never;
}[keyof HostCapabilities];

export async function initializeHostCapabilities(
    prefetchedCapabilities?: HostCapabilities
): Promise<HostCapabilities> {
    const runtimeStore = useRuntimeStore.getState();
    runtimeStore.setStartupTask(
        'capabilities',
        'running',
        'Loading host capabilities.'
    );

    try {
        const capabilities =
            prefetchedCapabilities ?? (await commands.appGetHostCapabilities());
        useRuntimeStore.getState().setHostCapabilities(capabilities);
        useRuntimeStore
            .getState()
            .setStartupTask(
                'capabilities',
                'completed',
                `Host capabilities loaded for ${capabilities.platform}.`
            );
        return capabilities;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const capabilities = createUnavailableHostCapabilities(message);
        useRuntimeStore.getState().setHostCapabilities(capabilities);
        useRuntimeStore
            .getState()
            .setStartupTask('capabilities', 'error', message);
        throw error;
    }
}

export async function refreshHostCapabilities(): Promise<HostCapabilities> {
    const capabilities = await commands.appGetHostCapabilities();
    useRuntimeStore.getState().setHostCapabilities(capabilities);
    return capabilities;
}

function getHostCapabilityStatus(key: HostCapabilityKey): HostCapabilityStatus {
    return useRuntimeStore.getState().hostCapabilities[key];
}

export function isHostCapabilityAvailable(key: HostCapabilityKey): boolean {
    return getHostCapabilityStatus(key).available;
}

export function isHostCapabilitySupported(key: HostCapabilityKey): boolean {
    const status = getHostCapabilityStatus(key);
    return status.supported && status.enabled;
}

export function getHostCapabilityUnavailableReason(
    key: HostCapabilityKey
): string {
    const status = getHostCapabilityStatus(key);
    return status.reason || `${key} is unavailable in the current host.`;
}

export function requireHostCapability(key: HostCapabilityKey): void {
    if (isHostCapabilityAvailable(key)) {
        return;
    }
    throw new Error(getHostCapabilityUnavailableReason(key));
}

export function requireHostCapabilitySupported(key: HostCapabilityKey): void {
    if (isHostCapabilitySupported(key)) {
        return;
    }
    throw new Error(getHostCapabilityUnavailableReason(key));
}
