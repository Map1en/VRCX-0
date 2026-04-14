import { toast } from 'sonner';

import { backend } from '@/platform/index.js';
import { configRepository, instanceRepository } from '@/repositories/index.js';
import { resolveInstanceLaunchToken, resolveVrcLaunchUrl, tryOpenLaunchLocation } from '@/services/directAccessService.js';
import { getLaunchURL, isRealInstance } from '@/shared/utils/instance.js';
import { parseLocation } from '@/shared/utils/location.js';

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function resolveLaunchLocation(location) {
    const parsed = parseLocation(location);
    if (!parsed.worldId) {
        return normalizeString(location);
    }
    if (parsed.instanceId) {
        return `${parsed.worldId}:${parsed.instanceId}`;
    }
    return parsed.worldId;
}

export async function resolveLaunchDialogDetails(tag, shortName = '', launchToken = '', endpoint = '') {
    const normalizedTag = normalizeString(tag);
    const parsed = parseLocation(normalizedTag);
    if (!isRealInstance(normalizedTag) || !parsed.worldId || !parsed.instanceId) {
        return {
            tag: normalizedTag,
            location: normalizedTag,
            url: '',
            vrcUrl: '',
            shortName: '',
            launchToken: '',
            shortUrl: '',
            secureOrShortName: '',
            worldName: '',
            parsed
        };
    }

    let nextShortName = normalizeString(shortName || parsed.shortName);
    let secureOrShortName = normalizeString(launchToken) || nextShortName;
    let worldName = '';
    if (!secureOrShortName) {
        const response = await instanceRepository.getInstanceShortName({
            worldId: parsed.worldId,
            instanceId: parsed.instanceId,
            endpoint
        });
        nextShortName = normalizeString(response.json?.shortName);
        secureOrShortName = nextShortName || normalizeString(response.json?.secureName);
    }

    const launchParsed = {
        ...parsed,
        shortName: nextShortName
    };

    return {
        tag: normalizedTag,
        location: resolveLaunchLocation(normalizedTag),
        url: getLaunchURL(launchParsed),
        vrcUrl: await resolveVrcLaunchUrl(normalizedTag, secureOrShortName, endpoint),
        shortName: nextShortName,
        launchToken: secureOrShortName,
        shortUrl: nextShortName ? `https://vrch.at/${nextShortName}` : '',
        secureOrShortName,
        worldName,
        parsed: launchParsed
    };
}

export async function attachRunningVrchat(location, shortName = '', endpoint = '') {
    if (!await tryOpenLaunchLocation(location, shortName, endpoint)) {
        const parsed = parseLocation(location);
        if (!parsed.worldId || !parsed.instanceId) {
            throw new Error('Unable to open this instance in VRChat.');
        }
        toast.warning('Failed open instance in VRChat, falling back to self invite.');
        const launchToken = await resolveInstanceLaunchToken(location, shortName, endpoint);
        await instanceRepository.selfInvite({
            worldId: parsed.worldId,
            instanceId: parsed.instanceId,
            shortName: parsed.shortName || launchToken,
            endpoint
        });
        toast.success('Self invite sent.');
    }
}

export async function selfInviteToInstance(location, shortName = '', endpoint = '') {
    const parsed = parseLocation(location);
    if (!parsed.worldId || !parsed.instanceId) {
        throw new Error('Cannot self invite: location is not a concrete instance.');
    }
    const launchToken = await resolveInstanceLaunchToken(location, shortName, endpoint);
    await instanceRepository.selfInvite({
        worldId: parsed.worldId,
        instanceId: parsed.instanceId,
        shortName: parsed.shortName || launchToken,
        endpoint
    });
}

export async function launchVrchat(location, shortName = '', desktopMode = false, endpoint = '') {
    const launchUrl = await resolveVrcLaunchUrl(location, shortName, endpoint);
    const args = [launchUrl];
    const launchArguments = normalizeString(await configRepository.getString('launchArguments', ''));
    const launchPathOverride = normalizeString(await configRepository.getString('vrcLaunchPathOverride', ''));

    if (launchArguments) {
        args.push(launchArguments);
    }
    if (desktopMode) {
        args.push('--no-vr');
    }

    const argumentString = args.join(' ');
    const launched = launchPathOverride
        ? await backend.app.StartGameFromPath(launchPathOverride, argumentString)
        : await backend.app.StartGame(argumentString);
    if (!launched) {
        throw new Error(
            launchPathOverride
                ? 'Failed to launch VRChat from the configured custom path.'
                : 'Failed to find VRChat. Configure a custom launch path in launch options.'
        );
    }
    toast.success('VRChat launched.');
}
