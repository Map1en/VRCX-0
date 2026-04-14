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
let cachedActions = null;
const listeners = new Set();

function normalizeUserId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeMinutes(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 60 : Math.min(1440, Math.max(1, parsed));
}

function readActions() {
    if (cachedActions) {
        return cachedActions;
    }
    if (typeof window === 'undefined' || !window.localStorage) {
        cachedActions = {};
        return cachedActions;
    }
    try {
        const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
        cachedActions = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        cachedActions = {};
    }
    return cachedActions;
}

function writeActions(actions) {
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

function actionKey(userId, actionType) {
    const normalizedUserId = normalizeUserId(userId);
    return normalizedUserId && TRACKED_ACTIONS.has(actionType)
        ? `${normalizedUserId}:${actionType}`
        : '';
}

function notifyRecentActionListeners() {
    for (const listener of listeners) {
        listener();
    }
}

export function configureRecentActionCooldown({ enabled, minutes } = {}) {
    cooldownEnabled = Boolean(enabled);
    if (minutes !== undefined) {
        cooldownMinutes = normalizeMinutes(minutes);
    }
    notifyRecentActionListeners();
    return { enabled: cooldownEnabled, minutes: cooldownMinutes };
}

export function readRecentActionCooldown() {
    return { enabled: cooldownEnabled, minutes: cooldownMinutes };
}

export function recordRecentAction(userId, actionType) {
    const key = actionKey(userId, actionType);
    if (!key) {
        return;
    }
    const actions = { ...readActions(), [key]: Date.now() };
    writeActions(actions);
    notifyRecentActionListeners();
}

export function isActionRecent(userId, actionType) {
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
    const nextActions = { ...actions };
    delete nextActions[key];
    writeActions(nextActions);
    return false;
}

export function clearRecentActions() {
    writeActions({});
    notifyRecentActionListeners();
}

export function subscribeRecentActions(listener) {
    if (typeof listener !== 'function') {
        return () => {};
    }
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
