import { toast } from 'sonner';

import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';
import {
    resolveInstanceLaunchToken,
    resolveVrcLaunchUrl,
    tryOpenLaunchLocation
} from '@/services/directAccessService';
import { requireHostCapabilitySupported } from '@/services/hostCapabilityService';
import i18n from '@/services/i18nService';
import { getLaunchURL, isRealInstance } from '@/shared/utils/instance';
import { parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';

type InstanceShortNameResponse = {
    json?: {
        shortName?: unknown;
        secureName?: unknown;
    };
};

type LaunchDialogDetails = {
    tag: string;
    location: string;
    url: string;
    vrcUrl: string;
    shortName: string;
    launchToken: string;
    shortUrl: string;
    secureOrShortName: string;
    worldName: string;
    parsed: ReturnType<typeof parseLocation>;
};

function resolveLaunchLocation(location: unknown): string {
    const parsed = parseLocation(location);
    if (!parsed.worldId) {
        return normalizeString(location);
    }
    if (parsed.instanceId) {
        return `${parsed.worldId}:${parsed.instanceId}`;
    }
    return parsed.worldId;
}

export async function resolveLaunchDialogDetails(
    tag: unknown,
    shortName: unknown = '',
    launchToken: unknown = '',
    endpoint: string = ''
): Promise<LaunchDialogDetails> {
    const normalizedTag = normalizeString(tag);
    const parsed = parseLocation(normalizedTag);
    if (
        !isRealInstance(normalizedTag) ||
        !parsed.worldId ||
        !parsed.instanceId
    ) {
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
        const response = (await vrchatInstanceRepository.getInstanceShortName({
            worldId: parsed.worldId,
            instanceId: parsed.instanceId,
            endpoint
        })) as InstanceShortNameResponse;
        nextShortName = normalizeString(response.json?.shortName);
        secureOrShortName =
            nextShortName || normalizeString(response.json?.secureName);
    }

    const launchParsed: any = {
        ...parsed,
        shortName: nextShortName
    };

    return {
        tag: normalizedTag,
        location: resolveLaunchLocation(normalizedTag),
        url: getLaunchURL(launchParsed),
        vrcUrl: await resolveVrcLaunchUrl(
            normalizedTag,
            secureOrShortName,
            endpoint
        ),
        shortName: nextShortName,
        launchToken: secureOrShortName,
        shortUrl: nextShortName ? `https://vrch.at/${nextShortName}` : '',
        secureOrShortName,
        worldName,
        parsed: launchParsed
    };
}

export async function attachRunningVrchat(
    location: unknown,
    shortName: unknown = '',
    endpoint: string = ''
): Promise<void> {
    const launchLocation = normalizeString(location);
    const launchShortName = normalizeString(shortName);
    if (
        !(await tryOpenLaunchLocation(
            launchLocation,
            launchShortName,
            endpoint
        ))
    ) {
        const parsed = parseLocation(location);
        if (!parsed.worldId || !parsed.instanceId) {
            throw new Error('Unable to open this instance in VRChat.');
        }
        toast.warning(
            i18n.t(
                'common.error.failed_open_instance_in_vrchat_falling_back_to_self_invite'
            )
        );
        const launchToken = await resolveInstanceLaunchToken(
            launchLocation,
            launchShortName,
            endpoint
        );
        await vrchatInstanceRepository.selfInvite({
            worldId: parsed.worldId,
            instanceId: parsed.instanceId,
            shortName: parsed.shortName || launchToken,
            endpoint
        });
        toast.success(i18n.t('message.invite.self_sent'));
    }
}

export async function selfInviteToInstance(
    location: unknown,
    shortName: unknown = '',
    endpoint: string = ''
): Promise<void> {
    const launchLocation = normalizeString(location);
    const launchShortName = normalizeString(shortName);
    const parsed = parseLocation(location);
    if (!parsed.worldId || !parsed.instanceId) {
        throw new Error(
            'Cannot self invite: location is not a concrete instance.'
        );
    }
    const launchToken = await resolveInstanceLaunchToken(
        launchLocation,
        launchShortName,
        endpoint
    );
    await vrchatInstanceRepository.selfInvite({
        worldId: parsed.worldId,
        instanceId: parsed.instanceId,
        shortName: parsed.shortName || launchToken,
        endpoint
    });
}

export async function launchVrchat(
    location: unknown,
    shortName: unknown = '',
    desktopMode: any = false,
    endpoint: string = ''
): Promise<void> {
    requireHostCapabilitySupported('gameLaunch');
    const launchLocation = normalizeString(location);
    const launchShortName = normalizeString(shortName);
    const launchUrl = await resolveVrcLaunchUrl(
        launchLocation,
        launchShortName,
        endpoint
    );
    const args = [launchUrl];
    const launchArguments = normalizeString(
        await configRepository.getString('launchArguments', '')
    );
    const launchPathOverride = normalizeString(
        await configRepository.getString('vrcLaunchPathOverride', '')
    );

    if (launchArguments) {
        args.push(launchArguments);
    }
    if (desktopMode) {
        args.push('--no-vr');
    }

    const argumentString = args.join(' ');
    const launched = launchPathOverride
        ? await commands.appStartGameFromPath(
              launchPathOverride,
              argumentString
          )
        : await commands.appStartGame(argumentString);
    if (!launched) {
        throw new Error(
            launchPathOverride
                ? 'Failed to launch VRChat from the configured custom path.'
                : 'Failed to find VRChat. Configure a custom launch path in launch options.'
        );
    }
    toast.success(i18n.t('common.label.vrchat_launched'));
}
