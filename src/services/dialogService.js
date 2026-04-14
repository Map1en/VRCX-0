import { useDialogStore } from '@/state/dialogStore.js';

function normalizeEntityId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeTitle(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function defaultEntityTitle(kind) {
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

function readSeedTitle(kind, seedData) {
    if (!seedData || typeof seedData !== 'object') {
        return '';
    }
    switch (kind) {
        case 'user':
            return normalizeTitle(seedData.displayName || seedData.username || seedData.name);
        case 'world':
        case 'avatar':
        case 'group':
            return normalizeTitle(seedData.name || seedData.displayName || seedData.shortName);
        default:
            return '';
    }
}

function sanitizeEntityTitle(kind, entityId, title, payload) {
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
} = {}) {
    const normalizedEntityId = normalizeEntityId(entityId);
    if (!kind || !normalizedEntityId) {
        return;
    }

    const label = sanitizeEntityTitle(kind, normalizedEntityId, title, payload);
    const dialog = {
        kind,
        entityId: normalizedEntityId,
        title: label,
        description,
        payload
    };
    const crumb = {
        key: `${kind}:${normalizedEntityId}`,
        kind,
        entityId: normalizedEntityId,
        label,
        title: label,
        description,
        payload
    };
    const store = useDialogStore.getState();
    const existingIndex = store.breadcrumbs.findIndex((entry) => entry?.key === crumb.key);
    const activeDialogIsEntity = Boolean(store.activeDialog?.kind && store.activeDialog?.entityId);
    const breadcrumbs =
        existingIndex >= 0
            ? store.breadcrumbs.slice(0, existingIndex + 1)
            : activeDialogIsEntity
                ? [...store.breadcrumbs, crumb]
                : [crumb];

    store.setDialogTrail(dialog, breadcrumbs);
}

export function openUserDialog({ userId, title = '', description = '', seedData = null } = {}) {
    openEntityDialog({
        kind: 'user',
        entityId: userId,
        title,
        description,
        payload: seedData ? { seedData } : null
    });
}

export function openWorldDialog({
    worldId,
    title = '',
    description = '',
    seedData = null,
    initialAction = ''
} = {}) {
    openEntityDialog({
        kind: 'world',
        entityId: worldId,
        title,
        description,
        payload: seedData || initialAction
            ? { seedData, initialAction, initialActionNonce: initialAction ? Date.now() : 0 }
            : null
    });
}

export function openAvatarDialog({ avatarId, title = '', description = '', seedData = null } = {}) {
    openEntityDialog({
        kind: 'avatar',
        entityId: avatarId,
        title,
        description,
        payload: seedData ? { seedData } : null
    });
}

export function openGroupDialog({ groupId, title = '', description = '', seedData = null } = {}) {
    openEntityDialog({
        kind: 'group',
        entityId: groupId,
        title,
        description,
        payload: seedData ? { seedData } : null
    });
}
