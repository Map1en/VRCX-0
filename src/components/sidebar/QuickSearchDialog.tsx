import {
    CompassIcon,
    GlobeIcon,
    PersonStandingIcon,
    UsersIcon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useKnownUserFacts } from '@/lib/useKnownUser';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService';
import {
    convertFileUrlToImageUrl,
    userImage
} from '@/services/entityMediaService';
import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandShortcut
} from '@/ui/shadcn/command';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';

import {
    buildUserTextMap,
    createEmptyCatalog,
    loadQuickSearchCatalog,
    type QuickSearchCatalog,
    type QuickSearchEntityType,
    type QuickSearchResult
} from './quickSearchCatalog';
import {
    NavResultGroup,
    useNavCommands,
    type QuickSearchNavCommand
} from './QuickSearchNavCommands';
import { entityTypeLabel, ResultGroup } from './QuickSearchResults';

const RESULT_LIMIT = 8;
const USER_QUERY_MIN_LENGTH = 1;
const DETAIL_QUERY_MIN_LENGTH = 2;

type QuickSearchResults = {
    friends: QuickSearchResult[];
    ownAvatars: QuickSearchResult[];
    favoriteAvatars: QuickSearchResult[];
    ownWorlds: QuickSearchResult[];
    favoriteWorlds: QuickSearchResult[];
    ownGroups: QuickSearchResult[];
    joinedGroups: QuickSearchResult[];
};

type QuickSearchRecord = Record<string, unknown> & {
    $memo?: unknown;
    $nickName?: unknown;
    $userColour?: unknown;
    authorName?: unknown;
    author_name?: unknown;
    bannerUrl?: unknown;
    displayName?: unknown;
    favoriteId?: unknown;
    group?: unknown;
    groupId?: unknown;
    groupName?: unknown;
    iconUrl?: unknown;
    id?: unknown;
    imageUrl?: unknown;
    image_url?: unknown;
    memo?: unknown;
    name?: unknown;
    note?: unknown;
    objectId?: unknown;
    ownerDisplayName?: unknown;
    ownerId?: unknown;
    seedData?: unknown;
    statusDescription?: unknown;
    thumbnailImageUrl?: unknown;
    thumbnail_image_url?: unknown;
    type?: unknown;
    username?: unknown;
    worldName?: unknown;
};

function recordValue(value: unknown): QuickSearchRecord | null {
    return value && typeof value === 'object'
        ? (value as QuickSearchRecord)
        : null;
}

function normalize(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeQuery(value: unknown) {
    return normalize(value).toLowerCase();
}

function matchesEntityName(row: QuickSearchResult, query: string) {
    return normalizeQuery(row.name).includes(query);
}

function matchesFriend(row: QuickSearchResult, query: string) {
    if (matchesEntityName(row, query)) {
        return true;
    }
    if (query.length < DETAIL_QUERY_MIN_LENGTH) {
        return false;
    }
    return (
        normalizeQuery(row.memo).includes(query) ||
        normalizeQuery(row.note).includes(query)
    );
}

function matchedField(
    row: Pick<QuickSearchResult, 'name' | 'memo' | 'note'>,
    query: string
): QuickSearchResult['matchedField'] {
    if (!query) {
        return 'name';
    }
    if (normalizeQuery(row.name).includes(query)) {
        return 'name';
    }
    if (query.length < DETAIL_QUERY_MIN_LENGTH) {
        return 'name';
    }
    if (normalizeQuery(row.memo).includes(query)) {
        return 'memo';
    }
    if (normalizeQuery(row.note).includes(query)) {
        return 'note';
    }
    return 'name';
}

function filterResults(
    rows: readonly QuickSearchResult[],
    query: string,
    matcher: (
        row: QuickSearchResult,
        query: string
    ) => boolean = matchesEntityName,
    limit = RESULT_LIMIT
) {
    return rows
        .filter((row) => matcher(row, query))
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

function dedupeResults(
    rows: readonly (QuickSearchResult | null | undefined)[],
    excludeIds: ReadonlySet<string> = new Set()
) {
    const rowsById = new Map<string, QuickSearchResult>();
    for (const row of rows) {
        const id = normalize(row?.id);
        if (!row || !id || excludeIds.has(id) || rowsById.has(id)) {
            continue;
        }
        rowsById.set(id, row);
    }
    return Array.from(rowsById.values());
}

function favoriteName(row: QuickSearchRecord | null) {
    return row?.name || row?.displayName || '';
}

function resolveImageUrl(row: QuickSearchRecord | null) {
    return convertFileUrlToImageUrl(
        normalize(
            row?.thumbnailImageUrl ||
                row?.thumbnail_image_url ||
                row?.imageUrl ||
                row?.image_url ||
                row?.iconUrl ||
                row?.bannerUrl
        )
    );
}

function buildEntityResult(
    value: unknown,
    type: QuickSearchEntityType,
    source: string
): QuickSearchResult | null {
    const row = recordValue(value);
    const id = normalize(row?.favoriteId || row?.objectId || row?.id);
    if (!id) {
        return null;
    }
    return {
        id,
        type,
        source,
        name: normalize(favoriteName(row)) || entityTypeLabel(type),
        subtitle: normalize(
            row?.authorName ||
                row?.author_name ||
                row?.ownerDisplayName ||
                row?.groupName ||
                source
        ),
        imageUrl: resolveImageUrl(row),
        seedData: row || null
    };
}

function buildEntityResults(
    rows: unknown,
    type: QuickSearchEntityType,
    source: string
) {
    return (Array.isArray(rows) ? rows : [])
        .map((row) => buildEntityResult(row, type, source))
        .filter((row): row is QuickSearchResult => Boolean(row));
}

function resolveGroupInstanceId(value: unknown) {
    const instance = recordValue(value);
    const group = recordValue(instance?.group);
    const nestedId = normalize(group?.groupId || group?.id);
    if (nestedId) {
        return nestedId;
    }
    const groupId = normalize(instance?.groupId);
    if (groupId) {
        return groupId;
    }
    const ownerId = normalize(instance?.ownerId);
    if (hasGroupIdPrefix(ownerId)) {
        return ownerId;
    }
    const id = normalize(instance?.id);
    return hasGroupIdPrefix(id) ? id : '';
}

function buildGroupInstanceResults(groupInstances: unknown) {
    const groupsById = new Map<string, QuickSearchResult>();
    for (const value of Array.isArray(groupInstances) ? groupInstances : []) {
        const group = recordValue(value);
        const groupRecord = recordValue(group?.group);
        const groupId = resolveGroupInstanceId(group);
        if (!groupId || groupsById.has(groupId)) {
            continue;
        }
        const row: QuickSearchResult = {
            id: groupId,
            type: 'group',
            source: 'instances',
            name:
                normalize(
                    groupRecord?.name || group?.groupName || group?.name
                ) || 'Group',
            subtitle: normalize(group?.worldName) || 'instances',
            imageUrl: convertFileUrlToImageUrl(
                normalize(groupRecord?.iconUrl || group?.iconUrl)
            ),
            seedData: groupRecord || group
        };
        groupsById.set(groupId, row);
    }
    return Array.from(groupsById.values());
}

function useQuickSearchCatalogState({
    currentEndpoint,
    currentUserId,
    open
}: {
    currentEndpoint?: string | null;
    currentUserId?: string | null;
    open: boolean;
}) {
    const [catalog, setCatalog] = useState(() => createEmptyCatalog());

    useEffect(() => {
        if (!open || !currentUserId) {
            return;
        }

        let active = true;
        setCatalog(createEmptyCatalog('running'));
        loadQuickSearchCatalog({
            currentUserId,
            endpoint: currentEndpoint
        })
            .then((nextCatalog) => {
                if (active) {
                    setCatalog(nextCatalog);
                }
            })
            .catch((error: unknown) => {
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

    return catalog;
}

function createEmptyResults(): QuickSearchResults {
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

function useQuickSearchResults({
    catalog,
    normalizedQuery
}: {
    catalog: QuickSearchCatalog;
    normalizedQuery: string;
}): QuickSearchResults {
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
        groupInstancesState.userId === currentUserId &&
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.instances
            : [];
    const friendIds = useMemo(
        () => Object.keys(friendsById || {}).filter(Boolean),
        [friendsById]
    );
    const knownFriendUsersById = useKnownUserFacts(friendIds, {
        endpoint: currentEndpoint
    });

    return useMemo(() => {
        if (normalizedQuery.length < USER_QUERY_MIN_LENGTH) {
            return createEmptyResults();
        }

        const canSearchDetails =
            normalizedQuery.length >= DETAIL_QUERY_MIN_LENGTH;
        const userMemoById = buildUserTextMap(catalog.userMemos, 'memo');
        const userNoteById = buildUserTextMap(catalog.userNotes, 'note');
        const friends: QuickSearchResult[] = Object.values(friendsById || {})
            .filter(recordValue)
            .map((friend) => {
                const friendId = normalize(friend?.id);
                const knownUser = recordValue(knownFriendUsersById[friendId]);
                const memo =
                    userMemoById.get(friendId) ||
                    friend.memo ||
                    friend.$memo ||
                    friend.$nickName ||
                    knownUser?.memo ||
                    '';
                const note =
                    userNoteById.get(friendId) ||
                    friend.note ||
                    knownUser?.note ||
                    '';
                const profile: QuickSearchRecord = {
                    ...(knownUser || {}),
                    ...friend,
                    displayName: friend.displayName || knownUser?.displayName,
                    username: friend.username || knownUser?.username,
                    memo,
                    note
                };
                const name =
                    normalize(profile.displayName || profile.username) ||
                    'User';
                return {
                    id: normalize(profile.id || friend.id),
                    type: 'friend',
                    source: 'friends',
                    name,
                    subtitle: normalize(profile.statusDescription),
                    memo: normalize(memo),
                    note: normalize(note),
                    matchedField: matchedField(
                        {
                            name,
                            memo: normalize(memo),
                            note: normalize(note)
                        },
                        normalizedQuery
                    ),
                    userColour: normalize(profile.$userColour),
                    imageUrl: userImage(profile, true, '64'),
                    seedData: profile
                };
            });

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
                    .filter((row) => recordValue(row)?.type === 'avatar')
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
                            recordValue(row)?.type === 'world' ||
                            recordValue(row)?.type === 'vrcPlusWorld'
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
            friends: filterResults(friends, normalizedQuery, matchesFriend),
            ownAvatars: canSearchDetails
                ? filterResults(dedupeResults(ownAvatars), normalizedQuery)
                : [],
            favoriteAvatars: canSearchDetails
                ? filterResults(favoriteAvatars, normalizedQuery)
                : [],
            ownWorlds: canSearchDetails
                ? filterResults(dedupeResults(ownWorlds), normalizedQuery)
                : [],
            favoriteWorlds: canSearchDetails
                ? filterResults(favoriteWorlds, normalizedQuery)
                : [],
            ownGroups: canSearchDetails
                ? filterResults(dedupeResults(ownGroupRows), normalizedQuery)
                : [],
            joinedGroups: canSearchDetails
                ? filterResults(joinedGroupRows, normalizedQuery)
                : []
        };
    }, [
        catalog.favoriteAvatars,
        catalog.favoriteWorlds,
        catalog.groups,
        catalog.ownAvatars,
        catalog.ownWorlds,
        catalog.userMemos,
        catalog.userNotes,
        currentUserId,
        friendsById,
        groupInstances,
        knownFriendUsersById,
        localAvatarDetailsById,
        localWorldDetailsById,
        normalizedQuery,
        remoteFavoritesByObjectId
    ]);
}

function useQuickSearchSelectResult({
    onOpenChange,
    setQuery
}: {
    onOpenChange: (open: boolean) => void;
    setQuery: (query: string) => void;
}) {
    return function selectResult(item: QuickSearchResult) {
        onOpenChange(false);
        setQuery('');
        if (item.type === 'friend') {
            openUserDialog({
                userId: item.id,
                title: item.name,
                seedData: item.seedData || null
            });
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
    };
}

export function QuickSearchDialog({
    open,
    onOpenChange
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const normalizedQuery = query.trim().toLowerCase();
    const navCommands = useNavCommands(normalizedQuery);
    const catalog = useQuickSearchCatalogState({
        currentEndpoint,
        currentUserId,
        open
    });
    const results = useQuickSearchResults({
        catalog,
        normalizedQuery
    });

    const hasResults =
        navCommands.length ||
        results.friends.length ||
        results.ownAvatars.length ||
        results.favoriteAvatars.length ||
        results.ownWorlds.length ||
        results.favoriteWorlds.length ||
        results.ownGroups.length ||
        results.joinedGroups.length;

    const selectResult = useQuickSearchSelectResult({ onOpenChange, setQuery });

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
            <DialogContent
                showCloseButton={false}
                className="overflow-hidden p-0 sm:max-w-2xl"
            >
                <DialogHeader className="sr-only">
                    <DialogTitle>
                        {t('side_panel.search_placeholder')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('side_panel.search_placeholder')}
                    </DialogDescription>
                </DialogHeader>
                <Command shouldFilter={false} className="rounded-md! p-0!">
                    <CommandInput
                        autoFocus
                        value={query}
                        aria-label={t('side_panel.search_input_placeholder')}
                        placeholder={t('side_panel.search_input_placeholder')}
                        onValueChange={setQuery}
                    />
                    <CommandList className="max-h-[min(400px,50vh)]">
                        {normalizedQuery.length < USER_QUERY_MIN_LENGTH ? (
                            <CommandGroup
                                heading={t('side_panel.search_categories')}
                            >
                                <CommandItem
                                    value="hint-pages"
                                    disabled
                                    className="gap-3 opacity-70"
                                >
                                    <CompassIcon />
                                    <span className="min-w-0 flex-1 truncate">
                                        {t('side_panel.search_pages')}
                                    </span>
                                    <CommandShortcut className="max-w-[45%] truncate tracking-normal">
                                        {t('side_panel.search_scope_pages')}
                                    </CommandShortcut>
                                </CommandItem>
                                <CommandItem
                                    value="hint-friends"
                                    disabled
                                    className="gap-3 opacity-70"
                                >
                                    <UsersIcon />
                                    <span className="min-w-0 flex-1 truncate">
                                        {t('side_panel.search_friends')}
                                    </span>
                                    <CommandShortcut className="max-w-[45%] truncate tracking-normal">
                                        {t('side_panel.search_scope_all')}
                                    </CommandShortcut>
                                </CommandItem>
                                <CommandItem
                                    value="hint-avatars"
                                    disabled
                                    className="gap-3 opacity-70"
                                >
                                    <PersonStandingIcon />
                                    <span className="min-w-0 flex-1 truncate">
                                        {t('side_panel.search_avatars')}
                                    </span>
                                    <CommandShortcut className="max-w-[45%] truncate tracking-normal">
                                        {t('side_panel.search_scope_avatars')}
                                    </CommandShortcut>
                                </CommandItem>
                                <CommandItem
                                    value="hint-worlds"
                                    disabled
                                    className="gap-3 opacity-70"
                                >
                                    <GlobeIcon />
                                    <span className="min-w-0 flex-1 truncate">
                                        {t('side_panel.search_worlds')}
                                    </span>
                                    <CommandShortcut className="max-w-[45%] truncate tracking-normal">
                                        {t('side_panel.search_scope_worlds')}
                                    </CommandShortcut>
                                </CommandItem>
                                <CommandItem
                                    value="hint-groups"
                                    disabled
                                    className="gap-3 opacity-70"
                                >
                                    <UsersIcon />
                                    <span className="min-w-0 flex-1 truncate">
                                        {t('side_panel.search_groups')}
                                    </span>
                                    <CommandShortcut className="max-w-[45%] truncate tracking-normal">
                                        {t('side_panel.search_scope_joined')}
                                    </CommandShortcut>
                                </CommandItem>
                            </CommandGroup>
                        ) : hasResults ? (
                            <>
                                <NavResultGroup
                                    title={t('side_panel.search_pages')}
                                    items={navCommands}
                                    onSelect={(item: QuickSearchNavCommand) => {
                                        onOpenChange(false);
                                        setQuery('');
                                        navigate(item.path);
                                    }}
                                />
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
                            <CommandEmpty>
                                {t('side_panel.search_no_results')}
                            </CommandEmpty>
                        )}
                        {catalog.status === 'error' && catalog.detail ? (
                            <div className="text-destructive px-2 pb-2 text-xs">
                                {catalog.detail}
                            </div>
                        ) : null}
                    </CommandList>
                </Command>
            </DialogContent>
        </Dialog>
    );
}
