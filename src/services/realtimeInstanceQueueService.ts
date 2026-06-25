import { toast } from 'sonner';

import type { RealtimeInstanceQueueProjection } from '@/platform/tauri/bindings';
import i18n from '@/services/i18nService';
import { displayLocation, parseLocation } from '@/shared/utils/location';
import {
    locationHintKey,
    useLocationHintStore
} from '@/state/locationHintStore';
import { useRuntimeStore } from '@/state/runtimeStore';

type ProjectionRecord = Record<string, unknown>;
type RealtimeInstanceQueueProjectionInput =
    Partial<RealtimeInstanceQueueProjection> & ProjectionRecord;

function isRecord(value: unknown): value is ProjectionRecord {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function number(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function translated(
    key: string,
    params: ProjectionRecord,
    fallback: string
): string {
    const value = i18n.t(key, params);
    return typeof value === 'string' && value !== key ? value : fallback;
}

function resolveQueueLocationLabel(instanceLocation: string): string {
    const runtimeState = useRuntimeStore.getState();
    const endpoint = runtimeState.auth.currentUserEndpoint;
    const hint =
        useLocationHintStore.getState().hintsByKey[
            locationHintKey(endpoint, instanceLocation)
        ];
    const parsed = parseLocation(instanceLocation);
    const worldName = hint?.worldName || parsed.worldId || instanceLocation;
    const groupName = hint?.groupName || '';
    return (
        displayLocation(instanceLocation, worldName, groupName) ||
        worldName ||
        instanceLocation
    );
}

export function handleRealtimeInstanceQueueProjection(payload: unknown) {
    const projection: RealtimeInstanceQueueProjectionInput = isRecord(payload)
        ? payload
        : {};
    const kind = text(projection.kind);
    const instanceLocation = text(projection.instanceLocation);
    if (!instanceLocation) {
        return;
    }

    const runtimeStore = useRuntimeStore.getState();
    const currentQueue = runtimeStore.instanceQueue;
    const label =
        currentQueue.instanceLocation === instanceLocation && currentQueue.label
            ? currentQueue.label
            : resolveQueueLocationLabel(instanceLocation);

    if (kind === 'ready') {
        if (
            !currentQueue.instanceLocation ||
            currentQueue.instanceLocation === instanceLocation
        ) {
            runtimeStore.clearInstanceQueueState();
        }
        toast.success(
            translated(
                'status_bar.instance_queue_ready_to_join',
                { location: label },
                `Instance ready to join ${label}`
            )
        );
        return;
    }

    if (kind === 'left') {
        if (currentQueue.instanceLocation === instanceLocation) {
            runtimeStore.clearInstanceQueueState();
        }
        return;
    }

    runtimeStore.setInstanceQueueState({
        active: true,
        instanceLocation,
        position: number(projection.position),
        queueSize: number(projection.queueSize),
        label,
        updatedAt: text(projection.receivedAt) || new Date().toISOString()
    });
}
