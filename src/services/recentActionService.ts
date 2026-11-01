import { MINUTE_MS, MINUTES_PER_DAY } from '@/shared/constants/time';
import { safeJsonParse } from '@/shared/utils/json';
import { isRecord } from '@/shared/utils/record';
import { useRuntimeStore } from '@/state/runtimeStore';

const STORAGE_KEY = 'VRCX_recentActions';
export type RecentActionType =
    | 'Send Friend Request'
    | 'Request Invite'
    | 'Invite'
    | 'Request Invite Message'
    | 'Invite Message';

let cooldownEnabled = false;
let cooldownMinutes = 60;
let cachedActions: Record<string, number> | null = null;
const listeners = new Set<() => void>();

type RecentActionCooldownOptions = {
    enabled?: boolean;
    minutes?: number;
};

function normalizeUserId(value: string | null | undefined): string {
    return value?.trim() ?? '';
}

function normalizeMinutes(value: number): number {
    return !Number.isFinite(value)
        ? 60
        : Math.min(MINUTES_PER_DAY, Math.max(1, Math.trunc(value)));
}

function readActions(): Record<string, number> {
    if (cachedActions) {
        return cachedActions;
    }
    const parsed = safeJsonParse(localStorage.getItem(STORAGE_KEY));
    cachedActions = isRecord(parsed) ? (parsed as Record<string, number>) : {};
    return cachedActions;
}

function writeActions(actions: Record<string, number>): void {
    cachedActions = actions;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedActions));
}

function actionKey(
    userId: string | null | undefined,
    actionType: RecentActionType
): string {
    const ownerUserId = normalizeUserId(
        useRuntimeStore.getState().auth.currentUserId
    );
    const normalizedUserId = normalizeUserId(userId);
    return ownerUserId && normalizedUserId
        ? `${ownerUserId}:${normalizedUserId}:${actionType}`
        : '';
}

function notifyRecentActionListeners(): void {
    for (const listener of listeners) {
        listener();
    }
}

export function configureRecentActionCooldown({
    enabled,
    minutes
}: RecentActionCooldownOptions = {}): {
    enabled: boolean;
    minutes: number;
} {
    cooldownEnabled = enabled ?? false;
    if (minutes !== undefined) {
        cooldownMinutes = normalizeMinutes(minutes);
    }
    notifyRecentActionListeners();
    return { enabled: cooldownEnabled, minutes: cooldownMinutes };
}

export function readRecentActionCooldown(): {
    enabled: boolean;
    minutes: number;
} {
    return { enabled: cooldownEnabled, minutes: cooldownMinutes };
}

export function recordRecentAction(
    userId: string | null | undefined,
    actionType: RecentActionType
): void {
    const key = actionKey(userId, actionType);
    if (!key) {
        return;
    }
    const actions: Record<string, number> = {
        ...readActions(),
        [key]: Date.now()
    };
    writeActions(actions);
    notifyRecentActionListeners();
}

export function isActionRecent(
    userId: string | null | undefined,
    actionType: RecentActionType
): boolean {
    if (!cooldownEnabled) {
        return false;
    }
    const key = actionKey(userId, actionType);
    if (!key) {
        return false;
    }
    const actions = readActions();
    const timestamp = Number(actions[key]);
    if (!Number.isFinite(timestamp)) {
        return false;
    }
    const cooldownMs = cooldownMinutes * MINUTE_MS;
    if (Date.now() - timestamp < cooldownMs) {
        return true;
    }
    const nextActions: Record<string, number> = { ...actions };
    delete nextActions[key];
    writeActions(nextActions);
    return false;
}

export function subscribeRecentActions(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
