import configRepository from '@/repositories/configRepository';

import { TELEMETRY_INSTALL_ID_CONFIG_KEY } from './telemetryConfig';

function createRandomId(): string {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(bytes);
    } else {
        for (let index = 0; index < bytes.length; index += 1) {
            bytes[index] = Math.floor(Math.random() * 256);
        }
    }
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
        ''
    );
}

export type TelemetryInstallIdentity = {
    installId: string;
    isNewInstall: boolean;
};

export async function getOrCreateTelemetryInstallIdentity(): Promise<TelemetryInstallIdentity> {
    const existing = await configRepository.getString(
        TELEMETRY_INSTALL_ID_CONFIG_KEY,
        ''
    );
    if (existing) {
        return { installId: existing, isNewInstall: false };
    }

    const installId = createRandomId();
    await configRepository.setString(
        TELEMETRY_INSTALL_ID_CONFIG_KEY,
        installId
    );
    return { installId, isNewInstall: true };
}

export async function getOrCreateTelemetryInstallId(): Promise<string> {
    const identity = await getOrCreateTelemetryInstallIdentity();
    return identity.installId;
}

export function createTelemetrySessionId(): string {
    return createRandomId();
}
