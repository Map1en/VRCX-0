import {
    buildInstanceRosterRows,
    firstText
} from '@/domain/instances/instanceRoster';

export function buildUserDialogLocationUsers({
    locationInstance,
    locationOwnerGroup,
    locationOwnerUser,
    profile,
    sameInstanceUsers,
    t,
    visiblePresenceParsedLocation
}: {
    locationInstance: unknown;
    locationOwnerGroup: unknown;
    locationOwnerUser: unknown;
    profile: unknown;
    sameInstanceUsers: unknown;
    t: (key: string) => string;
    visiblePresenceParsedLocation: unknown;
}) {
    const record = (value: unknown) =>
        value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value))
            : {};
    const source = (value: unknown) =>
        typeof value === 'string'
            ? value
            : value && typeof value === 'object'
              ? record(value)
              : null;
    const instance = record(locationInstance);
    const parsedLocation = record(visiblePresenceParsedLocation);
    const group =
        instance.group && typeof instance.group === 'object'
            ? Object.fromEntries(Object.entries(instance.group))
            : {};
    const ownerFallbackId = firstText(
        parsedLocation.userId,
        instance.ownerUserId,
        instance.owner_user_id,
        instance.ownerId,
        instance.owner_id,
        instance.userId,
        instance.user_id,
        instance.groupId,
        instance.group_id,
        group.id,
        parsedLocation.groupId
    );
    const roster = buildInstanceRosterRows({
        includeProfileFallback: true,
        instanceCreatorLabel: t('dialog.user.info.instance_creator'),
        ownerFallbackId,
        ownerGroup: source(locationOwnerGroup),
        ownerUser: source(locationOwnerUser),
        parsedLocation,
        profile: source(profile),
        users: Array.isArray(sameInstanceUsers) ? sameInstanceUsers : []
    });

    return {
        locationInstanceUsers: roster.rows,
        locationOwnerId: roster.ownerId
    };
}
