import {
    convertFileUrlToImageUrl,
    userImage
} from '@/services/entityMediaService';
import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';

import {
    buildUserTextMap,
    type QuickSearchCatalog,
    type QuickSearchEntityType,
    type QuickSearchResult
} from '../quickSearchCatalog';
import { entityTypeLabel } from '../QuickSearchResults';

const RESULT_LIMIT = 8;
export const USER_QUERY_MIN_LENGTH = 1;
const DETAIL_QUERY_MIN_LENGTH = 2;

export type QuickSearchResults = {
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
    statusDescription?: unknown;
    thumbnailImageUrl?: unknown;
    thumbnail_image_url?: unknown;
    type?: unknown;
    username?: unknown;
    worldName?: unknown;
};

type BuildQuickSearchResultsInput = {
    catalog: QuickSearchCatalog;
    normalizedQuery: string;
    currentUserId?: string | null;
    friendsById: unknown;
    knownFriendUsersById: unknown;
    remoteFavoritesByObjectId: unknown;
    localWorldDetailsById: unknown;
    localAvatarDetailsById: unknown;
    groupInstances: unknown;
};

function recordValue(value: unknown): QuickSearchRecord | null {
    return value && typeof value === 'object'
        ? (value as QuickSearchRecord)
        : null;
}

function recordValues(value: unknown): unknown[] {
    const record = recordValue(value);
    return record ? Object.values(record) : [];
}

export function normalizeSearchValue(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function normalizeSearchQuery(value: unknown) {
    return normalizeSearchValue(value).toLowerCase();
}

export function matchesEntityName(row: QuickSearchResult, query: string) {
    return normalizeSearchQuery(row.name).includes(query);
}

export function matchesFriend(row: QuickSearchResult, query: string) {
    if (matchesEntityName(row, query)) {
        return true;
    }
    if (query.length < DETAIL_QUERY_MIN_LENGTH) {
        return false;
    }
    return (
        normalizeSearchQuery(row.memo).includes(query) ||
        normalizeSearchQuery(row.note).includes(query)
    );
}

export function matchedField(
    row: Pick<QuickSearchResult, 'name' | 'memo' | 'note'>,
    query: string
): QuickSearchResult['matchedField'] {
    if (!query) {
        return 'name';
    }
    if (normalizeSearchQuery(row.name).includes(query)) {
        return 'name';
    }
    if (query.length < DETAIL_QUERY_MIN_LENGTH) {
        return 'name';
    }
    if (normalizeSearchQuery(row.memo).includes(query)) {
        return 'memo';
    }
    if (normalizeSearchQuery(row.note).includes(query)) {
        return 'note';
    }
    return 'name';
}

export function filterQuickSearchResults(
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
            const leftPrefix = normalizeSearchQuery(left.name).startsWith(query)
                ? 0
                : 1;
            const rightPrefix = normalizeSearchQuery(right.name).startsWith(
                query
            )
                ? 0
                : 1;
            if (leftPrefix !== rightPrefix) {
                return leftPrefix - rightPrefix;
            }
            return normalizeSearchValue(left.name || left.id).localeCompare(
                normalizeSearchValue(right.name || right.id),
                undefined,
                {
                    sensitivity: 'base'
                }
            );
        })
        .slice(0, limit);
}

export function dedupeQuickSearchResults(
    rows: readonly (QuickSearchResult | null | undefined)[],
    excludeIds: ReadonlySet<string> = new Set()
) {
    const rowsById = new Map<string, QuickSearchResult>();
    for (const row of rows) {
        const id = normalizeSearchValue(row?.id);
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
        normalizeSearchValue(
            row?.thumbnailImageUrl ||
                row?.thumbnail_image_url ||
                row?.imageUrl ||
                row?.image_url ||
                row?.iconUrl ||
                row?.bannerUrl
        )
    );
}

export function buildEntityResult(
    value: unknown,
    type: QuickSearchEntityType,
    source: string
): QuickSearchResult | null {
    const row = recordValue(value);
    const id = normalizeSearchValue(
        row?.favoriteId || row?.objectId || row?.id
    );
    if (!id) {
        return null;
    }
    return {
        id,
        type,
        source,
        name: normalizeSearchValue(favoriteName(row)) || entityTypeLabel(type),
        subtitle: normalizeSearchValue(
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

export function buildEntityResults(
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
    const nestedId = normalizeSearchValue(group?.groupId || group?.id);
    if (nestedId) {
        return nestedId;
    }
    const groupId = normalizeSearchValue(instance?.groupId);
    if (groupId) {
        return groupId;
    }
    const ownerId = normalizeSearchValue(instance?.ownerId);
    if (hasGroupIdPrefix(ownerId)) {
        return ownerId;
    }
    const id = normalizeSearchValue(instance?.id);
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
                normalizeSearchValue(
                    groupRecord?.name || group?.groupName || group?.name
                ) || 'Group',
            subtitle: normalizeSearchValue(group?.worldName) || 'instances',
            imageUrl: convertFileUrlToImageUrl(
                normalizeSearchValue(groupRecord?.iconUrl || group?.iconUrl)
            ),
            seedData: groupRecord || group
        };
        groupsById.set(groupId, row);
    }
    return Array.from(groupsById.values());
}

export function createEmptyQuickSearchResults(): QuickSearchResults {
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

export function buildQuickSearchResults({
    catalog,
    normalizedQuery,
    currentUserId,
    friendsById,
    knownFriendUsersById,
    remoteFavoritesByObjectId,
    localWorldDetailsById,
    localAvatarDetailsById,
    groupInstances
}: BuildQuickSearchResultsInput): QuickSearchResults {
    if (normalizedQuery.length < USER_QUERY_MIN_LENGTH) {
        return createEmptyQuickSearchResults();
    }

    const canSearchDetails = normalizedQuery.length >= DETAIL_QUERY_MIN_LENGTH;
    const userMemoById = buildUserTextMap(catalog.userMemos, 'memo');
    const userNoteById = buildUserTextMap(catalog.userNotes, 'note');
    const knownUsers = recordValue(knownFriendUsersById);
    const friends: QuickSearchResult[] = [];
    for (const value of recordValues(friendsById)) {
        const friend = recordValue(value);
        if (!friend) {
            continue;
        }
        const friendId = normalizeSearchValue(friend.id);
        const knownUser = recordValue(knownUsers?.[friendId]);
        const memo =
            userMemoById.get(friendId) ||
            friend.memo ||
            friend.$memo ||
            friend.$nickName ||
            knownUser?.memo ||
            '';
        const note =
            userNoteById.get(friendId) || friend.note || knownUser?.note || '';
        const profile: QuickSearchRecord = {
            ...(knownUser || {}),
            ...friend,
            displayName: friend.displayName || knownUser?.displayName,
            username: friend.username || knownUser?.username,
            memo,
            note
        };
        const name =
            normalizeSearchValue(profile.displayName || profile.username) ||
            'User';
        friends.push({
            id: normalizeSearchValue(profile.id || friend.id),
            type: 'friend',
            source: 'friends',
            name,
            subtitle: normalizeSearchValue(profile.statusDescription),
            memo: normalizeSearchValue(memo),
            note: normalizeSearchValue(note),
            matchedField: matchedField(
                {
                    name,
                    memo: normalizeSearchValue(memo),
                    note: normalizeSearchValue(note)
                },
                normalizedQuery
            ),
            userColour: normalizeSearchValue(profile.$userColour),
            imageUrl: userImage(profile, true, '64'),
            seedData: profile
        });
    }

    const remoteFavorites = recordValues(remoteFavoritesByObjectId);
    const localAvatars = recordValues(localAvatarDetailsById);
    const localWorlds = recordValues(localWorldDetailsById);
    const ownAvatars = buildEntityResults(catalog.ownAvatars, 'avatar', 'own');
    const ownWorlds = buildEntityResults(catalog.ownWorlds, 'world', 'own');
    const ownAvatarIds = new Set(ownAvatars.map((row) => row.id));
    const ownWorldIds = new Set(ownWorlds.map((row) => row.id));

    const favoriteAvatars = dedupeQuickSearchResults(
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
        ],
        ownAvatarIds
    );

    const favoriteWorlds = dedupeQuickSearchResults(
        [
            ...buildEntityResults(catalog.favoriteWorlds, 'world', 'favorite'),
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
        ],
        ownWorldIds
    );

    const groupResults = buildEntityResults(catalog.groups, 'group', 'joined');
    const ownGroupRows = groupResults.filter(
        (row) =>
            normalizeSearchValue(row.seedData?.ownerId) ===
            normalizeSearchValue(currentUserId)
    );
    const ownGroupIds = new Set(ownGroupRows.map((row) => row.id));
    const joinedGroupRows = dedupeQuickSearchResults(
        [
            ...groupResults.filter((row) => !ownGroupIds.has(row.id)),
            ...buildGroupInstanceResults(groupInstances)
        ],
        ownGroupIds
    );

    return {
        friends: filterQuickSearchResults(
            friends,
            normalizedQuery,
            matchesFriend
        ),
        ownAvatars: canSearchDetails
            ? filterQuickSearchResults(
                  dedupeQuickSearchResults(ownAvatars),
                  normalizedQuery
              )
            : [],
        favoriteAvatars: canSearchDetails
            ? filterQuickSearchResults(favoriteAvatars, normalizedQuery)
            : [],
        ownWorlds: canSearchDetails
            ? filterQuickSearchResults(
                  dedupeQuickSearchResults(ownWorlds),
                  normalizedQuery
              )
            : [],
        favoriteWorlds: canSearchDetails
            ? filterQuickSearchResults(favoriteWorlds, normalizedQuery)
            : [],
        ownGroups: canSearchDetails
            ? filterQuickSearchResults(
                  dedupeQuickSearchResults(ownGroupRows),
                  normalizedQuery
              )
            : [],
        joinedGroups: canSearchDetails
            ? filterQuickSearchResults(joinedGroupRows, normalizedQuery)
            : []
    };
}
