const STORAGE_KEY = 'VRCX_recentActions';
const TRACKED_ACTIONS = new Set([
    'Send Friend Request',
    'Request Invite',
    'Invite',
    'Request Invite Message',
    'Invite Message'
]);

let cooldownEnabled = false;
let cooldownMinutes = 60;
let cachedActions: Record<string, number> | null = null;
const listeners = new Set<() => void>();

type RecentActionCooldownOptions = {
    enabled?: boolean;
    minutes?: unknown;
};

function normalizeUserId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeMinutes(value: unknown): number {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isNaN(parsed) ? 60 : Math.min(1440, Math.max(1, parsed));
}

function readActions(): Record<string, number> {
    if (cachedActions) {
        return cachedActions;
    }
    if (typeof window === 'undefined' || !window.localStorage) {
        cachedActions = {};
        return cachedActions;
    }
    let next: Record<string, number> = {};
    try {
        const parsed = JSON.parse(
            window.localStorage.getItem(STORAGE_KEY) || '{}'
        );
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            next = parsed;
        }
    } catch {
        next = {};
    }
    cachedActions = next;
    return next;
}

function writeActions(actions: Record<string, number>): void {
    cachedActions = actions && typeof actions === 'object' ? actions : {};
    if (typeof window === 'undefined' || !window.localStorage) {
        return;
    }
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedActions));
    } catch {
        cachedActions = actions && typeof actions === 'object' ? actions : {};
    }
}

function actionKey(userId: unknown, actionType: unknown): string {
    const normalizedUserId = normalizeUserId(userId);
    const normalizedActionType =
        typeof actionType === 'string' ? actionType : '';
    return normalizedUserId && TRACKED_ACTIONS.has(normalizedActionType)
        ? `${normalizedUserId}:${normalizedActionType}`
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
    cooldownEnabled = Boolean(enabled);
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

export function recordRecentAction(userId: unknown, actionType: unknown): void {
    const key = actionKey(userId, actionType);
    if (!key) {
        return;
    }
    const actions: any = { ...readActions(), [key]: Date.now() };
    writeActions(actions);
    notifyRecentActionListeners();
}

export function isActionRecent(userId: unknown, actionType: unknown): boolean {
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
    const cooldownMs = cooldownMinutes * 60 * 1000;
    if (Date.now() - timestamp < cooldownMs) {
        return true;
    }
    const nextActions: any = { ...actions };
    delete nextActions[key];
    writeActions(nextActions);
    return false;
}

export function clearRecentActions(): void {
    writeActions({});
    notifyRecentActionListeners();
}

export function subscribeRecentActions(listener: unknown): () => void {
    if (typeof listener !== 'function') {
        return () => {};
    }
    const callback = listener as () => void;
    listeners.add(callback);
    return () => {
        listeners.delete(callback);
    };
}
