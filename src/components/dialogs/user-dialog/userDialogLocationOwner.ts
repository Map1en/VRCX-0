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

type DialogRecord = Record<string, unknown>;

function record(value: unknown): DialogRecord {
    return value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value))
        : {};
}

export function resolveOwnerId(
    sourceValue: unknown,
    fallbackOwnerId: unknown = '',
    fallbackGroupId: unknown = ''
) {
    const source = record(sourceValue);
    const ownerUser = record(source.ownerUser);
    const owner = record(source.owner);
    const creatorUser = record(source.creatorUser);
    const user = record(source.user);
    const group = record(source.group);
    return normalizeUserId(
        source.ownerUserId ||
            source.owner_user_id ||
            source.ownerId ||
            source.owner_id ||
            source.userId ||
            source.user_id ||
            source.creatorUserId ||
            source.creator_user_id ||
            ownerUser.id ||
            ownerUser.userId ||
            ownerUser.user_id ||
            owner.id ||
            owner.userId ||
            owner.user_id ||
            creatorUser.id ||
            creatorUser.userId ||
            creatorUser.user_id ||
            user.id ||
            user.userId ||
            user.user_id ||
            source.groupId ||
            source.group_id ||
            group.id ||
            group.groupId ||
            group.group_id ||
            fallbackOwnerId ||
            fallbackGroupId
    );
}

export function resolveOwnerSeed(
    sourceValue: unknown,
    ownerId: unknown,
    knownUsersById: Map<string, unknown>
) {
    const source = record(sourceValue);
    if (!ownerId) {
        return null;
    }

    if (isGroupId(ownerId)) {
        return (
            source.group ||
            source.ownerGroup ||
            source.owner_group ||
            groupSeed(source.owner) ||
            source.creatorGroup ||
            source.creator_group ||
            null
        );
    }

    return (
        source.ownerUser ||
        source.owner ||
        source.creatorUser ||
        source.user ||
        knownUsersById.get(normalizeUserId(ownerId)) ||
        null
    );
}

export function resolveGroupFallback(sourceValue: unknown, ownerId: unknown) {
    const source = record(sourceValue);
    const group = record(source.group);
    return {
        id: normalizeUserId(ownerId),
        name: normalizeUserId(
            source.groupName || source.group_name || group.name
        )
    };
}

type LoadLocationOwnerInput = {
    ownerId: string;
    ownerSeed: unknown;
    groupFallback: { id: string; name: string };
};

type LocationOwnerResult = {
    ownerUser: ReturnType<typeof createLocationUserRow> | null;
    ownerGroup: ReturnType<typeof createLocationGroupRow> | null;
};

export async function loadLocationOwner({
    ownerId,
    ownerSeed,
    groupFallback
}: LoadLocationOwnerInput): Promise<LocationOwnerResult> {
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
            userId: ownerId
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
