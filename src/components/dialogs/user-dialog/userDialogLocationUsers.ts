// @ts-nocheck
import {
    buildInstanceRosterRows,
    firstText
} from '@/components/instances/instanceRoster.js';

export function buildUserDialogLocationUsers({
    locationInstance,
    locationOwnerGroup,
    locationOwnerUser,
    profile,
    sameInstanceUsers,
    t,
    visiblePresenceParsedLocation
}) {
    const ownerFallbackId = firstText(
        visiblePresenceParsedLocation?.userId,
        locationInstance?.ownerUserId,
        locationInstance?.owner_user_id,
        locationInstance?.ownerId,
        locationInstance?.owner_id,
        locationInstance?.userId,
        locationInstance?.user_id,
        locationInstance?.groupId,
        locationInstance?.group_id,
        locationInstance?.group?.id,
        visiblePresenceParsedLocation?.groupId
    );
    const roster = buildInstanceRosterRows({
        includeProfileFallback: true,
        instanceCreatorLabel: t('dialog.user.info.instance_creator'),
        ownerFallbackId,
        ownerGroup: locationOwnerGroup,
        ownerUser: locationOwnerUser,
        parsedLocation: visiblePresenceParsedLocation,
        profile,
        users: sameInstanceUsers
    });

    return {
        locationInstanceUsers: roster.rows,
        locationOwnerId: roster.ownerId
    };
}
