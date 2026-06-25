import { parseLocation, normalizeLocationValue } from '@/shared/utils/location';

export function normalizeLocationText(value: any) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function finiteLocationNumber(value: any) {
    if (value === null || typeof value === 'undefined' || value === '') {
        return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

export function firstFiniteLocationNumber(...values: unknown[]) {
    for (const value of values) {
        const number = finiteLocationNumber(value);
        if (number !== null) {
            return number;
        }
    }
    return null;
}

export function resolveLocationTarget(location: any, traveling: any) {
    const normalizedLocation = normalizeLocationValue(location);
    if (
        typeof traveling !== 'undefined' &&
        normalizedLocation === 'traveling'
    ) {
        return normalizeLocationValue(traveling);
    }
    return normalizedLocation;
}

export function normalizeLocationObject(locationObject: any) {
    if (typeof locationObject === 'string') {
        return parseLocation(locationObject);
    }
    if (locationObject && typeof locationObject === 'object') {
        const rawTag = normalizeLocationText(
            locationObject.tag ||
                locationObject.location ||
                locationObject.$location?.tag
        );
        const rawWorldId = normalizeLocationText(
            locationObject.worldId ||
                locationObject.world_id ||
                locationObject.$location?.worldId
        );
        const rawInstanceId = normalizeLocationText(
            locationObject.instanceId ||
                locationObject.instance_id ||
                locationObject.id ||
                locationObject.$location?.instanceId
        );
        const synthesizedTag = rawInstanceId.includes(':')
            ? rawInstanceId
            : rawWorldId && rawInstanceId
              ? `${rawWorldId}:${rawInstanceId}`
              : '';
        const tag = rawTag || synthesizedTag;
        const parsed = parseLocation(tag);
        const instanceId =
            rawInstanceId && !rawInstanceId.includes(':')
                ? rawInstanceId
                : parsed.instanceId;

        return {
            ...parsed,
            ...locationObject,
            tag: tag || parsed.tag,
            isOffline: Boolean(locationObject.isOffline ?? parsed.isOffline),
            isPrivate: Boolean(locationObject.isPrivate ?? parsed.isPrivate),
            isTraveling: Boolean(
                locationObject.isTraveling ?? parsed.isTraveling
            ),
            isRealInstance: Boolean(
                locationObject.isRealInstance ?? parsed.isRealInstance
            ),
            worldId: rawWorldId || parsed.worldId,
            instanceId,
            accessTypeName:
                locationObject.accessTypeName || parsed.accessTypeName,
            instanceName: locationObject.instanceName || parsed.instanceName,
            region:
                locationObject.region ||
                locationObject.regionName ||
                locationObject.region_name ||
                parsed.region,
            shortName: locationObject.shortName || parsed.shortName,
            launchToken:
                locationObject.launchToken ||
                locationObject.secureOrShortName ||
                locationObject.secureName ||
                locationObject.shortName ||
                parsed.shortName,
            strict: Boolean(locationObject.strict ?? parsed.strict),
            groupId: locationObject.groupId || parsed.groupId,
            userId: locationObject.userId || parsed.userId
        };
    }
    return parseLocation('');
}

export function locationObjectWorldName(locObj: any) {
    return normalizeLocationText(
        locObj?.worldName ||
            locObj?.world_name ||
            locObj?.world?.name ||
            locObj?.ref?.worldName ||
            locObj?.ref?.world?.name ||
            locObj?.$worldName ||
            locObj?.$location?.worldName ||
            locObj?.$location?.world?.name ||
            locObj?.$location?.ref?.worldName ||
            locObj?.$location?.ref?.world?.name
    );
}

export function locationObjectGroupName(locObj: any) {
    return normalizeLocationText(
        locObj?.groupName ||
            locObj?.group?.name ||
            locObj?.group?.displayName ||
            locObj?.groupDisplayName ||
            locObj?.ref?.groupName ||
            locObj?.ref?.group?.name ||
            locObj?.ref?.group?.displayName ||
            locObj?.ref?.groupDisplayName ||
            locObj?.$location?.groupName ||
            locObj?.$location?.ref?.groupName ||
            locObj?.$location?.ref?.group?.name ||
            locObj?.$location?.ref?.group?.displayName
    );
}

export function worldDialogTarget(locObj: any) {
    return (
        normalizeLocationText(locObj.worldId) ||
        normalizeLocationText(locObj.tag)
    );
}

export function launchTagForLocationObject(locObj: any) {
    const tag = normalizeLocationText(locObj.tag);
    if (tag) {
        return tag;
    }
    const worldId = normalizeLocationText(locObj.worldId);
    const instanceId = normalizeLocationText(locObj.instanceId);
    return worldId && instanceId ? `${worldId}:${instanceId}` : '';
}

export function isUsableInstanceLocation(parsedLocation: any) {
    return Boolean(
        parsedLocation?.isRealInstance &&
        parsedLocation.worldId &&
        parsedLocation.instanceId
    );
}

export function buildInstanceActionTarget({
    target = null,
    location = '',
    launchLocation = '',
    inviteLocation = '',
    instanceLocation = '',
    shortName = '',
    worldName = ''
}: any = {}) {
    const source = target && typeof target === 'object' ? target : {};
    const baseLocation = normalizeLocationText(
        source.location || source.tag || location
    );
    const resolvedLaunchLocation =
        normalizeLocationText(source.launchLocation || launchLocation) ||
        baseLocation;
    const resolvedInviteLocation =
        normalizeLocationText(source.inviteLocation || inviteLocation) ||
        baseLocation;
    const resolvedInstanceLocation =
        normalizeLocationText(source.instanceLocation || instanceLocation) ||
        baseLocation;
    const parsedLaunchLocation = parseLocation(resolvedLaunchLocation);
    const parsedInviteLocation = parseLocation(resolvedInviteLocation);
    const parsedInstanceLocation = parseLocation(resolvedInstanceLocation);
    const resolvedShortName =
        normalizeLocationText(source.shortName) ||
        normalizeLocationText(shortName) ||
        parsedLaunchLocation.shortName ||
        parsedInviteLocation.shortName ||
        parsedInstanceLocation.shortName ||
        '';

    return {
        location: baseLocation,
        launchLocation: resolvedLaunchLocation,
        inviteLocation: resolvedInviteLocation,
        instanceLocation: resolvedInstanceLocation,
        parsedLaunchLocation,
        parsedInviteLocation,
        parsedInstanceLocation,
        isRealLaunchLocation: isUsableInstanceLocation(parsedLaunchLocation),
        isRealInviteLocation: isUsableInstanceLocation(parsedInviteLocation),
        isRealInstanceLocation: isUsableInstanceLocation(
            parsedInstanceLocation
        ),
        shortName: resolvedShortName,
        launchToken:
            normalizeLocationText(source.launchToken) || resolvedShortName,
        worldName:
            normalizeLocationText(source.worldName) ||
            normalizeLocationText(worldName)
    };
}
