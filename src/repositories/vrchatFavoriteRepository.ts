import {
    commands,
    type HttpApiExecuteResponse,
    type VrchatFavoriteAddInput,
    type VrchatFavoriteDeleteInput,
    type VrchatFavoriteGroupClearInput,
    type VrchatFavoriteGroupSaveInput,
    type VrchatFavoriteGroupsInput,
    type VrchatFavoriteWorldsInput
} from '@/platform/tauri/bindings';

import { collectPages } from './pagination';
import { unwrapVrchatResponse } from './vrchatRequest';

const FAVORITE_GROUPS_PAGE_SIZE = 50;
const FAVORITE_DETAIL_PAGE_SIZE = 300;

type VrchatApiResult = HttpApiExecuteResponse;

type FavoriteGroupSaveInput = Omit<
    VrchatFavoriteGroupSaveInput,
    'displayName' | 'visibility'
> &
    Partial<Pick<VrchatFavoriteGroupSaveInput, 'displayName' | 'visibility'>>;

function unwrapVrchatFavoriteResponse<TJson = unknown>(
    response: VrchatApiResult,
    path: string,
    fallbackMessage: string
) {
    return unwrapVrchatResponse<TJson>(response, path, { fallbackMessage });
}

async function addFavorite({ type, favoriteId, tags }: VrchatFavoriteAddInput) {
    const response = await commands.appVrchatFavoriteAdd({
        type,
        favoriteId,
        tags
    });
    return unwrapVrchatFavoriteResponse(
        response,
        'favorites',
        'VRChat favorite request failed'
    );
}

async function deleteFavorite({ objectId }: VrchatFavoriteDeleteInput = {}) {
    const normalizedObjectId = objectId?.trim() ?? '';
    if (!normalizedObjectId) {
        throw new Error(
            'VrchatFavoriteRepository.deleteFavorite requires an object id.'
        );
    }

    const response = await commands.appVrchatFavoriteDelete({
        objectId: normalizedObjectId
    });
    return unwrapVrchatFavoriteResponse(
        response,
        `favorites/${encodeURIComponent(normalizedObjectId)}`,
        'VRChat favorite request failed'
    );
}

async function getFavoriteWorlds({
    n = FAVORITE_DETAIL_PAGE_SIZE,
    offset = 0,
    ownerId = '',
    userId = '',
    tag = ''
}: VrchatFavoriteWorldsInput = {}) {
    const response = await commands.appVrchatFavoriteWorldsGet({
        n,
        offset,
        ownerId,
        userId,
        tag
    });
    return unwrapVrchatFavoriteResponse(
        response,
        'worlds/favorites',
        'VRChat favorite request failed'
    );
}

async function getAllFavoriteWorlds({
    ownerId = '',
    userId = '',
    tag = ''
}: VrchatFavoriteWorldsInput = {}) {
    return collectPages(
        async ({ n, offset }) => {
            const response = await getFavoriteWorlds({
                n,
                offset,
                ownerId,
                userId,
                tag
            });
            return Array.isArray(response.json) ? response.json : [];
        },
        { pageSize: FAVORITE_DETAIL_PAGE_SIZE }
    );
}

async function getFavoriteGroups({
    n = FAVORITE_GROUPS_PAGE_SIZE,
    offset = 0,
    ownerId = ''
}: VrchatFavoriteGroupsInput = {}) {
    const response = await commands.appVrchatFavoriteGroupsGet({
        n,
        offset,
        ownerId
    });
    return unwrapVrchatFavoriteResponse(
        response,
        'favorite/groups',
        'VRChat favorite request failed'
    );
}

async function getAllFavoriteGroups({
    ownerId = ''
}: { ownerId?: string } = {}) {
    return collectPages(
        async ({ n, offset }) => {
            const response = await getFavoriteGroups({ n, offset, ownerId });
            return Array.isArray(response.json) ? response.json : [];
        },
        { pageSize: FAVORITE_GROUPS_PAGE_SIZE }
    );
}

async function saveFavoriteGroup({
    type,
    group,
    displayName,
    visibility
}: FavoriteGroupSaveInput) {
    const normalizedGroup = group?.trim() ?? '';

    if (!normalizedGroup) {
        throw new Error(
            'VrchatFavoriteRepository.saveFavoriteGroup requires type and group.'
        );
    }

    const response = await commands.appVrchatFavoriteGroupSave({
        type,
        group: normalizedGroup,
        displayName: displayName ?? null,
        visibility: visibility ?? null
    });
    return unwrapVrchatFavoriteResponse(
        response,
        `favorite/group/${encodeURIComponent(type)}/${encodeURIComponent(normalizedGroup)}`,
        'VRChat favorite request failed'
    );
}

async function clearFavoriteGroup({
    type,
    group
}: VrchatFavoriteGroupClearInput) {
    const normalizedGroup = group?.trim() ?? '';

    if (!normalizedGroup) {
        throw new Error(
            'VrchatFavoriteRepository.clearFavoriteGroup requires type and group.'
        );
    }

    const response = await commands.appVrchatFavoriteGroupClear({
        type,
        group: normalizedGroup
    });
    return unwrapVrchatFavoriteResponse(
        response,
        `favorite/group/${encodeURIComponent(type)}/${encodeURIComponent(normalizedGroup)}`,
        'VRChat favorite request failed'
    );
}

const vrchatFavoriteRepository = Object.freeze({
    addFavorite,
    deleteFavorite,
    getAllFavoriteWorlds,
    getAllFavoriteGroups,
    saveFavoriteGroup,
    clearFavoriteGroup
});

export { addFavorite };
export default vrchatFavoriteRepository;
