import type { AvatarProfileRecord } from '@/domain/entities/profileEntities';
import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';
import {
    commands,
    type VrchatAvatarListByUserInput
} from '@/platform/tauri/bindings';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

import avatarCacheRepository from '../avatarCacheRepository';
import memoPersistenceRepository from '../memoPersistenceRepository';
import { VRCHAT_API_DEFAULT_PAGE_SIZE } from '../paginationConstants';
import { normalize, normalizeLocalTags } from './normalization';
import {
    avatarIdInput,
    collectPages,
    normalizeEntityId,
    normalizeString,
    parseInteger,
    unwrapVrchatAvatarResponse
} from './shared';
import type {
    AvatarListOptions,
    AvatarProfileExtras,
    AvatarProfileInput,
    AvatarRecord,
    AvatarStyleRecord,
    AvatarStylesInput
} from './types';

export async function getLocalSnapshot(
    avatarId: unknown,
    currentUserId: unknown = ''
): Promise<AvatarProfileExtras> {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        return {
            cachedAvatar: null,
            localTags: [],
            timeSpent: 0,
            memo: ''
        };
    }

    const [cachedAvatar, localTags, timeSpentEntry, memoEntry] =
        await Promise.all([
            avatarCacheRepository
                .getCachedAvatarById(normalizedAvatarId)
                .catch(
                    (): Awaited<
                        ReturnType<
                            typeof avatarCacheRepository.getCachedAvatarById
                        >
                    > | null => null
                ),
            avatarCacheRepository
                .getAvatarTags(normalizedAvatarId)
                .catch(
                    (): Awaited<
                        ReturnType<typeof avatarCacheRepository.getAvatarTags>
                    > => []
                ),
            currentUserId
                ? avatarCacheRepository
                      .getAvatarTimeSpent(currentUserId, normalizedAvatarId)
                      .catch(
                          (): Awaited<
                              ReturnType<
                                  typeof avatarCacheRepository.getAvatarTimeSpent
                              >
                          > | null => null
                      )
                : Promise.resolve(null),
            memoPersistenceRepository
                .getAvatarMemo(normalizedAvatarId)
                .catch(
                    (): Awaited<
                        ReturnType<
                            typeof memoPersistenceRepository.getAvatarMemo
                        >
                    > | null => null
                )
        ]);

    return {
        cachedAvatar: cachedAvatar || null,
        localTags: normalizeLocalTags(localTags),
        timeSpent: parseInteger(timeSpentEntry?.timeSpent),
        memo: normalizeString(memoEntry?.memo)
    };
}

export async function getAvatarProfile({
    avatarId,
    force = false,
    dialog = false,
    allowLocalFallback = true,
    currentUserId = ''
}: AvatarProfileInput): Promise<AvatarProfileRecord> {
    const normalizedAvatarId = normalizeEntityId(avatarId);
    if (!normalizedAvatarId) {
        throw new Error(
            'AvatarProfileRepository.getAvatarProfile requires an avatar id.'
        );
    }

    const localSnapshotPromise = getLocalSnapshot(
        normalizedAvatarId,
        currentUserId
    );

    try {
        const [json, localSnapshot] = await Promise.all([
            fetchCachedData({
                queryKey: queryKeys.avatar(
                    normalizedAvatarId,
                    DEFAULT_VRCHAT_API_ENDPOINT
                ),
                policy: dialog
                    ? entityQueryPolicies.avatarDialog
                    : entityQueryPolicies.avatar,
                force,
                queryFn: async () => {
                    const response = unwrapVrchatAvatarResponse<AvatarRecord>(
                        await commands.appVrchatAvatarGet(
                            avatarIdInput(normalizedAvatarId)
                        ),
                        `avatars/${encodeURIComponent(normalizedAvatarId)}`
                    );
                    return response.json;
                }
            }),
            localSnapshotPromise
        ]);

        return normalize(json, localSnapshot);
    } catch (error) {
        const localSnapshot = await localSnapshotPromise;
        if (allowLocalFallback && localSnapshot.cachedAvatar) {
            return normalize(localSnapshot.cachedAvatar, localSnapshot);
        }

        throw error;
    }
}

export async function getAvatarsByUser({
    userId,
    user = '',
    n = VRCHAT_API_DEFAULT_PAGE_SIZE,
    offset = 0,
    sort = 'updated',
    order = 'descending',
    releaseStatus = 'all'
}: AvatarListOptions = {}): Promise<AvatarProfileRecord[]> {
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedUserId) {
        throw new Error(
            'AvatarProfileRepository.getAvatarsByUser requires a user id.'
        );
    }

    const input = {
        userId: normalizedUserId,
        user,
        n,
        offset,
        sort,
        order,
        releaseStatus
    } satisfies VrchatAvatarListByUserInput;
    const response = unwrapVrchatAvatarResponse<AvatarRecord[]>(
        await commands.appVrchatAvatarListByUserGet(input),
        'avatars'
    );
    return Array.isArray(response.json)
        ? response.json.map((avatar) => normalize(avatar))
        : [];
}

export async function getAllAvatarsByUser({
    userId,
    user = '',
    sort = 'updated',
    order = 'descending',
    releaseStatus = 'all'
}: Omit<AvatarListOptions, 'n' | 'offset'> = {}): Promise<
    AvatarProfileRecord[]
> {
    return collectPages(({ n, offset }) =>
        getAvatarsByUser({
            userId,
            user,
            n,
            offset,
            sort,
            order,
            releaseStatus
        })
    );
}

export async function getAvatarStyles({
    force = false
}: AvatarStylesInput = {}): Promise<AvatarStyleRecord[]> {
    return fetchCachedData({
        queryKey: queryKeys.avatarStyles(DEFAULT_VRCHAT_API_ENDPOINT),
        policy: entityQueryPolicies.avatarStyles,
        force,
        queryFn: async () => {
            const response = unwrapVrchatAvatarResponse<AvatarStyleRecord[]>(
                await commands.appVrchatAvatarStylesGet(),
                'avatarStyles'
            );
            return Array.isArray(response.json) ? response.json : [];
        }
    });
}
