import { SearchIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { convertFileUrlToImageUrl, userImage } from '@/lib/entityMedia.js';
import {
    groupProfileRepository,
    myAvatarRepository,
    vrchatFavoriteRepository,
    worldProfileRepository
} from '@/repositories/index.js';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput
} from '@/ui/shadcn/input-group';

import { entityTypeLabel, ResultGroup } from './QuickSearchResults.jsx';

const RESULT_LIMIT = 8;

function createEmptyCatalog(status = 'idle', detail = '') {
    return {
        status,
        detail,
        ownAvatars: [],
        favoriteAvatars: [],
        ownWorlds: [],
        favoriteWorlds: [],
        groups: []
    };
}

function normalize(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeQuery(value) {
    return normalize(value).toLowerCase();
}

function matchesQuery(row, query) {
    const haystack = [row.name, row.subtitle, row.id, row.memo, row.note]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    return haystack.includes(query);
}

function filterResults(rows, query, limit = RESULT_LIMIT) {
    return rows
        .filter((row) => matchesQuery(row, query))
        .sort((left, right) => {
            const leftPrefix = normalizeQuery(left.name).startsWith(query)
                ? 0
                : 1;
            const rightPrefix = normalizeQuery(right.name).startsWith(query)
                ? 0
                : 1;
            if (leftPrefix !== rightPrefix) {
                return leftPrefix - rightPrefix;
            }
            return normalize(left.name || left.id).localeCompare(
                normalize(right.name || right.id),
                undefined,
                {
                    sensitivity: 'base'
                }
            );
        })
        .slice(0, limit);
}

function dedupeResults(rows, excludeIds = new Set()) {
    const rowsById = new Map();
    for (const row of rows) {
        const id = normalize(row?.id);
        if (!id || excludeIds.has(id) || rowsById.has(id)) {
            continue;
        }
        rowsById.set(id, row);
    }
    return Array.from(rowsById.values());
}

function favoriteName(row) {
    return row?.name || row?.displayName || '';
}

function resolveImageUrl(row) {
    return convertFileUrlToImageUrl(
        row?.thumbnailImageUrl ||
            row?.thumbnail_image_url ||
            row?.imageUrl ||
            row?.image_url ||
            row?.iconUrl ||
            row?.bannerUrl
    );
}

function buildEntityResult(row, type, source) {
    const id = normalize(row?.favoriteId || row?.objectId || row?.id);
    if (!id) {
        return null;
    }
    return {
        id,
        type,
        source,
        name: favoriteName(row) || entityTypeLabel(type),
        subtitle:
            row?.authorName ||
            row?.author_name ||
            row?.ownerDisplayName ||
            row?.groupName ||
            source,
        imageUrl: resolveImageUrl(row),
        seedData: row || null
    };
}

function buildEntityResults(rows, type, source) {
    return (Array.isArray(rows) ? rows : [])
        .map((row) => buildEntityResult(row, type, source))
        .filter(Boolean);
}

function resolveGroupInstanceId(instance) {
    const nestedId = normalize(instance?.group?.groupId || instance?.group?.id);
    if (nestedId) {
        return nestedId;
    }
    const groupId = normalize(instance?.groupId);
    if (groupId) {
        return groupId;
    }
    const ownerId = normalize(instance?.ownerId);
    if (ownerId.startsWith('grp_')) {
        return ownerId;
    }
    const id = normalize(instance?.id);
    return id.startsWith('grp_') ? id : '';
}

function buildGroupInstanceResults(groupInstances) {
    const groupsById = new Map();
    for (const group of groupInstances || []) {
        const groupId = resolveGroupInstanceId(group);
        if (!groupId || groupsById.has(groupId)) {
            continue;
        }
        const row = {
            id: groupId,
            type: 'group',
            source: 'instances',
            name:
                group?.group?.name || group.groupName || group.name || 'Group',
            subtitle: group.worldName || 'instances',
            imageUrl: convertFileUrlToImageUrl(
                group?.group?.iconUrl || group.iconUrl
            ),
            seedData: group?.group || group
        };
        groupsById.set(groupId, row);
    }
    return Array.from(groupsById.values());
}

function settledRows(result) {
    return result.status === 'fulfilled' && Array.isArray(result.value)
        ? result.value
        : [];
}

async function loadCatalog({ currentUserId, endpoint }) {
    const [ownAvatars, ownWorlds, favoriteAvatars, favoriteWorlds, groups] =
        await Promise.allSettled([
            myAvatarRepository.getMyAvatars({ endpoint }),
            worldProfileRepository.getAllWorldsByUser({
                userId: currentUserId,
                endpoint
            }),
            vrchatFavoriteRepository.getAllFavoriteAvatars({ endpoint }),
            vrchatFavoriteRepository.getAllFavoriteWorlds({ endpoint }),
            groupProfileRepository.getUserGroups({
                userId: currentUserId,
                endpoint
            })
        ]);

    const rejectedCount = [
        ownAvatars,
        ownWorlds,
        favoriteAvatars,
        favoriteWorlds,
        groups
    ].filter((result) => result.status === 'rejected').length;

    return {
        ...createEmptyCatalog(
            'ready',
            rejectedCount
                ? `${rejectedCount} search source(s) failed to load.`
                : ''
        ),
        ownAvatars: settledRows(ownAvatars),
        ownWorlds: settledRows(ownWorlds),
        favoriteAvatars: settledRows(favoriteAvatars),
        favoriteWorlds: settledRows(favoriteWorlds),
        groups: settledRows(groups)
    };
}

export function QuickSearchDialog({ open, onOpenChange }) {
    const { t } = useTranslation();
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const remoteFavoritesByObjectId = useFavoriteStore(
        (state) => state.remoteFavoritesByObjectId
    );
    const localWorldDetailsById = useFavoriteStore(
        (state) => state.localWorldDetailsById
    );
    const localAvatarDetailsById = useFavoriteStore(
        (state) => state.localAvatarDetailsById
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const groupInstancesState = useRuntimeStore(
        (state) => state.groupInstances
    );
    const groupInstances =
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.instances
            : [];
    const [query, setQuery] = useState('');
    const [catalog, setCatalog] = useState(() => createEmptyCatalog());
    const normalizedQuery = query.trim().toLowerCase();

    useEffect(() => {
        if (!open || !currentUserId) {
            return;
        }

        let active = true;
        setCatalog(createEmptyCatalog('running'));
        loadCatalog({ currentUserId, endpoint: currentEndpoint })
            .then((nextCatalog) => {
                if (active) {
                    setCatalog(nextCatalog);
                }
            })
            .catch((error) => {
                if (active) {
                    setCatalog(
                        createEmptyCatalog(
                            'error',
                            error instanceof Error
                                ? error.message
                                : 'Search index failed to load.'
                        )
                    );
                }
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, currentUserId, open]);

    const results = useMemo(() => {
        if (normalizedQuery.length < 2) {
            return {
                friends: [],
                ownAvatars: [],
                favoriteAvatars: [],
                ownWorlds: [],
                favoriteWorlds: [],
                ownGroups: [],
                joinedGroups: []
            };
        }

        const friends = Object.values(friendsById || {}).map((friend) => ({
            id: friend.id,
            type: 'friend',
            source: 'friends',
            name: friend.displayName || friend.username || 'User',
            subtitle: friend.statusDescription || '',
            memo: friend.memo || friend.$nickName,
            note: friend.note,
            imageUrl: userImage(friend, true, '64')
        }));

        const remoteFavorites = Object.values(remoteFavoritesByObjectId || []);
        const localAvatars = Object.values(localAvatarDetailsById || []);
        const localWorlds = Object.values(localWorldDetailsById || []);
        const ownAvatars = buildEntityResults(
            catalog.ownAvatars,
            'avatar',
            'own'
        );
        const ownWorlds = buildEntityResults(catalog.ownWorlds, 'world', 'own');
        const ownAvatarIds = new Set(ownAvatars.map((row) => row.id));
        const ownWorldIds = new Set(ownWorlds.map((row) => row.id));

        const favoriteAvatars = dedupeResults(
            [
                ...buildEntityResults(
                    catalog.favoriteAvatars,
                    'avatar',
                    'favorite'
                ),
                ...remoteFavorites
                    .filter((row) => row?.type === 'avatar')
                    .map((row) => buildEntityResult(row, 'avatar', 'favorite')),
                ...localAvatars.map((row) =>
                    buildEntityResult(row, 'avatar', 'local')
                )
            ].filter(Boolean),
            ownAvatarIds
        );

        const favoriteWorlds = dedupeResults(
            [
                ...buildEntityResults(
                    catalog.favoriteWorlds,
                    'world',
                    'favorite'
                ),
                ...remoteFavorites
                    .filter(
                        (row) =>
                            row?.type === 'world' ||
                            row?.type === 'vrcPlusWorld'
                    )
                    .map((row) => buildEntityResult(row, 'world', 'favorite')),
                ...localWorlds.map((row) =>
                    buildEntityResult(row, 'world', 'local')
                )
            ].filter(Boolean),
            ownWorldIds
        );

        const groupResults = buildEntityResults(
            catalog.groups,
            'group',
            'joined'
        );
        const ownGroupRows = groupResults.filter(
            (row) =>
                normalize(row.seedData?.ownerId) === normalize(currentUserId)
        );
        const ownGroupIds = new Set(ownGroupRows.map((row) => row.id));
        const joinedGroupRows = dedupeResults(
            [
                ...groupResults.filter((row) => !ownGroupIds.has(row.id)),
                ...buildGroupInstanceResults(groupInstances)
            ],
            ownGroupIds
        );

        return {
            friends: filterResults(friends, normalizedQuery),
            ownAvatars: filterResults(
                dedupeResults(ownAvatars),
                normalizedQuery
            ),
            favoriteAvatars: filterResults(favoriteAvatars, normalizedQuery),
            ownWorlds: filterResults(dedupeResults(ownWorlds), normalizedQuery),
            favoriteWorlds: filterResults(favoriteWorlds, normalizedQuery),
            ownGroups: filterResults(
                dedupeResults(ownGroupRows),
                normalizedQuery
            ),
            joinedGroups: filterResults(joinedGroupRows, normalizedQuery)
        };
    }, [
        catalog.favoriteAvatars,
        catalog.favoriteWorlds,
        catalog.groups,
        catalog.ownAvatars,
        catalog.ownWorlds,
        currentUserId,
        friendsById,
        groupInstances,
        localAvatarDetailsById,
        localWorldDetailsById,
        normalizedQuery,
        remoteFavoritesByObjectId
    ]);

    const hasResults =
        results.friends.length ||
        results.ownAvatars.length ||
        results.favoriteAvatars.length ||
        results.ownWorlds.length ||
        results.favoriteWorlds.length ||
        results.ownGroups.length ||
        results.joinedGroups.length;

    function selectResult(item) {
        onOpenChange(false);
        setQuery('');
        if (item.type === 'friend') {
            openUserDialog({ userId: item.id, title: item.name });
        } else if (item.type === 'avatar') {
            openAvatarDialog({
                avatarId: item.id,
                title: item.name,
                seedData: item.seedData || null
            });
        } else if (item.type === 'world') {
            openWorldDialog({
                worldId: item.id,
                title: item.name,
                seedData: item.seedData || null
            });
        } else if (item.type === 'group') {
            openGroupDialog({
                groupId: item.id,
                title: item.name,
                seedData: item.seedData || null
            });
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                onOpenChange(nextOpen);
                if (!nextOpen) {
                    setQuery('');
                }
            }}
        >
            <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
                <DialogHeader className="sr-only">
                    <DialogTitle>
                        {t('side_panel.search_placeholder')}
                    </DialogTitle>
                </DialogHeader>
                <div className="border-b p-3">
                    <InputGroup className="border-0 shadow-none">
                        <InputGroupAddon>
                            <SearchIcon />
                        </InputGroupAddon>
                        <InputGroupInput
                            autoFocus
                            value={query}
                            placeholder={t('side_panel.search_placeholder')}
                            onChange={(event) => setQuery(event.target.value)}
                        />
                    </InputGroup>
                </div>
                <div className="max-h-[min(420px,55vh)] overflow-x-hidden overflow-y-auto p-2">
                    {normalizedQuery.length < 2 ? (
                        <div className="text-muted-foreground flex flex-col gap-2 p-2 text-sm">
                            <div className="text-foreground font-medium">
                                {t('side_panel.search_categories')}
                            </div>
                            <div>
                                {t('side_panel.search_friends')} -{' '}
                                {t('side_panel.search_scope_all')}
                            </div>
                            <div>
                                {t('side_panel.search_avatars')} -{' '}
                                {t('side_panel.search_scope_avatars')}
                            </div>
                            <div>
                                {t('side_panel.search_worlds')} -{' '}
                                {t('side_panel.search_scope_worlds')}
                            </div>
                            <div>
                                {t('side_panel.search_groups')} -{' '}
                                {t('side_panel.search_scope_joined')}
                            </div>
                        </div>
                    ) : hasResults ? (
                        <>
                            <ResultGroup
                                title={t('side_panel.friends')}
                                items={results.friends}
                                onSelect={selectResult}
                            />
                            <ResultGroup
                                title={t('side_panel.search_own_avatars')}
                                items={results.ownAvatars}
                                onSelect={selectResult}
                            />
                            <ResultGroup
                                title={t('side_panel.search_fav_avatars')}
                                items={results.favoriteAvatars}
                                onSelect={selectResult}
                            />
                            <ResultGroup
                                title={t('side_panel.search_own_worlds')}
                                items={results.ownWorlds}
                                onSelect={selectResult}
                            />
                            <ResultGroup
                                title={t('side_panel.search_fav_worlds')}
                                items={results.favoriteWorlds}
                                onSelect={selectResult}
                            />
                            <ResultGroup
                                title={t('side_panel.search_own_groups')}
                                items={results.ownGroups}
                                onSelect={selectResult}
                            />
                            <ResultGroup
                                title={t('side_panel.search_joined_groups')}
                                items={results.joinedGroups}
                                onSelect={selectResult}
                            />
                        </>
                    ) : (
                        <div className="text-muted-foreground py-8 text-center text-sm">
                            {t('side_panel.search_no_results')}
                        </div>
                    )}
                    {catalog.status === 'error' && catalog.detail ? (
                        <div className="text-destructive px-2 pb-2 text-xs">
                            {catalog.detail}
                        </div>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
}
