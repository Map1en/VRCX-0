import { toast } from 'sonner';

import { recordUserProfile } from '@/domain/users/userFactAccess';
import i18n from '@/services/i18nService';
import { useDialogStore } from '@/state/dialogStore';
import { useRuntimeStore } from '@/state/runtimeStore';

let entityDialogOpenNonce = 0;

type EntityDialogKind = 'user' | 'world' | 'avatar' | 'group' | string;
type DialogRecord = Record<string, unknown>;
type EntityDialogPayload = DialogRecord | null;

type OpenEntityDialogOptions = {
    kind?: EntityDialogKind;
    entityId?: unknown;
    title?: unknown;
    description?: unknown;
    payload?: EntityDialogPayload;
};

type OpenUserDialogOptions = {
    userId?: unknown;
    title?: unknown;
    description?: unknown;
    seedData?: DialogRecord | null;
    initialAction?: string;
};

type OpenWorldDialogOptions = {
    worldId?: unknown;
    title?: unknown;
    description?: unknown;
    seedData?: DialogRecord | null;
    initialAction?: string;
    initialNewInstanceDefaults?: DialogRecord | null;
};

type OpenAvatarDialogOptions = {
    avatarId?: unknown;
    title?: unknown;
    description?: unknown;
    seedData?: DialogRecord | null;
};

type OpenGroupDialogOptions = {
    groupId?: unknown;
    title?: unknown;
    description?: unknown;
    seedData?: DialogRecord | null;
};

function isRecord(value: unknown): value is DialogRecord {
    return Boolean(value && typeof value === 'object');
}

function normalizeEntityId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeTitle(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function defaultEntityTitle(kind: EntityDialogKind) {
    switch (kind) {
        case 'user':
            return 'User';
        case 'world':
            return 'World';
        case 'avatar':
            return 'Avatar';
        case 'group':
            return 'Group';
        default:
            return 'Dialog';
    }
}

function readSeedTitle(kind: EntityDialogKind, seedData: unknown) {
    if (!isRecord(seedData)) {
        return '';
    }
    const seed = seedData;
    switch (kind) {
        case 'user':
            return normalizeTitle(
                seed.displayName || seed.username || seed.name
            );
        case 'world':
        case 'avatar':
        case 'group':
            return normalizeTitle(
                seed.name || seed.displayName || seed.shortName
            );
        default:
            return '';
    }
}

function recordUserDialogSeed(
    userId: unknown,
    title: unknown,
    seedData: DialogRecord | null
) {
    const normalizedUserId = normalizeEntityId(
        userId || seedData?.id || seedData?.userId
    );
    if (!normalizedUserId) {
        return;
    }

    const seed: DialogRecord = isRecord(seedData)
        ? {
              ...seedData,
              id: normalizedUserId,
              userId: normalizedUserId
          }
        : {
              id: normalizedUserId,
              userId: normalizedUserId
          };
    const seedTitle = normalizeTitle(
        seed.displayName || seed.username || seed.name || title
    );
    if (seedTitle && seedTitle !== normalizedUserId) {
        seed.displayName = seed.displayName || seedTitle;
    }

    recordUserProfile(seed, {
        endpoint: useRuntimeStore.getState().auth.currentUserEndpoint,
        source: 'seed'
    });
}

function sanitizeEntityTitle(
    kind: EntityDialogKind,
    entityId: unknown,
    title: unknown,
    payload: EntityDialogPayload
) {
    const normalizedTitle = normalizeTitle(title);
    const normalizedEntityId = normalizeEntityId(entityId);
    if (normalizedTitle && normalizedTitle !== normalizedEntityId) {
        return normalizedTitle;
    }
    const seedTitle = readSeedTitle(kind, payload?.seedData ?? payload);
    if (seedTitle && seedTitle !== normalizedEntityId) {
        return seedTitle;
    }
    return defaultEntityTitle(kind);
}

function openEntityDialog({
    kind,
    entityId,
    title = '',
    description = '',
    payload = null
}: OpenEntityDialogOptions = {}) {
    const normalizedEntityId = normalizeEntityId(entityId);
    if (!kind || !normalizedEntityId) {
        return;
    }

    const store = useDialogStore.getState();
    if (
        store.activeDialog?.kind === kind &&
        normalizeEntityId(store.activeDialog?.entityId) === normalizedEntityId
    ) {
        if (kind === 'user' && payload?.initialAction) {
            const nextPayload: any = {
                ...(isRecord(store.activeDialog.payload)
                    ? store.activeDialog.payload
                    : {}),
                ...payload
            };
            entityDialogOpenNonce += 1;
            const nextDialog: any = {
                ...store.activeDialog,
                payload: nextPayload,
                openNonce: entityDialogOpenNonce
            };
            store.setDialogTrail(
                nextDialog,
                store.breadcrumbs.map((crumb: any, index: any) =>
                    index === store.breadcrumbs.length - 1
                        ? {
                              ...crumb,
                              payload: nextPayload,
                              openNonce: entityDialogOpenNonce
                          }
                        : crumb
                )
            );
            return;
        }
        if (kind === 'user') {
            toast.info(
                i18n.t('dialog.user.toast.already_viewing_user', {
                    defaultValue: 'Already viewing this user'
                })
            );
        }
        return;
    }

    const label = sanitizeEntityTitle(kind, normalizedEntityId, title, payload);
    entityDialogOpenNonce += 1;
    const openNonce = entityDialogOpenNonce;
    const dialog: any = {
        kind,
        entityId: normalizedEntityId,
        title: label,
        description: normalizeTitle(description),
        payload,
        openNonce
    };
    const crumb: any = {
        key: `${kind}:${normalizedEntityId}`,
        kind,
        entityId: normalizedEntityId,
        label,
        title: label,
        description: normalizeTitle(description),
        payload,
        openNonce
    };
    const activeDialogIsEntity = Boolean(
        store.activeDialog?.kind && store.activeDialog?.entityId
    );
    const breadcrumbs = activeDialogIsEntity
        ? [...store.breadcrumbs, crumb]
        : [crumb];

    store.setDialogTrail(dialog, breadcrumbs);
}

export function openUserDialog({
    userId,
    title = '',
    description = '',
    seedData = null,
    initialAction = ''
}: OpenUserDialogOptions = {}) {
    recordUserDialogSeed(userId, title, seedData);
    openEntityDialog({
        kind: 'user',
        entityId: userId,
        title,
        description,
        payload:
            seedData || initialAction
                ? {
                      ...(seedData ? { seedData } : {}),
                      ...(initialAction ? { initialAction } : {})
                  }
                : null
    });
}

export function openWorldDialog({
    worldId,
    title = '',
    description = '',
    seedData = null,
    initialAction = '',
    initialNewInstanceDefaults = null
}: OpenWorldDialogOptions = {}) {
    openEntityDialog({
        kind: 'world',
        entityId: worldId,
        title,
        description,
        payload:
            seedData || initialAction || initialNewInstanceDefaults
                ? {
                      seedData,
                      initialAction,
                      initialActionNonce: initialAction ? Date.now() : 0,
                      initialNewInstanceDefaults
                  }
                : null
    });
}

export function openAvatarDialog({
    avatarId,
    title = '',
    description = '',
    seedData = null
}: OpenAvatarDialogOptions = {}) {
    openEntityDialog({
        kind: 'avatar',
        entityId: avatarId,
        title,
        description,
        payload: seedData ? { seedData } : null
    });
}

export function openGroupDialog({
    groupId,
    title = '',
    description = '',
    seedData = null
}: OpenGroupDialogOptions = {}) {
    openEntityDialog({
        kind: 'group',
        entityId: groupId,
        title,
        description,
        payload: seedData ? { seedData } : null
    });
}
