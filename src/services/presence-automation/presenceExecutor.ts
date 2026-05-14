import { userProfileRepository } from '@/repositories/index.js';
import i18n from '@/services/i18nService.js';
import { useNotificationStore } from '@/state/notificationStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

const DEFAULT_MIN_STATUS_WRITE_INTERVAL_MS = 60_000;
const DEFAULT_MIN_DESCRIPTION_WRITE_INTERVAL_MS = 60_000;
const DEFAULT_STABLE_LOCATION_MS = 30_000;
const MAX_AUDIT_LOGS = 50;

const auditLogs: Record<string, any>[] = [];
const writeStates = new Map<string, Record<string, any>>();
const timeRestoreSnapshots: Record<string, Record<string, any>> = {};

function createWriteState() {
    return {
        lastStatusWriteAtMs: 0,
        lastDescriptionWriteAtMs: 0,
        lastStatusValue: '',
        lastDescriptionValue: '',
        nextAllowedAtMs: 0,
        retryAfterMs: 0,
        lastError: ''
    };
}

function getWriteState(scopeKey) {
    if (!writeStates.has(scopeKey)) {
        writeStates.set(scopeKey, createWriteState());
    }
    return writeStates.get(scopeKey);
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function addAuditLog(entry) {
    auditLogs.unshift({
        createdAt: new Date().toISOString(),
        ...entry
    });
    auditLogs.splice(MAX_AUDIT_LOGS);
}

function getChangedPatch(currentUser: Record<string, any>, patch: Record<string, any>) {
    const changed: Record<string, any> = {};
    if (hasOwn(patch, 'status') && currentUser?.status !== patch.status) {
        changed.status = patch.status;
    }
    if (
        hasOwn(patch, 'statusDescription') &&
        currentUser?.statusDescription !== patch.statusDescription
    ) {
        changed.statusDescription = patch.statusDescription;
    }
    return changed;
}

function getCurrentFieldValue(currentUser: Record<string, any>, field: string) {
    return String(currentUser?.[field] ?? '');
}

function getAutomationScopeKey(facts: Record<string, any>) {
    return `${facts?.endpoint || ''}:${facts?.currentUserId || ''}`;
}

function isCurrentAuthScope(facts: Record<string, any>) {
    const auth = useRuntimeStore.getState().auth;
    const authCurrentUserId =
        auth.currentUserId || auth.currentUserSnapshot?.id || '';
    return (
        String(auth.currentUserEndpoint || '') === String(facts?.endpoint || '') &&
        String(authCurrentUserId) === String(facts?.currentUserId || '')
    );
}

function pruneRestoreSnapshotsForScope(scopeKey) {
    for (const [field, snapshot] of Object.entries(timeRestoreSnapshots)) {
        if (snapshot.scopeKey !== scopeKey) {
            delete timeRestoreSnapshots[field];
        }
    }
}

function getTimeOwnedFieldRestores(result) {
    const fields = new Map();
    for (const rule of result?.matchedRules || []) {
        if (rule?.domain !== 'time') {
            continue;
        }
        for (const field of rule.ownedFields || []) {
            if (field === 'status' || field === 'statusDescription') {
                fields.set(field, rule.restorePreviousState !== false);
            }
        }
    }
    return fields;
}

function getLocationScopedFields(result) {
    const fields = new Set();
    for (const rule of result?.matchedRules || []) {
        if (rule?.domain === 'time') {
            continue;
        }
        for (const field of rule.ownedFields || []) {
            fields.add(field);
        }
    }
    return fields;
}

function hasLocationScopedChanges(result, changedPatch) {
    const locationScopedFields = getLocationScopedFields(result);
    return Object.keys(changedPatch || {}).some((field) =>
        locationScopedFields.has(field)
    );
}

function buildPatchWithTimeRestore(
    currentUser: Record<string, any>,
    result: Record<string, any>,
    scopeKey: string
) {
    const patch: Record<string, any> = { ...(result?.patch || {}) };
    const timeOwnedFieldRestores = getTimeOwnedFieldRestores(result);
    const timeOwnedFields = new Set(timeOwnedFieldRestores.keys());
    const pendingRestores = [];
    const pendingSnapshotClears = [];

    for (const [field, restorePreviousState] of timeOwnedFieldRestores) {
        if (!restorePreviousState) {
            pendingSnapshotClears.push(field);
            continue;
        }
        if (!hasOwn(timeRestoreSnapshots, field)) {
            timeRestoreSnapshots[field] = {
                scopeKey,
                previousValue: getCurrentFieldValue(currentUser, field),
                automatedValue: String(patch[field] ?? '')
            };
            continue;
        }
        if (timeRestoreSnapshots[field].scopeKey !== scopeKey) {
            timeRestoreSnapshots[field] = {
                scopeKey,
                previousValue: getCurrentFieldValue(currentUser, field),
                automatedValue: String(patch[field] ?? '')
            };
            continue;
        }
        timeRestoreSnapshots[field].automatedValue = String(patch[field] ?? '');
    }

    for (const [field, snapshot] of Object.entries(timeRestoreSnapshots)) {
        if (snapshot.scopeKey !== scopeKey) {
            continue;
        }
        if (timeOwnedFields.has(field)) {
            continue;
        }
        if (
            !hasOwn(patch, field) &&
            getCurrentFieldValue(currentUser, field) === snapshot.automatedValue
        ) {
            patch[field] = snapshot.previousValue;
            pendingRestores.push(field);
        } else {
            pendingRestores.push(field);
        }
    }

    return { patch, pendingRestores, pendingSnapshotClears };
}

function completeTimeRestores(fields) {
    for (const field of fields || []) {
        delete timeRestoreSnapshots[field];
    }
}

function parseDateMs(value) {
    const timestamp = Date.parse(String(value || ''));
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function getRetryAfterMs(error) {
    const retryAfter =
        error?.headers?.get?.('retry-after') ||
        error?.response?.headers?.['retry-after'] ||
        error?.retryAfter;
    const seconds = Number.parseInt(String(retryAfter || ''), 10);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60000;
}

function shouldSkipForStableLocation(facts: Record<string, any>, stableLocationMs: unknown) {
    if (facts.isTraveling) {
        return 'traveling';
    }
    const startedAtMs = parseDateMs(facts.currentLocationStartedAt);
    if (
        startedAtMs &&
        Date.now() - startedAtMs <
            Number(stableLocationMs || DEFAULT_STABLE_LOCATION_MS)
    ) {
        return 'location-stabilizing';
    }
    return '';
}

function shouldSkipForThrottle(
    changedPatch: Record<string, any>,
    throttle: Record<string, any>,
    nowMs: number,
    state: Record<string, any>
) {
    if (
        hasOwn(changedPatch, 'status') &&
        changedPatch.status === state.lastStatusValue &&
        nowMs - state.lastStatusWriteAtMs <
            (throttle.minStatusWriteIntervalMs ||
                DEFAULT_MIN_STATUS_WRITE_INTERVAL_MS)
    ) {
        return 'status-throttled';
    }
    if (
        hasOwn(changedPatch, 'statusDescription') &&
        changedPatch.statusDescription === state.lastDescriptionValue &&
        nowMs - state.lastDescriptionWriteAtMs <
            (throttle.minDescriptionWriteIntervalMs ||
                DEFAULT_MIN_DESCRIPTION_WRITE_INTERVAL_MS)
    ) {
        return 'description-throttled';
    }
    return '';
}

function updateWriteTimestamps(
    state: Record<string, any>,
    changedPatch: Record<string, any>,
    nowMs: number
) {
    if (hasOwn(changedPatch, 'status')) {
        state.lastStatusWriteAtMs = nowMs;
        state.lastStatusValue = changedPatch.status;
    }
    if (hasOwn(changedPatch, 'statusDescription')) {
        state.lastDescriptionWriteAtMs = nowMs;
        state.lastDescriptionValue = changedPatch.statusDescription;
    }
}

export async function applyPresenceAutomationResult({
    facts,
    result,
    throttle = {}
}: Record<string, any>) {
    const currentUser =
        facts.currentUser && typeof facts.currentUser === 'object'
            ? facts.currentUser
            : null;
    const currentUserId = String(
        currentUser?.id || facts.currentUserId || ''
    ).trim();
    if (!currentUserId || !currentUser) {
        addAuditLog({
            action: 'profile-update',
            skippedReason: 'missing-current-user',
            patch: result?.patch || {}
        });
        return { applied: false, reason: 'missing-current-user' };
    }
    const currentUserSnapshot = currentUser.id
        ? currentUser
        : {
              ...currentUser,
              id: currentUserId
          };

    const scopeKey = getAutomationScopeKey(facts);
    const writeState = getWriteState(scopeKey);
    pruneRestoreSnapshotsForScope(scopeKey);
    const { patch: effectivePatch, pendingRestores, pendingSnapshotClears } =
        buildPatchWithTimeRestore(currentUserSnapshot, result, scopeKey);
    const pendingSnapshotCompletions = [
        ...pendingRestores,
        ...pendingSnapshotClears
    ];
    const changedPatch = getChangedPatch(currentUserSnapshot, effectivePatch);
    if (!Object.keys(changedPatch).length) {
        completeTimeRestores(pendingSnapshotCompletions);
        return { applied: false, reason: 'no-change' };
    }

    const stableReason = hasLocationScopedChanges(result, changedPatch)
        ? shouldSkipForStableLocation(facts, throttle.stableLocationMs)
        : '';
    if (stableReason) {
        addAuditLog({
            action: 'profile-update',
            skippedReason: stableReason,
            patch: changedPatch,
            matchedRules: result?.matchedRules || []
        });
        return { applied: false, reason: stableReason };
    }

    const nowMs = Date.now();
    if (nowMs < writeState.nextAllowedAtMs) {
        addAuditLog({
            action: 'profile-update',
            skippedReason: 'backoff',
            patch: changedPatch,
            matchedRules: result?.matchedRules || [],
            error: writeState.lastError
        });
        return { applied: false, reason: 'backoff' };
    }

    const throttleReason = shouldSkipForThrottle(
        changedPatch,
        throttle,
        nowMs,
        writeState
    );
    if (throttleReason) {
        addAuditLog({
            action: 'profile-update',
            skippedReason: throttleReason,
            patch: changedPatch,
            matchedRules: result?.matchedRules || []
        });
        return { applied: false, reason: throttleReason };
    }

    if (!isCurrentAuthScope(facts)) {
        addAuditLog({
            action: 'profile-update',
            skippedReason: 'auth-context-changed',
            patch: changedPatch,
            matchedRules: result?.matchedRules || []
        });
        return { applied: false, reason: 'auth-context-changed' };
    }

    try {
        const updatedUser = await userProfileRepository.updateCurrentUser({
            userId: currentUserId,
            endpoint: facts.endpoint,
            params: changedPatch
        });
        updateWriteTimestamps(writeState, changedPatch, nowMs);
        writeState.lastError = '';
        writeState.nextAllowedAtMs = 0;
        if (!isCurrentAuthScope(facts)) {
            addAuditLog({
                action: 'profile-update',
                patch: changedPatch,
                matchedRules: result?.matchedRules || [],
                note: 'auth-context-changed-after-write'
            });
            completeTimeRestores(pendingSnapshotCompletions);
            return {
                applied: true,
                patch: changedPatch,
                reason: 'auth-context-changed-after-write'
            };
        }
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserSnapshot: {
                ...currentUserSnapshot,
                ...updatedUser
            }
        });
        useNotificationStore.getState().pushNotification({
            level: 'info',
            title: i18n.t(
                'service.background_maintenance.label.status_automatically_changed'
            ),
            message: [changedPatch.status, changedPatch.statusDescription]
                .filter((value) => value !== undefined && value !== '')
                .join(' / ')
        });
        addAuditLog({
            action: 'profile-update',
            patch: changedPatch,
            matchedRules: result?.matchedRules || []
        });
        completeTimeRestores(pendingSnapshotCompletions);
        return { applied: true, patch: changedPatch };
    } catch (error) {
        const retryAfterMs = getRetryAfterMs(error);
        writeState.retryAfterMs = retryAfterMs;
        writeState.nextAllowedAtMs = Date.now() + retryAfterMs;
        writeState.lastError =
            error instanceof Error ? error.message : String(error);
        addAuditLog({
            action: 'profile-update',
            patch: changedPatch,
            matchedRules: result?.matchedRules || [],
            error: writeState.lastError
        });
        return {
            applied: false,
            reason: 'error',
            error
        };
    }
}

export function resetPresenceAutomationExecutor() {
    auditLogs.length = 0;
    for (const key of Object.keys(timeRestoreSnapshots)) {
        delete timeRestoreSnapshots[key];
    }
    writeStates.clear();
}
