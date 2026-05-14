import { avatarLocalRepository } from '@/repositories/index.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

type AvatarSnapshot = Record<string, unknown> & {
    id?: unknown;
    currentAvatar?: unknown;
    $previousAvatarSwapTime?: unknown;
};

type AvatarWearTransition = {
    userId?: unknown;
    historyAvatarId?: unknown;
    previousAvatarId?: unknown;
    startedAt?: unknown;
    endedAt?: unknown;
};

type AvatarWearSnapshotUpdateOptions = {
    previousSnapshot?: unknown;
    nextSnapshot?: unknown;
    isGameRunning?: boolean | null;
    userId?: unknown;
    now?: number;
};

type TimerOptions = {
    now?: number;
};

type StopTimerOptions = TimerOptions & {
    fallbackStartedAt?: unknown;
};

function normalizeAvatarId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeTimestamp(value: unknown): number {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function getCurrentUserId(): string {
    return normalizeAvatarId(useRuntimeStore.getState().auth.currentUserId);
}

async function persistAvatarWearTime(
    userId: unknown,
    avatarId: unknown,
    startedAt: unknown,
    endedAt: unknown
): Promise<void> {
    const normalizedUserId = normalizeAvatarId(userId);
    const normalizedAvatarId = normalizeAvatarId(avatarId);
    const startTime = normalizeTimestamp(startedAt);
    const endTime = normalizeTimestamp(endedAt);
    if (!normalizedUserId || !normalizedAvatarId || !startTime || !endTime) {
        return;
    }

    const elapsed = Math.max(0, endTime - startTime);
    if (elapsed <= 0) {
        return;
    }

    await avatarLocalRepository.addAvatarTimeSpent(
        normalizedUserId,
        normalizedAvatarId,
        elapsed
    );
}

function persistAvatarWearTransition(
    transition?: AvatarWearTransition | null
): void {
    if (!transition) {
        return;
    }

    const { userId, historyAvatarId, previousAvatarId, startedAt, endedAt } =
        transition;

    void Promise.all([
        historyAvatarId
            ? avatarLocalRepository.addAvatarToHistory(userId, historyAvatarId)
            : Promise.resolve(),
        previousAvatarId
            ? persistAvatarWearTime(
                  userId,
                  previousAvatarId,
                  startedAt,
                  endedAt
              )
            : Promise.resolve()
    ]).catch((error) => {
        console.warn('Failed to update avatar wear time:', error);
    });
}

function buildAvatarWearSnapshotUpdate({
    previousSnapshot,
    nextSnapshot,
    isGameRunning,
    userId = getCurrentUserId(),
    now = Date.now()
}: AvatarWearSnapshotUpdateOptions): {
    snapshot: unknown;
    transition: AvatarWearTransition | null;
} {
    const next =
        nextSnapshot && typeof nextSnapshot === 'object'
            ? ({ ...(nextSnapshot as Record<string, unknown>) } as AvatarSnapshot)
            : null;

    if (!next) {
        return {
            snapshot: nextSnapshot,
            transition: null
        };
    }

    const previous =
        previousSnapshot &&
        typeof previousSnapshot === 'object' &&
        normalizeAvatarId((previousSnapshot as AvatarSnapshot).id) ===
            normalizeAvatarId(next.id)
            ? (previousSnapshot as AvatarSnapshot)
            : null;
    const previousAvatarId = normalizeAvatarId(previous?.currentAvatar);
    const nextAvatarId = normalizeAvatarId(next.currentAvatar);
    const previousSwapTime = normalizeTimestamp(
        previous?.$previousAvatarSwapTime
    );
    const running = isGameRunning === true;
    const transition = {
        userId,
        historyAvatarId: '',
        previousAvatarId: '',
        startedAt: 0,
        endedAt: now
    };

    if (!running) {
        next.$previousAvatarSwapTime = null;
        return {
            snapshot: next,
            transition: null
        };
    }

    if (!nextAvatarId) {
        next.$previousAvatarSwapTime = previousSwapTime || null;
        return {
            snapshot: next,
            transition: null
        };
    }

    if (!previousAvatarId) {
        next.$previousAvatarSwapTime =
            normalizeTimestamp(next.$previousAvatarSwapTime) || now;
        transition.historyAvatarId = nextAvatarId;
        return {
            snapshot: next,
            transition
        };
    }

    if (previousAvatarId !== nextAvatarId) {
        next.$previousAvatarSwapTime = now;
        transition.historyAvatarId = nextAvatarId;
        if (previousSwapTime) {
            transition.previousAvatarId = previousAvatarId;
            transition.startedAt = previousSwapTime;
        }
        return {
            snapshot: next,
            transition
        };
    }

    next.$previousAvatarSwapTime =
        previousSwapTime ||
        normalizeTimestamp(next.$previousAvatarSwapTime) ||
        now;
    return {
        snapshot: next,
        transition: null
    };
}

function startCurrentAvatarWearTimer({ now = Date.now() }: TimerOptions = {}) {
    const runtimeStore = useRuntimeStore.getState();
    const snapshot = runtimeStore.auth.currentUserSnapshot as
        | AvatarSnapshot
        | null
        | undefined;
    if (!snapshot || typeof snapshot !== 'object') {
        return;
    }

    const avatarId = normalizeAvatarId(snapshot.currentAvatar);
    runtimeStore.setAuthBootstrap({
        currentUserSnapshot: {
            ...snapshot,
            $previousAvatarSwapTime: avatarId ? now : null
        }
    });

    if (avatarId) {
        persistAvatarWearTransition({
            userId: runtimeStore.auth.currentUserId,
            historyAvatarId: avatarId
        });
    }
}

async function stopCurrentAvatarWearTimer({
    fallbackStartedAt = 0,
    now = Date.now()
}: StopTimerOptions = {}): Promise<void> {
    const runtimeStore = useRuntimeStore.getState();
    const snapshot = runtimeStore.auth.currentUserSnapshot as
        | AvatarSnapshot
        | null
        | undefined;
    if (!snapshot || typeof snapshot !== 'object') {
        return;
    }

    const avatarId = normalizeAvatarId(snapshot.currentAvatar);
    const startedAt =
        normalizeTimestamp(snapshot.$previousAvatarSwapTime) ||
        normalizeTimestamp(fallbackStartedAt);

    if (avatarId && startedAt) {
        await persistAvatarWearTime(
            runtimeStore.auth.currentUserId,
            avatarId,
            startedAt,
            now
        ).catch((error) => {
            console.warn('Failed to persist avatar wear time:', error);
        });
    }

    runtimeStore.setAuthBootstrap({
        currentUserSnapshot: {
            ...snapshot,
            $previousAvatarSwapTime: null
        }
    });
}

function getCurrentAvatarLiveWearTime(
    avatarId: unknown,
    baseTimeSpent: unknown = 0
): number {
    const normalizedAvatarId = normalizeAvatarId(avatarId);
    const runtimeState = useRuntimeStore.getState();
    const currentUserSnapshot = runtimeState.auth.currentUserSnapshot as
        | AvatarSnapshot
        | null
        | undefined;
    if (
        !normalizedAvatarId ||
        runtimeState.gameState.isGameRunning !== true ||
        normalizeAvatarId(currentUserSnapshot?.currentAvatar) !==
            normalizedAvatarId
    ) {
        return Number(baseTimeSpent) || 0;
    }

    const startedAt = normalizeTimestamp(
        currentUserSnapshot?.$previousAvatarSwapTime
    );
    if (!startedAt) {
        return Number(baseTimeSpent) || 0;
    }

    return (Number(baseTimeSpent) || 0) + Math.max(0, Date.now() - startedAt);
}

function flushCurrentAvatarWearTimer({ now = Date.now() }: TimerOptions = {}) {
    const runtimeState = useRuntimeStore.getState();
    const snapshot = runtimeState.auth.currentUserSnapshot as
        | AvatarSnapshot
        | null
        | undefined;
    if (!snapshot || runtimeState.gameState.isGameRunning !== true) {
        return;
    }

    const avatarId = normalizeAvatarId(snapshot.currentAvatar);
    const startedAt = normalizeTimestamp(snapshot.$previousAvatarSwapTime);
    if (!avatarId || !startedAt) {
        return;
    }

    persistAvatarWearTransition({
        userId: runtimeState.auth.currentUserId,
        previousAvatarId: avatarId,
        startedAt,
        endedAt: now
    });
}

export {
    buildAvatarWearSnapshotUpdate,
    flushCurrentAvatarWearTimer,
    getCurrentAvatarLiveWearTime,
    persistAvatarWearTransition,
    startCurrentAvatarWearTimer,
    stopCurrentAvatarWearTimer
};
