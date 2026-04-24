import { HeartIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import {
    localFavoritesRepository,
    vrchatFavoriteRepository
} from '@/repositories/index.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
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

function normalizeEntityId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function resolveGroups(kind, state) {
    if (kind === 'friend') {
        return state.favoriteFriendGroups;
    }
    if (kind === 'avatar') {
        return state.favoriteAvatarGroups;
    }
    if (kind === 'world') {
        return state.favoriteWorldGroups;
    }
    return [];
}

function resolveLocalGroups(kind, state) {
    if (kind === 'friend') {
        return state.localFriendFavoriteGroups.length
            ? state.localFriendFavoriteGroups
            : Object.keys(state.localFriendFavorites || {});
    }
    if (kind === 'avatar') {
        return state.localAvatarFavoriteGroups.length
            ? state.localAvatarFavoriteGroups
            : Object.keys(state.localAvatarFavorites || {});
    }
    if (kind === 'world') {
        return state.localWorldFavoriteGroups.length
            ? state.localWorldFavoriteGroups
            : Object.keys(state.localWorldFavorites || {});
    }
    return [];
}

function resolveLocalFavorites(kind, state) {
    if (kind === 'friend') {
        return state.localFriendFavorites || {};
    }
    if (kind === 'avatar') {
        return state.localAvatarFavorites || {};
    }
    if (kind === 'world') {
        return state.localWorldFavorites || {};
    }
    return {};
}

function formatGroupLabel(group) {
    const count = Number(group.count) || 0;
    const capacity = Number(group.capacity) || 0;
    const suffix =
        capacity > 0 ? ` (${count}/${capacity})` : count ? ` (${count})` : '';
    return `${group.displayName || group.name || group.key}${suffix}`;
}

function hasLocalFavorite(localFavorites, groupName, entityId) {
    return (
        Array.isArray(localFavorites?.[groupName]) &&
        localFavorites[groupName].some(
            (value) => normalizeEntityId(value) === entityId
        )
    );
}

function localGroupLabel(localFavorites, groupName) {
    const count = Array.isArray(localFavorites?.[groupName])
        ? localFavorites[groupName].length
        : 0;
    return `${groupName} (${count})`;
}

export function FavoriteActionMenu({
    kind,
    entityId,
    entity = null,
    label = 'Favorite'
}) {
    const { t } = useTranslation();

    const normalizedEntityId = normalizeEntityId(entityId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const confirm = useModalStore((state) => state.confirm);
    const groups = useFavoriteStore((state) => resolveGroups(kind, state));
    const localGroups = useFavoriteStore((state) =>
        resolveLocalGroups(kind, state)
    );
    const localFavorites = useFavoriteStore((state) =>
        resolveLocalFavorites(kind, state)
    );
    const remoteFavorite = useFavoriteStore(
        (state) => state.remoteFavoritesByObjectId[normalizedEntityId] || null
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
    const isLocalUserVrcPlusSupporter = Boolean(
        currentUserSnapshot?.$isVRCPlus ||
        currentUserSnapshot?.tags?.includes?.('system_supporter') ||
        currentUserSnapshot?.tags?.includes?.(
            'system_supporter_early_adopter'
        ) ||
        currentUserSnapshot?.tags?.includes?.('system_supporter_legacy')
    );

    async function addFavorite(group) {
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
            if (response.json && typeof response.json === 'object') {
                addRemoteFavorite(response.json);
            }
            toast.success(t('view.favorite.generated.favorite_added'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.favorite_action_menu.generated_toast.failed_to_add_favorite')
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
            title: t('component.favorite_action_menu.generated_modal.remove_vrchat_favorite'),
            description: t('component.favorite_action_menu.generated_dynamic.remove_value_from_vrchat_favorites', { value: normalizedEntityId }),
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
            toast.success(t('view.favorite.generated.favorite_removed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.favorite_action_menu.generated_toast.failed_to_remove_favorite')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function addLocalFavoriteToGroup(groupName) {
        if (!normalizedEntityId || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'local-favorite';
        setActionStatus('local-favorite');
        try {
            await localFavoritesRepository.addLocalFavorite({
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
            toast.success(t('view.favorite.generated.local_favorite_added'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.favorite_action_menu.generated_toast.failed_to_add_local_favorite')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function removeLocalFavoriteFromGroup(groupName) {
        if (!normalizedEntityId || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'local-favorite';
        setActionStatus('local-favorite');
        try {
            await localFavoritesRepository.removeLocalFavorite({
                kind,
                entityId: normalizedEntityId,
                groupName
            });
            removeLocalFavorite({
                kind,
                entityId: normalizedEntityId,
                groupName
            });
            toast.success(t('view.favorite.generated.local_favorite_removed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.favorite_action_menu.generated_toast.failed_to_remove_local_favorite')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    if (!normalizedEntityId) {
        return null;
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size="sm"
                    variant={remoteFavorite ? 'default' : 'outline'}
                    disabled={actionStatus !== 'idle'}
                >
                    {actionStatus !== 'idle' ? (
                        <Spinner data-icon="inline-start" />
                    ) : (
                        <HeartIcon
                            data-icon="inline-start"
                            className={remoteFavorite ? 'fill-current' : ''}
                        />
                    )}
                    {remoteFavorite ? 'Favorited' : label}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>{t('view.favorite.generated.vrchat_favorites')}</DropdownMenuLabel>
                {remoteFavorite ? (
                    <>
                        <DropdownMenuGroup>
                            <DropdownMenuItem disabled>
                                {remoteFavorite.$groupKey ||
                                    remoteFavorite.tags?.[0] ||
                                    'Current group'}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuItem
                                variant="destructive"
                                onSelect={(event) => {
                                    event.preventDefault();
                                    void deleteFavorite();
                                }}
                            >
                                {t('view.favorite.generated.remove_favorite')}
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
                                    key={group.key}
                                    disabled={isFull}
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        void addFavorite(group);
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
                            {t('view.favorite.generated.no_favorite_groups_loaded')}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>
                    {kind === 'avatar'
                        ? 'Local avatar favorites'
                        : 'Local favorites'}
                </DropdownMenuLabel>
                {localGroups.length ? (
                    <DropdownMenuGroup>
                        {localGroups.map((groupName) => {
                            const isLocalFavorite = hasLocalFavorite(
                                localFavorites,
                                groupName,
                                normalizedEntityId
                            );
                            const disabled =
                                kind === 'avatar' &&
                                !isLocalFavorite &&
                                !isLocalUserVrcPlusSupporter;
                            return (
                                <DropdownMenuCheckboxItem
                                    key={groupName}
                                    checked={isLocalFavorite}
                                    disabled={disabled}
                                    onSelect={(event) => event.preventDefault()}
                                    onCheckedChange={() => {
                                        if (isLocalFavorite) {
                                            void removeLocalFavoriteFromGroup(
                                                groupName
                                            );
                                        } else {
                                            void addLocalFavoriteToGroup(
                                                groupName
                                            );
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
                            {t('view.favorite.generated.no_local_favorite_groups_loaded')}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
