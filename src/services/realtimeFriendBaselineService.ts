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

function normalizeUserId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizePositiveInt(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
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
}

function clearRealtimeFriendBaselineTransportContext(
    context?: Parameters<typeof normalizeTransportContext>[0] | null
) {
    if (!context) {
        activeTransportContext = null;
        return;
    }

    const normalizedContext = normalizeTransportContext(context);
    if (
        normalizedContext &&
        activeTransportContext &&
        isSameTransportContext(activeTransportContext, normalizedContext)
    ) {
        activeTransportContext = null;
    }
}

async function syncRealtimeFriendBaseline({
    currentUserId,
    endpoint,
    websocket,
    clientRunId,
    generation,
    friendsById
}: {
    currentUserId: unknown;
    endpoint: unknown;
    websocket: unknown;
    clientRunId: unknown;
    generation: unknown;
    friendsById: Record<string, unknown>;
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
            friendCount: 0
        };
    }

    try {
        return await backend.app.SetRealtimeFriendBaseline(
            context.currentUserId,
            context.endpoint,
            context.websocket,
            context.clientRunId,
            context.generation,
            friendsById
        );
    } catch (error) {
        console.warn('Realtime friend baseline sync failed:', error);
        return {
            accepted: false,
            generation: 0,
            friendCount: 0
        };
    }
}

function syncCurrentRealtimeFriendBaseline() {
    if (!activeTransportContext) {
        return Promise.resolve({
            accepted: false,
            generation: 0,
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
            friendCount: 0
        });
    }

    const rosterState = useFriendRosterStore.getState();
    return syncRealtimeFriendBaseline({
        ...activeTransportContext,
        friendsById: rosterState.friendsById
    });
}

export {
    clearRealtimeFriendBaselineTransportContext,
    setRealtimeFriendBaselineTransportContext,
    syncCurrentRealtimeFriendBaseline,
    syncRealtimeFriendBaseline
};
