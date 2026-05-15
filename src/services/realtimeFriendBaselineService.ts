import { backend } from '@/platform/index.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

type RealtimeFriendBaselineTransportContext = {
    currentUserId: string;
    endpoint: string;
    websocket: string;
    clientRunId: number;
    generation: number;
};

let activeTransportContext: RealtimeFriendBaselineTransportContext | null =
    null;
let activeAcceptedGeneration: number | null = null;
let activeAcceptedBaselineRevision: number | null = null;
let activeBaselineRevision = 0;
let activeBaselineSyncId = 0;

function normalizeUserId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizePositiveInt(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function normalizeNonNegativeInt(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function normalizeTransportContext({
    currentUserId,
    endpoint,
    websocket,
    clientRunId,
    generation
}: {
    currentUserId: unknown;
    endpoint: unknown;
    websocket: unknown;
    clientRunId: unknown;
    generation: unknown;
}): RealtimeFriendBaselineTransportContext | null {
    const normalizedUserId = normalizeUserId(currentUserId);
    const normalizedClientRunId = normalizePositiveInt(clientRunId);
    const normalizedGeneration = normalizePositiveInt(generation);
    if (!normalizedUserId || !normalizedClientRunId || !normalizedGeneration) {
        return null;
    }

    return {
        currentUserId: normalizedUserId,
        endpoint: String(endpoint || ''),
        websocket: String(websocket || ''),
        clientRunId: normalizedClientRunId,
        generation: normalizedGeneration
    };
}

function isSameTransportContext(
    left: RealtimeFriendBaselineTransportContext,
    right: RealtimeFriendBaselineTransportContext
): boolean {
    return (
        left.currentUserId === right.currentUserId &&
        left.endpoint === right.endpoint &&
        left.websocket === right.websocket &&
        left.clientRunId === right.clientRunId &&
        left.generation === right.generation
    );
}

function setRealtimeFriendBaselineTransportContext(
    context: Parameters<typeof normalizeTransportContext>[0]
) {
    activeTransportContext = normalizeTransportContext(context);
    activeAcceptedGeneration = null;
    activeAcceptedBaselineRevision = null;
    activeBaselineRevision = 0;
    activeBaselineSyncId += 1;
}

function clearRealtimeFriendBaselineTransportContext(
    context?: Parameters<typeof normalizeTransportContext>[0] | null
) {
    if (!context) {
        activeTransportContext = null;
        activeAcceptedGeneration = null;
        activeAcceptedBaselineRevision = null;
        activeBaselineRevision = 0;
        activeBaselineSyncId += 1;
        return;
    }

    const normalizedContext = normalizeTransportContext(context);
    if (
        normalizedContext &&
        activeTransportContext &&
        isSameTransportContext(activeTransportContext, normalizedContext)
    ) {
        activeTransportContext = null;
        activeAcceptedGeneration = null;
        activeAcceptedBaselineRevision = null;
        activeBaselineRevision = 0;
        activeBaselineSyncId += 1;
    }
}

function isCurrentRealtimeFriendBaselineAccepted(
    generation: unknown,
    baselineRevision?: unknown
): boolean {
    const normalizedGeneration = normalizePositiveInt(generation);
    const normalizedBaselineRevision =
        baselineRevision === undefined
            ? activeAcceptedBaselineRevision
            : normalizeNonNegativeInt(baselineRevision);
    return Boolean(
        activeTransportContext &&
        activeAcceptedGeneration &&
        activeTransportContext.generation === normalizedGeneration &&
        activeAcceptedGeneration === normalizedGeneration &&
        activeAcceptedBaselineRevision === activeBaselineRevision &&
        normalizedBaselineRevision === activeAcceptedBaselineRevision
    );
}

function acceptRealtimeFriendBaselineProjection(projection: unknown): boolean {
    const record =
        projection && typeof projection === 'object'
            ? (projection as Record<string, unknown>)
            : null;
    const normalizedGeneration = normalizePositiveInt(record?.generation);
    const baselineRevision = normalizeNonNegativeInt(record?.baselineRevision);
    if (
        !activeTransportContext ||
        activeTransportContext.generation !== normalizedGeneration ||
        baselineRevision !== activeBaselineRevision
    ) {
        return false;
    }
    activeAcceptedGeneration = normalizedGeneration;
    activeAcceptedBaselineRevision = baselineRevision;
    return true;
}

function markRealtimeFriendBaselineDirty() {
    if (!activeTransportContext) {
        return;
    }
    activeAcceptedGeneration = null;
    activeAcceptedBaselineRevision = null;
    activeBaselineRevision += 1;
}

async function syncRealtimeFriendBaseline({
    currentUserId,
    endpoint,
    websocket,
    clientRunId,
    generation,
    friendsById,
    baselineRevision = activeBaselineRevision
}: {
    currentUserId: unknown;
    endpoint: unknown;
    websocket: unknown;
    clientRunId: unknown;
    generation: unknown;
    friendsById: Record<string, unknown>;
    baselineRevision?: number;
}) {
    const context = normalizeTransportContext({
        currentUserId,
        endpoint,
        websocket,
        clientRunId,
        generation
    });
    if (!context) {
        return {
            accepted: false,
            generation: 0,
            baselineRevision: 0,
            friendCount: 0
        };
    }

    const syncId = ++activeBaselineSyncId;
    try {
        const result = await backend.app.SetRealtimeFriendBaseline(
            context.currentUserId,
            context.endpoint,
            context.websocket,
            context.clientRunId,
            context.generation,
            baselineRevision,
            friendsById
        );
        if (
            activeTransportContext &&
            isSameTransportContext(activeTransportContext, context) &&
            syncId === activeBaselineSyncId
        ) {
            const resultBaselineRevision = normalizeNonNegativeInt(
                result?.baselineRevision
            );
            const accepted =
                result?.accepted === true &&
                normalizePositiveInt(result?.generation) ===
                    context.generation &&
                resultBaselineRevision === baselineRevision &&
                baselineRevision === activeBaselineRevision;
            activeAcceptedGeneration = accepted ? context.generation : null;
            activeAcceptedBaselineRevision = accepted ? baselineRevision : null;
            if (
                !accepted &&
                resultBaselineRevision !== null &&
                resultBaselineRevision > activeBaselineRevision
            ) {
                activeBaselineRevision = resultBaselineRevision;
                void syncCurrentRealtimeFriendBaseline();
            } else if (
                !accepted &&
                baselineRevision !== activeBaselineRevision
            ) {
                void syncCurrentRealtimeFriendBaseline();
            }
        }
        return result;
    } catch (error) {
        if (
            activeTransportContext &&
            isSameTransportContext(activeTransportContext, context) &&
            syncId === activeBaselineSyncId
        ) {
            activeAcceptedGeneration = null;
            activeAcceptedBaselineRevision = null;
        }
        console.warn('Realtime friend baseline sync failed:', error);
        return {
            accepted: false,
            generation: 0,
            baselineRevision: 0,
            friendCount: 0
        };
    }
}

function syncCurrentRealtimeFriendBaseline() {
    if (!activeTransportContext) {
        return Promise.resolve({
            accepted: false,
            generation: 0,
            baselineRevision: 0,
            friendCount: 0
        });
    }

    const runtimeState = useRuntimeStore.getState();
    if (
        runtimeState.auth.currentUserId !==
            activeTransportContext.currentUserId ||
        runtimeState.auth.currentUserEndpoint !==
            activeTransportContext.endpoint ||
        runtimeState.auth.currentUserWebsocket !==
            activeTransportContext.websocket
    ) {
        return Promise.resolve({
            accepted: false,
            generation: activeTransportContext.generation,
            baselineRevision: activeBaselineRevision,
            friendCount: 0
        });
    }

    const rosterState = useFriendRosterStore.getState();
    const baselineRevision = activeBaselineRevision;
    return syncRealtimeFriendBaseline({
        ...activeTransportContext,
        friendsById: rosterState.friendsById,
        baselineRevision
    });
}

export {
    acceptRealtimeFriendBaselineProjection,
    clearRealtimeFriendBaselineTransportContext,
    isCurrentRealtimeFriendBaselineAccepted,
    markRealtimeFriendBaselineDirty,
    setRealtimeFriendBaselineTransportContext,
    syncCurrentRealtimeFriendBaseline,
    syncRealtimeFriendBaseline
};
