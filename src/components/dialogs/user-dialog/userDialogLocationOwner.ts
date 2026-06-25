import groupProfileRepository from '@/repositories/groupProfileRepository';
import userProfileRepository from '@/repositories/userProfileRepository';

import {
    createLocationGroupRow,
    createLocationUserRow,
    groupSeed,
    hasGroupProfileDetails,
    isGroupId
} from './userDialogContentHelpers';
import { normalizeUserId } from './userProfileFields';

export function resolveOwnerId(
    source: any,
    fallbackOwnerId: any = '',
    fallbackGroupId: any = ''
) {
    return normalizeUserId(
        source?.ownerUserId ||
            source?.owner_user_id ||
            source?.ownerId ||
            source?.owner_id ||
            source?.userId ||
            source?.user_id ||
            source?.creatorUserId ||
            source?.creator_user_id ||
            source?.ownerUser?.id ||
            source?.ownerUser?.userId ||
            source?.ownerUser?.user_id ||
            source?.owner?.id ||
            source?.owner?.userId ||
            source?.owner?.user_id ||
            source?.creatorUser?.id ||
            source?.creatorUser?.userId ||
            source?.creatorUser?.user_id ||
            source?.user?.id ||
            source?.user?.userId ||
            source?.user?.user_id ||
            source?.groupId ||
            source?.group_id ||
            source?.group?.id ||
            source?.group?.groupId ||
            source?.group?.group_id ||
            fallbackOwnerId ||
            fallbackGroupId
    );
}

export function resolveOwnerSeed(
    source: any,
    ownerId: any,
    knownUsersById: any
) {
    if (!ownerId) {
        return null;
    }

    if (isGroupId(ownerId)) {
        return (
            source?.group ||
            source?.ownerGroup ||
            source?.owner_group ||
            groupSeed(source?.owner) ||
            source?.creatorGroup ||
            source?.creator_group ||
            null
        );
    }

    return (
        source?.ownerUser ||
        source?.owner ||
        source?.creatorUser ||
        source?.user ||
        knownUsersById.get(ownerId) ||
        null
    );
}

export function resolveGroupFallback(source: any, ownerId: any) {
    return {
        id: ownerId,
        name:
            source?.groupName || source?.group_name || source?.group?.name || ''
    };
}

export async function loadLocationOwner({
    ownerId,
    ownerSeed,
    endpoint,
    groupFallback
}: any): Promise<{ ownerUser: unknown; ownerGroup: unknown }> {
    if (!ownerId) {
        return { ownerUser: null, ownerGroup: null };
    }

    if (isGroupId(ownerId)) {
        const cachedOwnerGroup = ownerSeed
            ? createLocationGroupRow(ownerSeed, groupFallback)
            : null;
        if (ownerSeed && hasGroupProfileDetails(ownerSeed, groupFallback)) {
            return {
                ownerUser: null,
                ownerGroup: cachedOwnerGroup
            };
        }

        try {
            const groupProfile = await groupProfileRepository.getGroupProfile({
                groupId: ownerId,
                endpoint,
                includeRoles: false
            });

            return {
                ownerUser: null,
                ownerGroup: createLocationGroupRow(groupProfile, groupFallback)
            };
        } catch {
            return {
                ownerUser: null,
                ownerGroup:
                    cachedOwnerGroup ||
                    createLocationGroupRow({
                        id: ownerId,
                        name: groupFallback.name || ownerId
                    })
            };
        }
    }

    if (ownerSeed) {
        return {
            ownerUser: createLocationUserRow(ownerSeed),
            ownerGroup: null
        };
    }

    try {
        const ownerProfile = await userProfileRepository.getUserProfile({
            userId: ownerId,
            endpoint
        });

        return {
            ownerUser: createLocationUserRow(ownerProfile),
            ownerGroup: null
        };
    } catch {
        return {
            ownerUser: createLocationUserRow({
                id: ownerId,
                displayName: ownerId
            }),
            ownerGroup: null
        };
    }
}
