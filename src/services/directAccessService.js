import { backend } from '@/platform/index.js';
import { instanceRepository, vrchatSearchRepository } from '@/repositories/index.js';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';
import { parseLocation } from '@/shared/utils/location.js';

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function emptyArray(value) {
    return Array.isArray(value) ? value : [];
}

function openWorldLocation(location, title = '') {
    const parsedLocation = parseLocation(location);
    const worldDialogTarget = parsedLocation.isRealInstance && parsedLocation.tag
        ? parsedLocation.tag
        : parsedLocation.worldId || location;
    openWorldDialog({
        worldId: worldDialogTarget,
        title: title || undefined
    });
}

export function buildVrcLaunchUrl(location, shortName = '') {
    const params = new URLSearchParams({
        ref: 'vrcx.app',
        id: location
    });
    if (shortName) {
        params.set('shortName', shortName);
    }
    return `vrchat://launch?${params.toString()}`;
}

function normalizeLaunchLocation(location) {
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

function shouldUseProvidedLaunchToken(parsed, shortName) {
    return Boolean(shortName && parsed.accessType !== 'public' && parsed.groupAccessType !== 'public');
}

export async function resolveInstanceLaunchToken(location, shortName = '', endpoint = '') {
    const { parsed } = normalizeLaunchLocation(location);
    let launchToken = normalizeString(shortName || parsed.shortName);

    if (shouldUseProvidedLaunchToken(parsed, launchToken)) {
        return launchToken;
    }

    if (parsed.worldId && parsed.instanceId) {
        try {
            const response = await instanceRepository.getInstanceShortName({
                worldId: parsed.worldId,
                instanceId: parsed.instanceId,
                endpoint
            });
            launchToken = normalizeString(response.json?.shortName || response.json?.secureName);
        } catch (error) {
            console.warn('Failed to resolve VRChat launch shortName, falling back to worldId and instanceId:', error);
        }
    }

    return launchToken;
}

export async function resolveVrcLaunchUrl(location, shortName = '', endpoint = '') {
    const { location: normalizedLocation, parsed } = normalizeLaunchLocation(location);
    const launchToken = await resolveInstanceLaunchToken(normalizedLocation, shortName || parsed.shortName, endpoint);
    return buildVrcLaunchUrl(normalizedLocation, launchToken);
}

export async function tryOpenLaunchLocation(location, shortName = '', endpoint = '') {
    const normalizedLocation = normalizeString(location);
    if (!normalizedLocation || !normalizedLocation.includes(':')) {
        return false;
    }

    try {
        return Boolean(
            await backend.app.TryOpenInstanceInVrc(await resolveVrcLaunchUrl(normalizedLocation, shortName, endpoint))
        );
    } catch (error) {
        console.warn('Failed to open VRChat launch URL through IPC:', error);
        return false;
    }
}

async function verifyShortName(location, shortName, endpoint = '') {
    const response = await vrchatSearchRepository.getInstanceFromShortName(shortName, { endpoint });
    const nextLocation = response.json?.location || location;
    if (!nextLocation) {
        return false;
    }

    if (await tryOpenLaunchLocation(nextLocation, response.json?.shortName || shortName, endpoint)) {
        return true;
    }

    openWorldLocation(nextLocation, response.json?.world?.name || response.json?.worldName || nextLocation);
    return true;
}

async function openGroupByShortCode(shortCode, endpoint = '') {
    const response = await vrchatSearchRepository.getGroupsStrictSearch({
        query: shortCode
    }, { endpoint });
    const group = emptyArray(response.json).find(
        (entry) => `${entry.shortCode || ''}.${entry.discriminator || ''}` === shortCode
    );
    if (!group?.id) {
        return false;
    }

    openGroupDialog({
        groupId: group.id,
        title: group.name || undefined,
        seedData: group
    });
    return true;
}

async function directAccessWorld(rawInput, endpoint = '') {
    let input = normalizeString(rawInput);
    if (!input) {
        return false;
    }

    if (input.startsWith('/home/')) {
        input = `https://vrchat.com${input}`;
    }

    if (/^[A-Za-z0-9]{8}$/.test(input)) {
        return verifyShortName('', input, endpoint);
    }

    if (input.startsWith('https://vrch.at/')) {
        const shortName = new URL(input).pathname.replace(/^\//, '').slice(0, 8);
        return shortName ? verifyShortName('', shortName, endpoint) : false;
    }

    if (input.startsWith('https://vrchat.')) {
        const url = new URL(input);
        const pathParts = url.pathname.split('/');
        if (pathParts.length >= 4 && pathParts[2] === 'world') {
            openWorldLocation(decodeURIComponent(pathParts[3]));
            return true;
        }

        if (url.pathname === '/home/launch') {
            const worldId = url.searchParams.get('worldId');
            const instanceId = url.searchParams.get('instanceId');
            const shortName = url.searchParams.get('shortName');
            if (worldId && instanceId) {
                const location = `${worldId}:${instanceId}`;
                if (await tryOpenLaunchLocation(location, shortName || '', endpoint)) {
                    return true;
                }
                if (shortName) {
                    try {
                        if (await verifyShortName(location, shortName, endpoint)) {
                            return true;
                        }
                    } catch (error) {
                        console.warn('Failed to resolve VRChat launch shortName, falling back to worldId and instanceId:', error);
                    }
                }
                openWorldLocation(location);
                return true;
            }
            if (worldId) {
                openWorldLocation(worldId);
                return true;
            }
        }
    }

    if (input.startsWith('wrld_') || input.startsWith('wld_') || input.startsWith('o_')) {
        if (input.includes('&instanceId=')) {
            return directAccessWorld(`https://vrchat.com/home/launch?worldId=${input}`, endpoint);
        }

        openWorldLocation(input.trim());
        return true;
    }

    return false;
}

export async function directAccessParse(input, endpoint = '') {
    const value = normalizeString(input);
    if (!value) {
        return false;
    }

    if (await directAccessWorld(value, endpoint)) {
        return true;
    }

    if (value.startsWith('https://vrchat.')) {
        const url = new URL(value);
        const pathParts = url.pathname.split('/');
        if (pathParts.length < 4) {
            return false;
        }

        const type = pathParts[2];
        const id = decodeURIComponent(pathParts[3]);
        if (type === 'user') {
            openUserDialog({ userId: id });
            return true;
        }
        if (type === 'avatar') {
            openAvatarDialog({ avatarId: id });
            return true;
        }
        if (type === 'group') {
            openGroupDialog({ groupId: id });
            return true;
        }
    }

    if (value.startsWith('https://vrc.group/')) {
        return openGroupByShortCode(value.substring('https://vrc.group/'.length), endpoint);
    }

    if (/^[A-Za-z0-9]{3,6}\.[0-9]{4}$/.test(value)) {
        return openGroupByShortCode(value, endpoint);
    }

    if (value.startsWith('usr_') || /^[A-Za-z0-9]{10}$/.test(value)) {
        openUserDialog({ userId: value });
        return true;
    }

    if (value.startsWith('avtr_') || value.startsWith('b_')) {
        openAvatarDialog({ avatarId: value });
        return true;
    }

    if (value.startsWith('grp_')) {
        openGroupDialog({ groupId: value });
        return true;
    }

    return false;
}
