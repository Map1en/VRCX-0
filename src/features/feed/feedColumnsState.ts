import {
    FEED_FILTER_TYPES,
    type FeedFilterType
} from '@/repositories/feedRepository';
import { normalizeString } from '@/shared/utils/string';

export type FeedViewMode = 'table' | 'columns';

export type FeedColumnFavoriteGroupSelection = 'all' | string[];

export type FeedColumnFriendScope =
    | {
          kind: 'all';
          excludedFavoriteGroupKeys?: FeedColumnFavoriteGroupSelection;
      }
    | {
          kind: 'favorites';
          groupKeys: FeedColumnFavoriteGroupSelection;
          excludedFavoriteGroupKeys?: FeedColumnFavoriteGroupSelection;
      };

export type FeedColumnConfig = {
    id: string;
    title: string;
    width: number;
    friendScope: FeedColumnFriendScope;
    feedTypes: FeedFilterType[];
};

const MIN_COLUMN_WIDTH = 280;
const MAX_COLUMN_WIDTH = 420;
const DEFAULT_COLUMN_WIDTH = 320;

const ALL_FEED_TYPES = [...FEED_FILTER_TYPES];
const FAVORITE_EXCLUDED_PRESET_IDS = new Set([
    'location',
    'profile',
    'presence'
]);

export const FEED_COLUMNS_DEFAULT_CONFIG: FeedColumnConfig[] = [
    {
        id: 'fav',
        title: 'Favorites',
        width: DEFAULT_COLUMN_WIDTH,
        friendScope: { kind: 'favorites', groupKeys: 'all' },
        feedTypes: ALL_FEED_TYPES
    },
    {
        id: 'location',
        title: 'Location',
        width: DEFAULT_COLUMN_WIDTH,
        friendScope: { kind: 'all', excludedFavoriteGroupKeys: 'all' },
        feedTypes: ['GPS']
    },
    {
        id: 'profile',
        title: 'Profile',
        width: DEFAULT_COLUMN_WIDTH,
        friendScope: { kind: 'all', excludedFavoriteGroupKeys: 'all' },
        feedTypes: ['Status', 'Avatar', 'Bio']
    },
    {
        id: 'presence',
        title: 'Presence',
        width: DEFAULT_COLUMN_WIDTH,
        friendScope: { kind: 'all', excludedFavoriteGroupKeys: 'all' },
        feedTypes: ['Online', 'Offline']
    }
];

function createColumnId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `col_${crypto.randomUUID()}`;
    }
    return `col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function sanitizeWidth(value: unknown): number {
    const width = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(width)) {
        return DEFAULT_COLUMN_WIDTH;
    }
    return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width));
}

function sanitizeFeedTypes(value: unknown): FeedFilterType[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((type, index, source): type is FeedFilterType => {
        if (typeof type !== 'string') {
            return false;
        }
        if (!FEED_FILTER_TYPES.includes(type as FeedFilterType)) {
            return false;
        }
        return source.indexOf(type) === index;
    });
}

function feedTypesEqual(left: FeedFilterType[], right: FeedFilterType[]) {
    return (
        left.length === right.length &&
        left.every((type, index) => type === right[index])
    );
}

function sanitizeFavoriteGroupSelection(
    value: unknown
): FeedColumnFavoriteGroupSelection | undefined {
    if (value === 'all') {
        return 'all';
    }
    if (!Array.isArray(value)) {
        return undefined;
    }
    const groupKeys = Array.from(
        new Set(value.map(normalizeString).filter(Boolean))
    );
    return groupKeys.length ? groupKeys : undefined;
}

function applyExcludedFavoriteGroups<T extends FeedColumnFriendScope>(
    scope: T,
    excludedFavoriteGroupKeys: FeedColumnFavoriteGroupSelection | undefined
): T {
    if (!excludedFavoriteGroupKeys) {
        return scope;
    }
    return {
        ...scope,
        excludedFavoriteGroupKeys
    };
}

function sanitizeFriendScope(value: unknown): FeedColumnFriendScope {
    if (!value || typeof value !== 'object') {
        return { kind: 'all' };
    }
    const scope = value as Record<string, unknown>;
    const excludedFavoriteGroupKeys = sanitizeFavoriteGroupSelection(
        scope.excludedFavoriteGroupKeys
    );
    if (scope.kind !== 'favorites') {
        return applyExcludedFavoriteGroups(
            { kind: 'all' },
            excludedFavoriteGroupKeys
        );
    }
    if (scope.groupKeys === 'all') {
        return applyExcludedFavoriteGroups(
            { kind: 'favorites', groupKeys: 'all' },
            excludedFavoriteGroupKeys
        );
    }
    if (!Array.isArray(scope.groupKeys)) {
        return applyExcludedFavoriteGroups(
            { kind: 'favorites', groupKeys: 'all' },
            excludedFavoriteGroupKeys
        );
    }
    const groupKeys = Array.from(
        new Set(scope.groupKeys.map(normalizeString).filter(Boolean))
    );
    return {
        kind: 'favorites',
        groupKeys,
        ...(excludedFavoriteGroupKeys ? { excludedFavoriteGroupKeys } : {})
    };
}

export function sanitizeFeedViewMode(value: unknown): FeedViewMode {
    return value === 'columns' ? 'columns' : 'table';
}

export function sanitizeFeedColumnConfig(
    value: unknown
): FeedColumnConfig | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const column = value as Record<string, unknown>;
    const feedTypes = sanitizeFeedTypes(column.feedTypes);
    if (!feedTypes.length) {
        return null;
    }
    const id = normalizeString(column.id) || createColumnId();
    const title = normalizeString(column.title);
    if (!title) {
        return null;
    }
    return applyPresetScopeDefaults({
        id,
        title: id === 'fav' && title === 'Fav' ? 'Favorites' : title,
        width: sanitizeWidth(column.width),
        friendScope: sanitizeFriendScope(column.friendScope),
        feedTypes
    });
}

function applyPresetScopeDefaults(column: FeedColumnConfig): FeedColumnConfig {
    if (
        !FAVORITE_EXCLUDED_PRESET_IDS.has(column.id) ||
        column.friendScope.kind !== 'all' ||
        column.friendScope.excludedFavoriteGroupKeys
    ) {
        return column;
    }

    const preset = FEED_COLUMNS_DEFAULT_CONFIG.find(
        (defaultColumn) => defaultColumn.id === column.id
    );
    if (!preset || !feedTypesEqual(column.feedTypes, preset.feedTypes)) {
        return column;
    }

    return {
        ...column,
        friendScope: copyFeedColumnFriendScope(preset.friendScope)
    };
}

export function sanitizeFeedColumnsConfig(value: unknown): FeedColumnConfig[] {
    const columns = (Array.isArray(value) ? value : [])
        .map(sanitizeFeedColumnConfig)
        .filter(Boolean) as FeedColumnConfig[];
    return columns.length ? columns : createFeedColumnsPresetConfig();
}

export function createFeedColumnsPresetConfig(): FeedColumnConfig[] {
    return FEED_COLUMNS_DEFAULT_CONFIG.map((column) => ({
        ...column,
        feedTypes: [...column.feedTypes],
        friendScope: copyFeedColumnFriendScope(column.friendScope)
    }));
}

function copyFavoriteGroupSelection(
    selection: FeedColumnFavoriteGroupSelection | undefined
) {
    return Array.isArray(selection) ? [...selection] : selection;
}

export function copyFeedColumnExclusion(
    sourceScope: FeedColumnFriendScope,
    targetScope: FeedColumnFriendScope
): FeedColumnFriendScope {
    const excludedFavoriteGroupKeys = copyFavoriteGroupSelection(
        sourceScope.excludedFavoriteGroupKeys
    );
    return excludedFavoriteGroupKeys
        ? {
              ...targetScope,
              excludedFavoriteGroupKeys
          }
        : targetScope;
}

function copyFeedColumnFriendScope(
    scope: FeedColumnFriendScope
): FeedColumnFriendScope {
    if (scope.kind === 'favorites') {
        return {
            kind: 'favorites',
            groupKeys: copyFavoriteGroupSelection(scope.groupKeys) || 'all',
            ...(scope.excludedFavoriteGroupKeys
                ? {
                      excludedFavoriteGroupKeys: copyFavoriteGroupSelection(
                          scope.excludedFavoriteGroupKeys
                      )
                  }
                : {})
        };
    }
    return {
        kind: 'all',
        ...(scope.excludedFavoriteGroupKeys
            ? {
                  excludedFavoriteGroupKeys: copyFavoriteGroupSelection(
                      scope.excludedFavoriteGroupKeys
                  )
              }
            : {})
    };
}

export function createFeedColumnConfig(
    patch: Partial<FeedColumnConfig> = {}
): FeedColumnConfig {
    return {
        id: patch.id || createColumnId(),
        title: patch.title || 'New Column',
        width: sanitizeWidth(patch.width),
        friendScope: patch.friendScope || { kind: 'all' },
        feedTypes: sanitizeFeedTypes(patch.feedTypes).length
            ? sanitizeFeedTypes(patch.feedTypes)
            : ALL_FEED_TYPES
    };
}
