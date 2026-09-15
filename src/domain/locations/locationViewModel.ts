import {
    hasGroupIdPrefix,
    hasWorldIdPrefix
} from '@/shared/constants/vrchatIds';
import {
    normalizeLocationValue,
    parseLocation,
    resolveRegion
} from '@/shared/utils/location';

interface LocationMetadataModelInput {
    worldId?: string | null;
    groupId?: string | null;
    explicitWorldNameHint?: string | null;
    explicitGroupNameHint?: string | null;
    queryWorld?: { name?: string | null } | null;
    queryGroup?: {
        name?: string | null;
        displayName?: string | null;
        shortCode?: string | null;
    } | null;
    locationHint?:
        | {
              worldName?: string | null;
              groupName?: string | null;
              instanceName?: string | null;
              isClosed?: boolean | null;
              region?: string | null;
          }
        | null
        | undefined;
    gameLogWorldName?: string | null;
}

interface LocationMetadataModel {
    worldName: string;
    groupName: string;
    instanceName: string;
    isClosed: boolean;
    region: string;
}

interface LocationViewModelInput {
    location?: string | null;
    traveling?: string | null;
    metadata?: Partial<LocationMetadataModel> | null;
    hint?: string | null;
}

function text(value: string | null | undefined): string {
    return value?.trim() ?? '';
}

function firstText(...values: Array<string | null | undefined>): string {
    for (const value of values) {
        const valueText = text(value);
        if (valueText) {
            return valueText;
        }
    }
    return '';
}

function resolveLocationTarget(
    location: string | null | undefined,
    traveling?: string | null
): string {
    const normalized = normalizeLocationValue(location);
    if (typeof traveling !== 'undefined' && normalized === 'traveling') {
        return normalizeLocationValue(traveling);
    }
    return normalized;
}

function normalizeWorldHint(
    value: string | null | undefined,
    worldId: string | null | undefined
): string {
    const hint = text(value);
    if (!hint || hint === text(worldId) || hasWorldIdPrefix(hint)) {
        return '';
    }
    return hint;
}

function normalizeGroupHint(
    value: string | null | undefined,
    groupId: string | null | undefined
): string {
    const hint = text(value);
    if (!hint || hint === text(groupId) || hasGroupIdPrefix(hint)) {
        return '';
    }
    return hint;
}

function resolveLocationMetadataModel({
    worldId = '',
    groupId = '',
    explicitWorldNameHint = '',
    explicitGroupNameHint = '',
    queryWorld = null,
    queryGroup = null,
    locationHint = null,
    gameLogWorldName = ''
}: LocationMetadataModelInput = {}): LocationMetadataModel {
    const normalizedWorldId = text(worldId);
    const normalizedGroupId = text(groupId);
    const worldName =
        normalizeWorldHint(explicitWorldNameHint, normalizedWorldId) ||
        normalizeWorldHint(queryWorld?.name, normalizedWorldId) ||
        normalizeWorldHint(locationHint?.worldName, normalizedWorldId) ||
        normalizeWorldHint(gameLogWorldName, normalizedWorldId) ||
        normalizedWorldId;
    const groupName =
        normalizeGroupHint(explicitGroupNameHint, normalizedGroupId) ||
        normalizeGroupHint(queryGroup?.name, normalizedGroupId) ||
        normalizeGroupHint(queryGroup?.displayName, normalizedGroupId) ||
        normalizeGroupHint(queryGroup?.shortCode, normalizedGroupId) ||
        normalizeGroupHint(locationHint?.groupName, normalizedGroupId) ||
        normalizedGroupId;

    return {
        worldName,
        groupName,
        instanceName: text(locationHint?.instanceName),
        isClosed: Boolean(locationHint?.isClosed),
        region: text(locationHint?.region)
    };
}

function buildLocationActionTarget(location: string, worldName: string = '') {
    const parsed = parseLocation(location);
    const shortName = parsed.shortName || '';
    const isRealLocation = Boolean(
        parsed.isRealInstance && parsed.worldId && parsed.instanceId
    );
    return {
        location,
        launchLocation: location,
        inviteLocation: location,
        instanceLocation: location,
        parsedLaunchLocation: parsed,
        parsedInviteLocation: parsed,
        parsedInstanceLocation: parsed,
        isRealLaunchLocation: isRealLocation,
        isRealInviteLocation: isRealLocation,
        isRealInstanceLocation: isRealLocation,
        shortName,
        launchToken: shortName,
        worldName
    };
}

function createLocationViewModel({
    location = '',
    traveling,
    metadata = null,
    hint = ''
}: LocationViewModelInput = {}) {
    const targetLocation = resolveLocationTarget(location, traveling);
    const parsed = parseLocation(targetLocation);
    const worldName = firstText(metadata?.worldName, hint, parsed.worldId);
    const groupName = firstText(metadata?.groupName);
    const region = firstText(metadata?.region, resolveRegion(parsed));
    const instanceName = firstText(metadata?.instanceName, parsed.instanceName);

    return {
        location: targetLocation,
        parsed,
        tag: parsed.tag,
        isOffline: parsed.isOffline,
        isPrivate: parsed.isPrivate,
        isTraveling:
            normalizeLocationValue(location) === 'traveling' ||
            parsed.isTraveling,
        isRealInstance: parsed.isRealInstance,
        worldId: parsed.worldId,
        instanceId: parsed.instanceId,
        groupId: parsed.groupId || '',
        userId: parsed.userId || '',
        accessType: parsed.accessType,
        accessTypeName: parsed.accessTypeName,
        region,
        shortName: parsed.shortName,
        strict: parsed.strict,
        ageGate: parsed.ageGate,
        isAgeRestricted: parsed.ageGate,
        isClosed: Boolean(metadata?.isClosed),
        instanceName,
        worldName,
        groupName,
        actionTarget: buildLocationActionTarget(targetLocation, worldName)
    };
}

export { createLocationViewModel, resolveLocationMetadataModel };
