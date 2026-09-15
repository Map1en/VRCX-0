import type { GroupInstanceRecord } from '@/domain/entities/group';
import removeConfusables from '@/services/confusables';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';

import type { QuickSearchResult, QuickSearchState } from '../quickSearch';

const RESULT_LIMIT = 8;
export const USER_QUERY_MIN_LENGTH = 1;
const DETAIL_QUERY_MIN_LENGTH = 2;

export function normalizeSearchValue(value: string | null | undefined) {
    return (value ?? '').trim();
}

export function normalizeSearchQuery(value: string | null | undefined) {
    return removeConfusables(normalizeSearchValue(value)).toLocaleLowerCase();
}

export function filterQuickSearchResults(
    rows: readonly QuickSearchResult[],
    query: string,
    limit = RESULT_LIMIT
) {
    return rows
        .filter((row) => normalizeSearchQuery(row.name).includes(query))
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
                { sensitivity: 'base' }
            );
        })
        .slice(0, limit);
}

function resolveGroupInstanceId(instance: GroupInstanceRecord) {
    const group = instance.group;
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

function buildGroupInstanceResults(
    groupInstances: readonly GroupInstanceRecord[]
) {
    const groupsById = new Map<string, QuickSearchResult>();
    for (const instance of groupInstances) {
        const group = instance.group;
        const groupId = resolveGroupInstanceId(instance);
        if (!groupId || groupsById.has(groupId)) {
            continue;
        }
        groupsById.set(groupId, {
            id: groupId,
            type: 'group',
            source: 'instances',
            name:
                normalizeSearchValue(
                    group?.name || instance?.groupName || instance?.name
                ) || 'Group',
            subtitle: normalizeSearchValue(instance?.worldName) || 'instances',
            imageUrl: convertFileUrlToImageUrl(
                normalizeSearchValue(group?.iconUrl || instance?.iconUrl)
            ),
            seedData: group || instance,
            memo: '',
            note: '',
            matchedField: 'name',
            userColour: ''
        });
    }
    return Array.from(groupsById.values());
}

export function mergeQuickSearchGroupInstances(
    state: QuickSearchState,
    normalizedQuery: string,
    groupInstances: readonly GroupInstanceRecord[]
): QuickSearchState {
    if (normalizedQuery.length < DETAIL_QUERY_MIN_LENGTH) {
        return state;
    }
    const excludedIds = new Set(state.ownGroups.map((row) => row.id));
    const joinedById = new Map(
        state.joinedGroups.map((row) => [row.id, row] as const)
    );
    for (const row of buildGroupInstanceResults(groupInstances)) {
        if (!excludedIds.has(row.id) && !joinedById.has(row.id)) {
            joinedById.set(row.id, row);
        }
    }
    return {
        ...state,
        joinedGroups: filterQuickSearchResults(
            Array.from(joinedById.values()),
            normalizedQuery
        )
    };
}
