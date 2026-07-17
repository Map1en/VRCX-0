import { HOUR_MS } from '@/shared/constants/time';

import {
    backgroundImageRemoteProviders,
    resolveBackgroundImageProvider
} from './remoteProviders';
import type {
    BackgroundImageMode,
    BackgroundImageProviderId,
    BackgroundImageSnapshot
} from './types';

export type BackgroundImageSnapshotMap = Partial<
    Record<BackgroundImageProviderId, BackgroundImageSnapshot>
>;

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

export function normalizeBackgroundImageMode(
    value: unknown
): BackgroundImageMode {
    return value === 'daily' || value === 'custom' ? value : 'off';
}

export function normalizeBackgroundImageProviderId(
    value: unknown
): BackgroundImageProviderId {
    return resolveBackgroundImageProvider(value).id;
}

function normalizeSnapshot(
    value: unknown,
    expectedProviderId?: BackgroundImageProviderId
): BackgroundImageSnapshot | null {
    if (!isUnknownRecord(value)) {
        return null;
    }

    const providerId = normalizeBackgroundImageProviderId(value.providerId);
    if (expectedProviderId && providerId !== expectedProviderId) {
        return null;
    }
    const imageUrl = String(value.imageUrl || '').trim();
    if (!imageUrl) {
        return null;
    }

    return {
        mode: 'daily',
        providerId,
        imageUrl,
        title: String(value.title || ''),
        author: String(value.author || ''),
        license: String(value.license || ''),
        source: String(value.source || ''),
        resolvedAt: String(value.resolvedAt || ''),
        resolvedForKey: String(
            value.resolvedForKey || value.resolvedForDate || ''
        )
    };
}

export function normalizeBackgroundImageSnapshots(
    value: unknown
): BackgroundImageSnapshotMap {
    if (!isUnknownRecord(value)) {
        return {};
    }

    const snapshots: BackgroundImageSnapshotMap = {};
    backgroundImageRemoteProviders.forEach((provider) => {
        const snapshot = normalizeSnapshot(value[provider.id], provider.id);
        if (snapshot) {
            snapshots[provider.id] = snapshot;
        }
    });
    return snapshots;
}

export function isBackgroundImageSnapshotFresh(
    snapshot: BackgroundImageSnapshot | null
): boolean {
    if (!snapshot?.providerId || !snapshot.resolvedAt) {
        return false;
    }

    const provider = resolveBackgroundImageProvider(snapshot.providerId);
    const resolvedAt = Date.parse(snapshot.resolvedAt);
    if (!Number.isFinite(resolvedAt)) {
        return false;
    }

    const ageMs = Date.now() - resolvedAt;
    return ageMs >= 0 && ageMs < provider.cacheTtlHours * HOUR_MS;
}
