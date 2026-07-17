import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';
import { commands } from '@/platform/tauri/bindings';

import { VRCHAT_API_DEFAULT_PAGE_SIZE } from '../paginationConstants';
import type { QueryParams } from '../vrchatRequest';
import {
    collectPages,
    type GroupGalleryFileRow,
    type GroupGalleryInput,
    type GroupIdInput,
    type GroupPageInput,
    type GroupPostInput,
    type GroupRecord,
    normalizeEntityId,
    responseRows,
    unwrapVrchatGroupResponse
} from './shared';

export async function getGroupPosts({
    groupId,
    endpoint = '',
    n = VRCHAT_API_DEFAULT_PAGE_SIZE,
    offset = 0
}: GroupPageInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.getGroupPosts requires a group id.'
        );
    }

    const response = unwrapVrchatGroupResponse(
        await commands.appVrchatGroupPostsGet({
            groupId: normalizedGroupId,
            n,
            offset,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/posts`
    );
    return responseRows<GroupRecord>(response.json, 'posts');
}

export async function getAllGroupPosts({
    groupId,
    endpoint = ''
}: GroupIdInput) {
    return collectPages(({ n, offset }) =>
        getGroupPosts({ groupId, endpoint, n, offset })
    );
}

export async function createGroupPost({
    groupId,
    params = {},
    endpoint = ''
}: Pick<GroupPostInput, 'groupId' | 'params' | 'endpoint'>) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.createGroupPost requires a group id.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupPostCreate({
            groupId: normalizedGroupId,
            params,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/posts`
    );
}

export async function editGroupPost({
    groupId,
    postId,
    params = {},
    endpoint = ''
}: GroupPostInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedPostId = normalizeEntityId(postId);
    if (!normalizedGroupId || !normalizedPostId) {
        throw new Error(
            'GroupProfileRepository.editGroupPost requires group and post ids.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupPostEdit({
            groupId: normalizedGroupId,
            postId: normalizedPostId,
            params,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/posts/${encodeURIComponent(normalizedPostId)}`
    );
}

export async function deleteGroupPost({
    groupId,
    postId,
    endpoint = ''
}: GroupPostInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedPostId = normalizeEntityId(postId);
    if (!normalizedGroupId || !normalizedPostId) {
        throw new Error(
            'GroupProfileRepository.deleteGroupPost requires group and post ids.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupPostDelete({
            groupId: normalizedGroupId,
            postId: normalizedPostId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/posts/${encodeURIComponent(normalizedPostId)}`
    );
}

export async function getGroupGallery({
    groupId,
    galleryId,
    endpoint = '',
    n = VRCHAT_API_DEFAULT_PAGE_SIZE,
    offset = 0,
    force = false
}: GroupGalleryInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedGalleryId = normalizeEntityId(galleryId);
    if (!normalizedGroupId || !normalizedGalleryId) {
        throw new Error(
            'GroupProfileRepository.getGroupGallery requires group and gallery ids.'
        );
    }

    const params: QueryParams = { n, offset };
    return fetchCachedData({
        queryKey: queryKeys.groupGallery(
            {
                groupId: normalizedGroupId,
                galleryId: normalizedGalleryId,
                ...params
            },
            endpoint
        ),
        policy: entityQueryPolicies.groupCollection,
        force,
        queryFn: async () => {
            const response = unwrapVrchatGroupResponse(
                await commands.appVrchatGroupGalleryGet({
                    groupId: normalizedGroupId,
                    galleryId: normalizedGalleryId,
                    n,
                    offset,
                    endpoint
                }),
                `groups/${encodeURIComponent(normalizedGroupId)}/galleries/${encodeURIComponent(normalizedGalleryId)}`
            );
            return responseRows<GroupGalleryFileRow>(response.json, 'files');
        }
    });
}

export async function getAllGroupGallery({
    groupId,
    galleryId,
    endpoint = '',
    force = false
}: Omit<GroupGalleryInput, 'n' | 'offset'>) {
    return collectPages(({ n, offset }) =>
        getGroupGallery({ groupId, galleryId, endpoint, n, offset, force })
    );
}
