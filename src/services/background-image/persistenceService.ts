import { BACKGROUND_IMAGE_CONFIG_KEYS } from '@/repositories/configKeys';
import configRepository from '@/repositories/configRepository';

import {
    normalizeBackgroundImageCustomSource,
    resolveBackgroundImageCustomSnapshot
} from './localSourceService';
import { resolveBackgroundImageProvider } from './remoteProviders';
import {
    isBackgroundImageSnapshotFresh,
    normalizeBackgroundImageSnapshots,
    type BackgroundImageSnapshotMap
} from './snapshotNormalization';
import type {
    BackgroundImageCustomSource,
    BackgroundImageMode,
    BackgroundImageProviderId,
    BackgroundImageSnapshot
} from './types';

export async function loadBackgroundImageSnapshots(): Promise<BackgroundImageSnapshotMap> {
    const currentRaw = await configRepository.getRawValue(
        BACKGROUND_IMAGE_CONFIG_KEYS.snapshots
    );
    if (currentRaw !== null) {
        return normalizeBackgroundImageSnapshots(
            await configRepository.getObject(
                BACKGROUND_IMAGE_CONFIG_KEYS.snapshots,
                null
            )
        );
    }

    return normalizeBackgroundImageSnapshots(
        await configRepository.getObject(
            BACKGROUND_IMAGE_CONFIG_KEYS.legacySnapshots,
            null
        )
    );
}

async function persistBackgroundImageSnapshot(
    snapshot: BackgroundImageSnapshot
): Promise<void> {
    if (!snapshot.providerId) {
        return;
    }
    const snapshots = await loadBackgroundImageSnapshots();
    snapshots[snapshot.providerId] = snapshot;
    await configRepository.setObject(
        BACKGROUND_IMAGE_CONFIG_KEYS.snapshots,
        snapshots
    );
}

export async function loadBackgroundImageCustomSource(): Promise<BackgroundImageCustomSource | null> {
    return normalizeBackgroundImageCustomSource(
        await configRepository.getObject(
            BACKGROUND_IMAGE_CONFIG_KEYS.customSource,
            null
        )
    );
}

export async function persistBackgroundImageCustomSource(
    customSource: BackgroundImageCustomSource | null
): Promise<void> {
    if (!customSource) {
        await configRepository.remove(
            BACKGROUND_IMAGE_CONFIG_KEYS.customSource
        );
        return;
    }
    await configRepository.setObject(
        BACKGROUND_IMAGE_CONFIG_KEYS.customSource,
        customSource
    );
}

export async function resolveProviderSnapshot(
    providerId: BackgroundImageProviderId,
    forceRefresh = false
): Promise<BackgroundImageSnapshot | null> {
    const snapshots = await loadBackgroundImageSnapshots();
    const cached = snapshots[providerId] ?? null;
    if (!forceRefresh && isBackgroundImageSnapshotFresh(cached)) {
        return cached;
    }

    try {
        const provider = resolveBackgroundImageProvider(providerId);
        const snapshot = await provider.resolveSnapshot();
        await persistBackgroundImageSnapshot(snapshot);
        return snapshot;
    } catch (error) {
        if (cached) {
            console.warn(
                'Unable to refresh Background Image; using cached snapshot.',
                error
            );
            return cached;
        }
        throw error;
    }
}

export async function resolveCustomSnapshot(
    source: BackgroundImageCustomSource | null,
    previousSnapshot: BackgroundImageSnapshot | null = null
): Promise<BackgroundImageSnapshot | null> {
    if (!source) {
        return null;
    }
    return resolveBackgroundImageCustomSnapshot(source, previousSnapshot);
}

export async function persistBackgroundImageState({
    enabled,
    mode,
    providerId
}: {
    enabled: boolean;
    mode: BackgroundImageMode;
    providerId: BackgroundImageProviderId;
}): Promise<void> {
    await Promise.all([
        configRepository.setBool(BACKGROUND_IMAGE_CONFIG_KEYS.enabled, enabled),
        configRepository.setString(BACKGROUND_IMAGE_CONFIG_KEYS.mode, mode),
        configRepository.setString(
            BACKGROUND_IMAGE_CONFIG_KEYS.providerId,
            providerId
        )
    ]);
}
