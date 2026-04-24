import { groupIdForRow } from './userDialogGroupRows.js';
import {
    firstNonGroupIdText,
    isGroupId,
    normalizedText,
    userIdForRow
} from './userDialogRows.js';

export function buildUserDialogLocationUsers({
    locationInstance,
    locationOwnerGroup,
    locationOwnerUser,
    profile,
    sameInstanceUsers,
    t,
    visiblePresenceParsedLocation
}) {
    const locationUsers = [];
    const locationUserRowsByKey = new Map();
    const instanceCreatorLabel = t('dialog.user.info.instance_creator');

    function addLocationUser(user, subtitle = '') {
        if (!user) {
            return;
        }
        const source =
            typeof user === 'string'
                ? { id: user, userId: user, displayName: user }
                : user;
        const userId = normalizedText(
            source.id || source.userId || source.targetUserId
        );
        const displayName = normalizedText(
            source.displayName || source.username || source.name || userId
        );
        const key =
            userId ||
            `display:${displayName.toLowerCase()}:${locationUsers.length}`;
        if (!key) {
            return;
        }

        const existing = locationUserRowsByKey.get(key);
        if (existing) {
            if (subtitle && !existing.$subtitle) {
                existing.$subtitle = subtitle;
            }
            if (source.$userColour && !existing.$userColour) {
                existing.$userColour = source.$userColour;
            }
            return;
        }

        const row = {
            ...source,
            id: userId || source.id,
            userId: source.userId || userId,
            displayName,
            $subtitle: subtitle || source.$subtitle || source.subtitle || ''
        };
        locationUserRowsByKey.set(key, row);
        locationUsers.push(row);
    }

    addLocationUser(locationOwnerUser, instanceCreatorLabel);
    for (const user of sameInstanceUsers) {
        addLocationUser(user);
    }
    if (
        visiblePresenceParsedLocation?.isRealInstance &&
        !sameInstanceUsers.length
    ) {
        addLocationUser(profile);
    }

    const locationOwnerFallbackId = normalizedText(
        visiblePresenceParsedLocation?.userId ||
            locationInstance?.ownerUserId ||
            locationInstance?.owner_user_id ||
            locationInstance?.ownerId ||
            locationInstance?.owner_id ||
            locationInstance?.userId ||
            locationInstance?.user_id ||
            locationInstance?.groupId ||
            locationInstance?.group_id ||
            locationInstance?.group?.id ||
            visiblePresenceParsedLocation?.groupId
    );
    const locationOwnerUserId = userIdForRow(locationOwnerUser);
    const locationOwnerGroupId = groupIdForRow(locationOwnerGroup);
    const locationOwnerIsGroup = Boolean(
        locationOwnerGroupId ||
        isGroupId(locationOwnerFallbackId) ||
        isGroupId(locationOwnerUserId)
    );
    const locationOwnerId =
        locationOwnerGroupId ||
        (locationOwnerIsGroup
            ? locationOwnerFallbackId || locationOwnerUserId
            : locationOwnerUserId) ||
        locationOwnerFallbackId;
    const locationOwnerName = locationOwnerIsGroup
        ? firstNonGroupIdText(
              locationOwnerGroup?.name,
              locationOwnerGroup?.displayName,
              locationOwnerGroup?.display_name,
              locationOwnerGroup?.shortCode,
              locationInstance?.groupName,
              locationInstance?.group_name,
              locationInstance?.group?.name,
              profile?.$location?.groupName,
              profile?.$location?.group_name,
              profile?.$location?.group?.name,
              locationOwnerUser?.displayName,
              locationOwnerUser?.username,
              locationOwnerUser?.name,
              locationOwnerId
          )
        : normalizedText(
              locationOwnerUser?.displayName ||
                  locationOwnerUser?.username ||
                  locationOwnerUser?.name ||
                  locationOwnerId
          );
    const locationOwnerRow =
        !locationOwnerIsGroup && locationOwnerUser
            ? {
                  ...locationOwnerUser,
                  $subtitle: instanceCreatorLabel
              }
            : !locationOwnerIsGroup && locationOwnerId
              ? {
                    id: locationOwnerId,
                    userId: locationOwnerId,
                    displayName: locationOwnerName,
                    $subtitle: instanceCreatorLabel
                }
              : null;
    const locationPlayerUsers =
        locationOwnerId && !locationOwnerIsGroup
            ? locationUsers.filter(
                  (user) => userIdForRow(user) !== locationOwnerId
              )
            : locationUsers;

    return {
        locationInstanceUsers: locationOwnerRow
            ? [locationOwnerRow, ...locationPlayerUsers]
            : locationPlayerUsers,
        locationOwnerId
    };
}
