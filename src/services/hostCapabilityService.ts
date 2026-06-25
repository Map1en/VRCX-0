import { commands } from '@/platform/tauri/bindings';
import type {
    CapabilityStatus as HostCapabilityStatus,
    HostCapabilities
} from '@/platform/tauri/bindings';
import { useRuntimeStore } from '@/state/runtimeStore';

type HostCapabilityKey = {
    [K in keyof HostCapabilities]: HostCapabilities[K] extends HostCapabilityStatus
        ? K
        : never;
}[keyof HostCapabilities];

const HOST_CAPABILITY_KEYS: readonly HostCapabilityKey[] = Object.freeze([
    'localDatabase',
    'websocketRuntime',
    'gameLogWatcher',
    'runtimeGameLogIngest',
    'runtimeGameLogSideEffects',
    'runtimeGameClientLifecycle',
    'runtimeRealtimeTransport',
    'gameProcessMonitor',
    'vrchatPathDiscovery',
    'steamLibraryDiscovery',
    'steamRuntimeIntegration',
    'registryPrefs',
    'gameLaunch',
    'ipc',
    'vrchatLaunchPipe',
    'screenshotCache'
]);
type HostPlatform = HostCapabilities['platform'];
type HostArchitecture = HostCapabilities['arch'];
type LinuxPackageKind = HostCapabilities['linuxPackageKind'];

const HOST_PLATFORMS = new Set<unknown>([
    'windows',
    'linux',
    'macos',
    'unknown'
]);
const HOST_ARCHITECTURES = new Set<unknown>(['x86_64', 'aarch64', 'unknown']);
const LINUX_PACKAGE_KINDS = new Set<unknown>([
    'appimage',
    'deb',
    'rpm',
    'unknown'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function normalizeCapabilityStatus(
    value: unknown,
    fallbackReason?: unknown
): HostCapabilityStatus {
    const record = isRecord(value) ? value : null;
    let reason = '';
    if (record?.reason) {
        reason = String(record.reason);
    } else if (fallbackReason) {
        reason = String(fallbackReason);
    }
    const status: HostCapabilityStatus = {
        supported: Boolean(record?.supported),
        enabled: Boolean(record?.enabled),
        available: Boolean(record?.available)
    };
    if (reason) {
        status.reason = reason;
    }
    return status;
}

function createCapabilitiesBase(
    platform: HostPlatform,
    arch: HostArchitecture,
    linuxPackageKind: LinuxPackageKind
): HostCapabilities {
    return {
        platform,
        arch,
        linuxPackageKind
    } as HostCapabilities;
}

function createUnavailableCapabilities(reason: unknown): HostCapabilities {
    const capabilities = createCapabilitiesBase(
        'unknown',
        'unknown',
        'unknown'
    );
    for (const key of HOST_CAPABILITY_KEYS) {
        capabilities[key] = normalizeCapabilityStatus(null, reason);
    }
    return capabilities;
}

function normalizeHostCapabilities(payload: unknown): HostCapabilities {
    const record = isRecord(payload) ? payload : {};
    const platform = HOST_PLATFORMS.has(record.platform)
        ? String(record.platform)
        : 'unknown';
    const arch = HOST_ARCHITECTURES.has(record.arch)
        ? String(record.arch)
        : 'unknown';
    const linuxPackageKind = LINUX_PACKAGE_KINDS.has(record.linuxPackageKind)
        ? String(record.linuxPackageKind)
        : 'unknown';
    const capabilities = createCapabilitiesBase(
        platform,
        arch,
        linuxPackageKind
    );
    for (const key of HOST_CAPABILITY_KEYS) {
        capabilities[key] = normalizeCapabilityStatus(
            record[key],
            `${key} is unavailable on ${platform}`
        );
    }
    return capabilities;
}

export async function initializeHostCapabilities(): Promise<HostCapabilities> {
    const runtimeStore = useRuntimeStore.getState();
    runtimeStore.setStartupTask(
        'capabilities',
        'running',
        'Loading host capabilities.'
    );

    try {
        const capabilities = normalizeHostCapabilities(
            await commands.appGetHostCapabilities()
        );
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
        const capabilities = createUnavailableCapabilities(message);
        useRuntimeStore.getState().setHostCapabilities(capabilities);
        useRuntimeStore
            .getState()
            .setStartupTask('capabilities', 'error', message);
        throw error;
    }
}

export async function refreshHostCapabilities(): Promise<HostCapabilities> {
    const capabilities = normalizeHostCapabilities(
        await commands.appGetHostCapabilities()
    );
    useRuntimeStore.getState().setHostCapabilities(capabilities);
    return capabilities;
}

export function getHostCapabilityStatus(
    key: string
): HostCapabilityStatus | null {
    return (
        (useRuntimeStore.getState().hostCapabilities?.[key] as
            | HostCapabilityStatus
            | null
            | undefined) || null
    );
}

export function isHostCapabilityAvailable(key: string): boolean {
    return Boolean(getHostCapabilityStatus(key)?.available);
}

export function isHostCapabilitySupported(key: string): boolean {
    const status = getHostCapabilityStatus(key);
    return Boolean(status?.supported && status?.enabled);
}

export function getHostCapabilityUnavailableReason(key: string): string {
    const status = getHostCapabilityStatus(key);
    return status?.reason || `${key} is unavailable in the current host.`;
}

export function requireHostCapability(key: string): void {
    if (isHostCapabilityAvailable(key)) {
        return;
    }
    throw new Error(getHostCapabilityUnavailableReason(key));
}

export function requireHostCapabilitySupported(key: string): void {
    if (isHostCapabilitySupported(key)) {
        return;
    }
    throw new Error(getHostCapabilityUnavailableReason(key));
}
