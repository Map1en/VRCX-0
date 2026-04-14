import { useRef, useState } from 'react';
import { CheckIcon, HeartIcon, LoaderCircleIcon } from 'lucide-react';
import { toast } from 'sonner';

import { localFavoritesRepository, vrchatFavoriteRepository } from '@/repositories/index.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu.jsx';

function normalizeEntityId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
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
    const suffix = capacity > 0 ? ` (${count}/${capacity})` : count ? ` (${count})` : '';
    return `${group.displayName || group.name || group.key}${suffix}`;
}

function hasLocalFavorite(localFavorites, groupName, entityId) {
    return Array.isArray(localFavorites?.[groupName]) &&
        localFavorites[groupName].some((value) => normalizeEntityId(value) === entityId);
}

function localGroupLabel(localFavorites, groupName) {
    const count = Array.isArray(localFavorites?.[groupName]) ? localFavorites[groupName].length : 0;
    return `${groupName} (${count})`;
}

export function FavoriteActionMenu({ kind, entityId, entity = null, label = 'Favorite' }) {
    const normalizedEntityId = normalizeEntityId(entityId);
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentUserSnapshot = useRuntimeStore((state) => state.auth.currentUserSnapshot);
    const confirm = useModalStore((state) => state.confirm);
    const groups = useFavoriteStore((state) => resolveGroups(kind, state));
    const localGroups = useFavoriteStore((state) => resolveLocalGroups(kind, state));
    const localFavorites = useFavoriteStore((state) => resolveLocalFavorites(kind, state));
    const remoteFavorite = useFavoriteStore(
        (state) => state.remoteFavoritesByObjectId[normalizedEntityId] || null
    );
    const addRemoteFavorite = useFavoriteStore((state) => state.addRemoteFavorite);
    const removeRemoteFavorite = useFavoriteStore((state) => state.removeRemoteFavorite);
    const addLocalFavorite = useFavoriteStore((state) => state.addLocalFavorite);
    const removeLocalFavorite = useFavoriteStore((state) => state.removeLocalFavorite);
    const [actionStatus, setActionStatus] = useState('idle');
    const actionStatusRef = useRef('idle');
    const isLocalUserVrcPlusSupporter = Boolean(
        currentUserSnapshot?.$isVRCPlus ||
            currentUserSnapshot?.tags?.includes?.('system_supporter') ||
            currentUserSnapshot?.tags?.includes?.('system_supporter_early_adopter') ||
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
            toast.success('Favorite added.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to add favorite.');
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
            title: 'Remove VRChat favorite?',
            description: `Remove ${normalizedEntityId} from VRChat favorites?`,
            destructive: true,
            confirmText: 'Remove',
            cancelText: 'Cancel'
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
            toast.success('Favorite removed.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to remove favorite.');
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
            toast.success('Local favorite added.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to add local favorite.');
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
            toast.success('Local favorite removed.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to remove local favorite.');
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
                    className="gap-2"
                    disabled={actionStatus !== 'idle'}>
                    {actionStatus !== 'idle' ? (
                        <LoaderCircleIcon className="size-4 animate-spin" />
                    ) : (
                        <HeartIcon className={remoteFavorite ? 'size-4 fill-current' : 'size-4'} />
                    )}
                    {remoteFavorite ? 'Favorited' : label}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>VRChat favorites</DropdownMenuLabel>
                {remoteFavorite ? (
                    <>
                        <DropdownMenuItem disabled>
                            {remoteFavorite.$groupKey || remoteFavorite.tags?.[0] || 'Current group'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={(event) => {
                                event.preventDefault();
                                void deleteFavorite();
                            }}>
                            Remove favorite
                        </DropdownMenuItem>
                    </>
                ) : groups.length ? (
                    groups.map((group) => {
                        const isFull =
                            Number(group.capacity) > 0 &&
                            (Number(group.count) || 0) >= Number(group.capacity);

                        return (
                            <DropdownMenuItem
                                key={group.key}
                                disabled={isFull}
                                onSelect={(event) => {
                                    event.preventDefault();
                                    void addFavorite(group);
                                }}>
                                {formatGroupLabel(group)}
                            </DropdownMenuItem>
                        );
                    })
                ) : (
                    <DropdownMenuItem disabled>
                        No favorite groups loaded
                    </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>
                    {kind === 'avatar' ? 'Local avatar favorites' : 'Local favorites'}
                </DropdownMenuLabel>
                {localGroups.length ? (
                    localGroups.map((groupName) => {
                        const isLocalFavorite = hasLocalFavorite(localFavorites, groupName, normalizedEntityId);
                        const disabled = kind === 'avatar' && !isLocalFavorite && !isLocalUserVrcPlusSupporter;
                        return (
                            <DropdownMenuItem
                                key={groupName}
                                disabled={disabled}
                                onSelect={(event) => {
                                    event.preventDefault();
                                    if (isLocalFavorite) {
                                        void removeLocalFavoriteFromGroup(groupName);
                                    } else {
                                        void addLocalFavoriteToGroup(groupName);
                                    }
                                }}>
                                {isLocalFavorite ? <CheckIcon className="size-4" /> : null}
                                {localGroupLabel(localFavorites, groupName)}
                            </DropdownMenuItem>
                        );
                    })
                ) : (
                    <DropdownMenuItem disabled>
                        No local favorite groups loaded
                    </DropdownMenuItem>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
