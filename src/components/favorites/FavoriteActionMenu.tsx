import { HeartIcon } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import favoritePersistenceRepository from '@/repositories/favoritePersistenceRepository';
import vrchatFavoriteRepository from '@/repositories/vrchatFavoriteRepository';
import { persistWorldDetails } from '@/services/favoriteWorldCacheService';
import { useFavoriteStore } from '@/state/favoriteStore';
import type {
    FavoriteGroup as FavoriteStoreGroup,
    FavoriteGroupMap,
    FavoriteKind,
    FavoriteRecord,
    FavoriteStore
} from '@/state/favoriteStoreTypes';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Spinner } from '@/ui/shadcn/spinner';

const EMPTY_GROUPS: FavoriteStoreGroup[] = [];
const EMPTY_LOCAL_GROUPS: string[] = [];
const EMPTY_FAVORITES: FavoriteGroupMap = {};

type FavoriteActionMenuProps = {
    kind: FavoriteKind;
    entityId: unknown;
    entity?: unknown;
    label?: string;
    iconOnly?: boolean;
};

function normalizeEntityId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function resolveGroups(kind: FavoriteKind, state: FavoriteStore) {
    if (kind === 'friend') {
        return state.favoriteFriendGroups;
    }
    if (kind === 'avatar') {
        return state.favoriteAvatarGroups;
    }
    if (kind === 'world') {
        return state.favoriteWorldGroups;
    }
    return EMPTY_GROUPS;
}

function resolveLocalGroups(kind: FavoriteKind, state: FavoriteStore) {
    if (kind === 'friend') {
        return state.localFriendFavoriteGroups;
    }
    if (kind === 'avatar') {
        return state.localAvatarFavoriteGroups;
    }
    if (kind === 'world') {
        return state.localWorldFavoriteGroups;
    }
    return EMPTY_LOCAL_GROUPS;
}

function resolveLocalFavorites(kind: FavoriteKind, state: FavoriteStore) {
    if (kind === 'friend') {
        return state.localFriendFavorites || {};
    }
    if (kind === 'avatar') {
        return state.localAvatarFavorites || {};
    }
    if (kind === 'world') {
        return state.localWorldFavorites || {};
    }
    return EMPTY_FAVORITES;
}

function formatGroupLabel(group: FavoriteStoreGroup) {
    const count = Number(group.count) || 0;
    const capacity = Number(group.capacity) || 0;
    const suffix =
        capacity > 0 ? ` (${count}/${capacity})` : count ? ` (${count})` : '';
    return `${String(group.displayName || group.name || group.key)}${suffix}`;
}

function groupDisplayLabel(group: FavoriteStoreGroup | undefined) {
    return String(group?.displayName || group?.name || group?.key || '');
}

export function resolveRemoteFavoriteGroupLabel(
    remoteFavorite: FavoriteRecord | null | undefined,
    groups: readonly FavoriteStoreGroup[] | null | undefined
) {
    const groupKey = normalizeEntityId(remoteFavorite?.$groupKey);
    const type = normalizeEntityId(remoteFavorite?.type);
    const tag = Array.isArray(remoteFavorite?.tags)
        ? normalizeEntityId(remoteFavorite.tags[0])
        : '';
    const candidates = new Set(
        [
            groupKey,
            tag.includes(':') ? tag : '',
            type && tag ? `${type}:${tag}` : ''
        ].filter(Boolean)
    );
    const group = (Array.isArray(groups) ? groups : EMPTY_GROUPS).find((item) =>
        candidates.has(normalizeEntityId(item?.key))
    );

    return groupDisplayLabel(group) || groupKey || tag || 'Current group';
}

function hasLocalFavorite(
    localFavorites: FavoriteGroupMap,
    groupName: string,
    entityId: string
) {
    return (
        Array.isArray(localFavorites?.[groupName]) &&
        localFavorites[groupName].some(
            (value) => normalizeEntityId(value) === entityId
        )
    );
}

function localGroupLabel(localFavorites: FavoriteGroupMap, groupName: string) {
    const count = Array.isArray(localFavorites?.[groupName])
        ? localFavorites[groupName].length
        : 0;
    return `${groupName} (${count})`;
}

export function FavoriteActionMenu({
    kind,
    entityId,
    entity = null,
    label = '',
    iconOnly = false
}: FavoriteActionMenuProps) {
    const { t } = useTranslation();

    const normalizedEntityId = normalizeEntityId(entityId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const confirm = useModalStore((state) => state.confirm);
    const groups = useFavoriteStore((state) => resolveGroups(kind, state));
    const storedLocalGroups = useFavoriteStore((state) =>
        resolveLocalGroups(kind, state)
    );
    const localFavorites = useFavoriteStore((state) =>
        resolveLocalFavorites(kind, state)
    );
    const localGroups = useMemo(
        () =>
            storedLocalGroups.length
                ? storedLocalGroups
                : Object.keys(localFavorites),
        [storedLocalGroups, localFavorites]
    );
    const localFavoriteActive = useMemo(
        () =>
            localGroups.some((groupName) =>
                hasLocalFavorite(localFavorites, groupName, normalizedEntityId)
            ),
        [localFavorites, localGroups, normalizedEntityId]
    );
    const remoteFavorite = useFavoriteStore(
        (state) => state.remoteFavoritesByObjectId[normalizedEntityId] || null
    );
    const remoteFavoriteGroupLabel = useMemo(
        () => resolveRemoteFavoriteGroupLabel(remoteFavorite, groups),
        [groups, remoteFavorite]
    );
    const addRemoteFavorite = useFavoriteStore(
        (state) => state.addRemoteFavorite
    );
    const removeRemoteFavorite = useFavoriteStore(
        (state) => state.removeRemoteFavorite
    );
    const addLocalFavorite = useFavoriteStore(
        (state) => state.addLocalFavorite
    );
    const removeLocalFavorite = useFavoriteStore(
        (state) => state.removeLocalFavorite
    );
    const [actionStatus, setActionStatus] = useState('idle');
    const actionStatusRef = useRef('idle');

    async function addFavorite(group: FavoriteStoreGroup) {
        if (!normalizedEntityId || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'favorite';
        setActionStatus('favorite');
        try {
            const response = await vrchatFavoriteRepository.addFavorite({
                endpoint: currentEndpoint,
                type: group.type || kind,
                favoriteId: normalizedEntityId,
                tags: group.name
            });
            if (isRecord(response.json)) {
                addRemoteFavorite(response.json);
            }
            if (kind === 'world' && isRecord(entity)) {
                persistWorldDetails(entity, normalizedEntityId);
            }
            toast.success(t('view.favorite.label.favorite_added'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.favorite_action_menu.toast.failed_to_add_favorite'
                      )
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function deleteFavorite() {
        if (!normalizedEntityId || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'favorite';
        setActionStatus('favorite');
        const result = await confirm({
            title: t(
                'component.favorite_action_menu.modal.remove_vrchat_favorite'
            ),
            description: t(
                'component.favorite_action_menu.dynamic.remove_value_from_vrchat_favorites',
                { value: normalizedEntityId }
            ),
            destructive: true,
            confirmText: t('common.actions.remove'),
            cancelText: t('common.actions.cancel')
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            await vrchatFavoriteRepository.deleteFavorite({
                endpoint: currentEndpoint,
                objectId: normalizedEntityId
            });
            removeRemoteFavorite(normalizedEntityId);
            toast.success(t('view.favorite.success.favorite_removed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.favorite_action_menu.toast.failed_to_remove_favorite'
                      )
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function addLocalFavoriteToGroup(groupName: any) {
        if (!normalizedEntityId || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'local-favorite';
        setActionStatus('local-favorite');
        try {
            if (kind === 'world' && isRecord(entity)) {
                persistWorldDetails(entity, normalizedEntityId);
            }
            await favoritePersistenceRepository.addLocalFavorite({
                kind,
                entityId: normalizedEntityId,
                groupName
            });
            addLocalFavorite({
                kind,
                entityId: normalizedEntityId,
                groupName,
                entity
            });
            toast.success(t('view.favorite.label.local_favorite_added'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.favorite_action_menu.toast.failed_to_add_local_favorite'
                      )
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function removeLocalFavoriteFromGroup(groupName: any) {
        if (!normalizedEntityId || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'local-favorite';
        setActionStatus('local-favorite');
        try {
            await favoritePersistenceRepository.removeLocalFavorite({
                kind,
                entityId: normalizedEntityId,
                groupName
            });
            removeLocalFavorite({
                kind,
                entityId: normalizedEntityId,
                groupName
            });
            toast.success(t('view.favorite.success.local_favorite_removed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.favorite_action_menu.toast.failed_to_remove_local_favorite'
                      )
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    if (!normalizedEntityId) {
        return null;
    }

    const favorited = Boolean(remoteFavorite) || localFavoriteActive;
    const triggerLabel = favorited
        ? t('view.favorite.label.favorited')
        : label || t('view.favorite.label.favorite');
    const localFavoritesLabel =
        kind === 'avatar'
            ? t('dialog.favorite.local_avatar_favorites')
            : t('dialog.favorite.local_favorites');

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size={iconOnly ? 'icon-lg' : 'sm'}
                    variant={
                        iconOnly
                            ? 'outline'
                            : remoteFavorite
                              ? 'default'
                              : 'outline'
                    }
                    disabled={actionStatus !== 'idle'}
                    aria-label={triggerLabel}
                    title={triggerLabel}
                >
                    {actionStatus !== 'idle' ? (
                        <Spinner data-icon="inline-start" />
                    ) : (
                        <HeartIcon
                            data-icon="inline-start"
                            className={favorited ? 'fill-current' : ''}
                        />
                    )}
                    {iconOnly ? null : triggerLabel}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>
                    {t('view.favorite.label.vrchat_favorites')}
                </DropdownMenuLabel>
                {remoteFavorite ? (
                    <>
                        <DropdownMenuGroup>
                            <DropdownMenuItem disabled>
                                {remoteFavoriteGroupLabel}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuItem
                                variant="destructive"
                                onSelect={(event) => {
                                    event.preventDefault();
                                    deleteFavorite();
                                }}
                            >
                                {t('view.favorite.action.remove_favorite')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </>
                ) : groups.length ? (
                    <DropdownMenuGroup>
                        {groups.map((group) => {
                            const isFull =
                                Number(group.capacity) > 0 &&
                                (Number(group.count) || 0) >=
                                    Number(group.capacity);

                            return (
                                <DropdownMenuItem
                                    key={String(group.key ?? '')}
                                    disabled={isFull}
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        addFavorite(group);
                                    }}
                                >
                                    {formatGroupLabel(group)}
                                </DropdownMenuItem>
                            );
                        })}
                    </DropdownMenuGroup>
                ) : (
                    <DropdownMenuGroup>
                        <DropdownMenuItem disabled>
                            {t('view.favorite.empty.no_favorite_groups_loaded')}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{localFavoritesLabel}</DropdownMenuLabel>
                {localGroups.length ? (
                    <DropdownMenuGroup>
                        {localGroups.map((groupName) => {
                            const isLocalFavorite = hasLocalFavorite(
                                localFavorites,
                                groupName,
                                normalizedEntityId
                            );
                            return (
                                <DropdownMenuCheckboxItem
                                    key={groupName}
                                    checked={isLocalFavorite}
                                    onSelect={(event) => event.preventDefault()}
                                    onCheckedChange={() => {
                                        if (isLocalFavorite) {
                                            removeLocalFavoriteFromGroup(
                                                groupName
                                            );
                                        } else {
                                            addLocalFavoriteToGroup(groupName);
                                        }
                                    }}
                                >
                                    {localGroupLabel(localFavorites, groupName)}
                                </DropdownMenuCheckboxItem>
                            );
                        })}
                    </DropdownMenuGroup>
                ) : (
                    <DropdownMenuGroup>
                        <DropdownMenuItem disabled>
                            {t(
                                'view.favorite.empty.no_local_favorite_groups_loaded'
                            )}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
