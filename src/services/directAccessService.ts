import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';
import vrchatSearchRepository from '@/repositories/vrchatSearchRepository';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService';
import { openInstanceInGame } from '@/services/instanceActionService';
import {
    hasAvatarIdPrefix,
    hasGroupIdPrefix,
    hasUserIdPrefix,
    hasWorldIdPrefix
} from '@/shared/constants/vrchatIds';
import { VRCHAT_WEB_BASE } from '@/shared/constants/vrchatWebUrls';
import { parseLocation } from '@/shared/utils/location';
import { isRecord } from '@/shared/utils/record';
import { normalizeString } from '@/shared/utils/string';

export type DirectAccessMode = 'open' | 'detect';

type LooseRecord = Record<string, unknown>;
type ParsedLocation = ReturnType<typeof parseLocation>;

function parseUrlOrNull(value: string) {
    try {
        return new URL(value);
    } catch {
        return null;
    }
}

function emptyRecordArray(value: unknown): LooseRecord[] {
    return Array.isArray(value) ? value : [];
}

function openWorldLocation(location: unknown, title: unknown = '') {
    const parsedLocation = parseLocation(location);
    const worldDialogTarget =
        parsedLocation.isRealInstance && parsedLocation.tag
            ? parsedLocation.tag
            : parsedLocation.worldId || location;
    openWorldDialog({
        worldId: normalizeString(worldDialogTarget),
        title: normalizeString(title) || undefined
    });
}

export function buildVrcLaunchUrl(location: string, shortName = '') {
    const normalizedLocation = normalizeString(location);
    const normalizedShortName = normalizeString(shortName);
    let launchUrl = `vrchat://launch?id=${normalizedLocation}`;
    if (normalizedShortName) {
        launchUrl += `&shortName=${normalizedShortName}`;
    }
    return launchUrl;
}

function normalizeLaunchLocation(location: string) {
    const normalizedLocation = normalizeString(location);
    const parsed = parseLocation(normalizedLocation);
    if (parsed.worldId && parsed.instanceId) {
        return {
            location: `${parsed.worldId}:${parsed.instanceId}`,
            parsed
        };
    }
    return {
        location: normalizedLocation,
        parsed
    };
}

function shouldUseProvidedLaunchToken(
    parsed: ParsedLocation,
    shortName: string
) {
    return Boolean(
        shortName &&
        parsed.accessType !== 'public' &&
        parsed.groupAccessType !== 'public'
    );
}

export async function resolveInstanceLaunchToken(
    location: string,
    shortName = ''
) {
    const { parsed } = normalizeLaunchLocation(location);
    let launchToken = normalizeString(shortName || parsed.shortName);

    if (shouldUseProvidedLaunchToken(parsed, launchToken)) {
        return launchToken;
    }

    if (parsed.worldId && parsed.instanceId) {
        try {
            const response =
                await vrchatInstanceRepository.getInstanceShortName({
                    worldId: parsed.worldId,
                    instanceId: parsed.instanceId
                });
            launchToken = normalizeString(
                response.json?.shortName || response.json?.secureName
            );
        } catch (error) {
            console.warn(
                'Failed to resolve VRChat launch shortName, falling back to worldId and instanceId:',
                error
            );
        }
    }

    return launchToken;
}

export async function resolveVrcLaunchUrl(location: string, shortName = '') {
    const { location: normalizedLocation, parsed } =
        normalizeLaunchLocation(location);
    const launchToken = await resolveInstanceLaunchToken(
        normalizedLocation,
        shortName || parsed.shortName
    );
    return buildVrcLaunchUrl(normalizedLocation, launchToken);
}

export async function tryOpenLaunchLocation(location: string, shortName = '') {
    const { location: normalizedLocation, parsed } =
        normalizeLaunchLocation(location);
    if (!normalizedLocation || !normalizedLocation.includes(':')) {
        return false;
    }

    return openInstanceInGame(
        normalizedLocation,
        normalizeString(shortName || parsed.shortName)
    );
}

async function verifyShortName(location: unknown, shortName: string) {
    const response =
        await vrchatSearchRepository.getInstanceFromShortName(shortName);
    const json = response.json;
    const nextLocation = json?.location || location;
    if (!nextLocation) {
        return false;
    }

    if (
        await tryOpenLaunchLocation(
            normalizeString(nextLocation),
            normalizeString(json?.shortName || shortName)
        )
    ) {
        return true;
    }

    const world = isRecord(json.world) ? json.world : {};
    openWorldLocation(
        nextLocation,
        world.name || json?.worldName || nextLocation
    );
    return true;
}

async function openGroupByShortCode(shortCode: string) {
    const response = await vrchatSearchRepository.getGroupsStrictSearch({
        query: shortCode
    });
    const group = emptyRecordArray(response.json).find(
        (entry) =>
            `${normalizeString(entry.shortCode)}.${normalizeString(entry.discriminator)}` ===
            shortCode
    );
    if (!group?.id) {
        return false;
    }

    openGroupDialog({
        groupId: normalizeString(group.id),
        title: normalizeString(group.name) || undefined,
        seedData: group
    });
    return true;
}

async function directAccessWorld(rawInput: unknown, mode: DirectAccessMode) {
    let input = normalizeString(rawInput);
    if (!input) {
        return false;
    }

    if (input.startsWith('/home/')) {
        input = `${VRCHAT_WEB_BASE}${input}`;
    }

    if (input.startsWith('vrchat://launch')) {
        const parsed = parseLocation(input);
        if (!parsed.worldId || !parsed.instanceId) {
            return false;
        }
        if (mode === 'detect') {
            return true;
        }
        const location = `${parsed.worldId}:${parsed.instanceId}`;
        if (await tryOpenLaunchLocation(location, parsed.shortName)) {
            return true;
        }
        openWorldLocation(location);
        return true;
    }

    if (/^[A-Za-z0-9]{8}$/.test(input)) {
        return mode === 'detect' ? false : verifyShortName('', input);
    }

    if (input.startsWith('https://vrch.at/')) {
        const url = parseUrlOrNull(input);
        const shortName = url
            ? url.pathname.replace(/^\//, '').slice(0, 8)
            : '';
        if (!shortName) {
            return false;
        }
        return mode === 'detect' ? true : verifyShortName('', shortName);
    }

    if (input.startsWith('https://vrchat.')) {
        const url = parseUrlOrNull(input);
        if (!url) {
            return false;
        }
        const pathParts = url.pathname.split('/');
        if (pathParts.length >= 4 && pathParts[2] === 'world') {
            if (mode === 'detect') {
                return true;
            }
            openWorldLocation(decodeURIComponent(pathParts[3]));
            return true;
        }

        if (url.pathname === '/home/launch') {
            const worldId = url.searchParams.get('worldId');
            const instanceId = url.searchParams.get('instanceId');
            const shortName = url.searchParams.get('shortName');
            if (worldId && instanceId) {
                if (mode === 'detect') {
                    return true;
                }
                const location = `${worldId}:${instanceId}`;
                if (await tryOpenLaunchLocation(location, shortName || '')) {
                    return true;
                }
                if (shortName) {
                    try {
                        if (await verifyShortName(location, shortName)) {
                            return true;
                        }
                    } catch (error) {
                        console.warn(
                            'Failed to resolve VRChat launch shortName, falling back to worldId and instanceId:',
                            error
                        );
                    }
                }
                openWorldLocation(location);
                return true;
            }
            if (worldId) {
                if (mode === 'detect') {
                    return true;
                }
                openWorldLocation(worldId);
                return true;
            }
        }
    }

    if (
        hasWorldIdPrefix(input) ||
        input.startsWith('wld_') ||
        input.startsWith('o_')
    ) {
        if (input.includes('&instanceId=')) {
            return directAccessWorld(
                `${VRCHAT_WEB_BASE}/home/launch?worldId=${input}`,
                mode
            );
        }

        if (mode === 'detect') {
            return true;
        }
        openWorldLocation(input.trim());
        return true;
    }

    return false;
}

export async function directAccessParse(
    input: unknown,
    mode: DirectAccessMode = 'open'
) {
    const value = normalizeString(input).trim();
    if (!value) {
        return false;
    }

    if (await directAccessWorld(value, mode)) {
        return true;
    }

    if (value.startsWith('https://vrchat.')) {
        const url = parseUrlOrNull(value);
        if (!url) {
            return false;
        }
        const pathParts = url.pathname.split('/');
        if (pathParts.length < 4) {
            return false;
        }

        const type = pathParts[2];
        if (type === 'user' || type === 'avatar' || type === 'group') {
            if (mode === 'detect') {
                return true;
            }
            const id = decodeURIComponent(pathParts[3]);
            if (type === 'user') {
                openUserDialog({ userId: id });
                return true;
            }
            if (type === 'avatar') {
                openAvatarDialog({ avatarId: id });
                return true;
            }
            openGroupDialog({ groupId: id });
            return true;
        }
    }

    if (value.startsWith('https://vrc.group/')) {
        const shortCode = value.substring('https://vrc.group/'.length);
        if (mode === 'detect') {
            return Boolean(shortCode);
        }
        return openGroupByShortCode(shortCode);
    }

    if (/^[A-Za-z0-9]{3,6}\.[0-9]{4}$/.test(value)) {
        return mode === 'detect' ? true : openGroupByShortCode(value);
    }

    if (hasUserIdPrefix(value)) {
        if (mode === 'detect') {
            return true;
        }
        openUserDialog({ userId: value });
        return true;
    }

    if (/^[A-Za-z0-9]{10}$/.test(value)) {
        if (mode === 'detect') {
            return false;
        }
        openUserDialog({ userId: value });
        return true;
    }

    if (hasAvatarIdPrefix(value) || value.startsWith('b_')) {
        if (mode === 'detect') {
            return true;
        }
        openAvatarDialog({ avatarId: value });
        return true;
    }

    if (hasGroupIdPrefix(value)) {
        if (mode === 'detect') {
            return true;
        }
        openGroupDialog({ groupId: value });
        return true;
    }

    return false;
}
