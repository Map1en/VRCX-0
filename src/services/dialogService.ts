import { toast } from 'sonner';

import {
    browseHistoryRepository,
    type BrowseHistoryEntityKind
} from '@/repositories/browseHistoryRepository';
import i18n from '@/services/i18nService';
import { recordUserProfile } from '@/services/userFactAccessService';
import { restoreNormalWindowModeForIntent } from '@/services/windowModeService';
import { isRecord } from '@/shared/utils/record';
import {
    useDialogStore,
    type ActiveDialog,
    type DialogBreadcrumb,
    type WorldNewInstanceDefaults
} from '@/state/dialogStore';
import { useRuntimeStore } from '@/state/runtimeStore';

let entityDialogOpenNonce = 0;

type EntityDialogKind = 'user' | 'world' | 'avatar' | 'group' | (string & {});
type DialogRecord = Record<string, unknown>;
type EntityDialogPayload =
    | (DialogRecord & {
          seedData?: DialogRecord | null;
          initialAction?: string;
          initialActionNonce?: number;
          initialNewInstanceDefaults?: WorldNewInstanceDefaults | null;
      })
    | null;
type EntityDialog = ActiveDialog & {
    kind: EntityDialogKind;
    openNonce?: number;
    payload?: EntityDialogPayload;
};
type EntityDialogBreadcrumb = DialogBreadcrumb & {
    key: string;
    kind: EntityDialogKind;
    entityId: string;
    label: string;
    title: string;
    description: string;
    payload: EntityDialogPayload;
    openNonce: number;
};

type OpenEntityDialogOptions = {
    kind?: EntityDialogKind;
    entityId?: string | null;
    title?: string;
    description?: string;
    payload?: EntityDialogPayload;
};

type OpenUserDialogOptions = {
    userId?: string | null;
    title?: string;
    description?: string;
    seedData?: DialogRecord | null;
    initialAction?: string;
};

type OpenWorldDialogOptions = {
    worldId?: string | null;
    title?: string;
    description?: string;
    seedData?: DialogRecord | null;
    initialAction?: string;
    initialNewInstanceDefaults?: WorldNewInstanceDefaults | null;
};

type OpenAvatarDialogOptions = {
    avatarId?: string | null;
    title?: string;
    description?: string;
    seedData?: DialogRecord | null;
};

type OpenGroupDialogOptions = {
    groupId?: string | null;
    title?: string;
    description?: string;
    seedData?: DialogRecord | null;
};

type EntityHistorySnapshot = {
    kind: BrowseHistoryEntityKind;
    entityId: string;
    title?: string;
    imageUrl?: string;
};

const browseHistoryKinds = new Set<EntityDialogKind>([
    'user',
    'world',
    'avatar',
    'group'
]);
const historyImageKeys: Record<BrowseHistoryEntityKind, readonly string[]> = {
    user: [
        'profilePicOverrideThumbnail',
        'profilePicOverride',
        'currentAvatarThumbnailImageUrl',
        'currentAvatarImageUrl'
    ],
    world: ['thumbnailImageUrl', 'imageUrl'],
    avatar: ['thumbnailImageUrl', 'imageUrl'],
    group: ['iconUrl', 'bannerUrl']
};

function normalizeEntityId(value: string | null | undefined) {
    return value?.trim() ?? '';
}

function normalizeTitle(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function readString(record: DialogRecord | null, keys: readonly string[]) {
    if (!record) {
        return '';
    }
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return '';
}

function isBrowseHistoryEntityKind(
    kind: EntityDialogKind
): kind is BrowseHistoryEntityKind {
    return browseHistoryKinds.has(kind);
}

function recordEntityHistory(
    snapshot: EntityHistorySnapshot,
    recordVisit: boolean
) {
    const ownerUserId = useRuntimeStore.getState().auth.currentUserId?.trim();
    const entityId = normalizeEntityId(snapshot.entityId);
    if (!ownerUserId || !entityId) {
        return;
    }

    void browseHistoryRepository
        .record({
            ownerUserId,
            entityKind: snapshot.kind,
            entityId,
            title: normalizeTitle(snapshot.title),
            imageUrl: normalizeTitle(snapshot.imageUrl),
            recordVisit
        })
        .catch((error: unknown) => {
            console.warn('Failed to record browse history', error);
        });
}

function readOpeningSnapshot(
    kind: BrowseHistoryEntityKind,
    entityId: string,
    label: string,
    payload: EntityDialogPayload
): EntityHistorySnapshot {
    const seed = isRecord(payload?.seedData) ? payload.seedData : null;
    return {
        kind,
        entityId,
        title: label,
        imageUrl: readString(seed, historyImageKeys[kind])
    };
}

export function enrichEntityDialogHistory(snapshot: EntityHistorySnapshot) {
    recordEntityHistory(snapshot, false);
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
    userId: string | null | undefined,
    title: string,
    seedData: DialogRecord | null
) {
    const normalizedUserId =
        normalizeEntityId(userId) ||
        normalizeTitle(seedData?.id || seedData?.userId);
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
    entityId: string,
    title: string,
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
    restoreNormalWindowModeForIntent();

    const store = useDialogStore.getState();
    if (
        store.activeDialog?.kind === kind &&
        normalizeEntityId(store.activeDialog?.entityId) === normalizedEntityId
    ) {
        if (kind === 'user' && payload?.initialAction) {
            const nextPayload: EntityDialogPayload = {
                ...(isRecord(store.activeDialog.payload)
                    ? store.activeDialog.payload
                    : {}),
                ...payload
            };
            entityDialogOpenNonce += 1;
            const nextDialog: EntityDialog = {
                ...store.activeDialog,
                payload: nextPayload,
                openNonce: entityDialogOpenNonce
            };
            store.setDialogTrail(
                nextDialog,
                store.breadcrumbs.map((crumb, index) =>
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
    const dialog: EntityDialog = {
        kind,
        entityId: normalizedEntityId,
        title: label,
        description: normalizeTitle(description),
        payload,
        openNonce
    };
    const crumb: EntityDialogBreadcrumb = {
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
    const existingIndex = activeDialogIsEntity
        ? store.breadcrumbs.findIndex(
              (entry) =>
                  entry.kind === kind &&
                  normalizeEntityId(entry.entityId) === normalizedEntityId
          )
        : -1;
    const breadcrumbs =
        existingIndex >= 0
            ? [...store.breadcrumbs.slice(0, existingIndex), crumb]
            : activeDialogIsEntity
              ? [...store.breadcrumbs, crumb]
              : [crumb];

    store.setDialogTrail(dialog, breadcrumbs);
    if (isBrowseHistoryEntityKind(kind)) {
        recordEntityHistory(
            readOpeningSnapshot(kind, normalizedEntityId, label, payload),
            true
        );
    }
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
