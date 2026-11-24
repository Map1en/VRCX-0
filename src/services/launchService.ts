import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';
import { resolveVrcLaunchUrl } from '@/services/directAccessService';
import { requireHostCapabilitySupported } from '@/services/hostCapabilityService';
import i18n from '@/services/i18nService';
import {
    joinInstanceWithFallback,
    sendSelfInviteToInstance
} from '@/services/instanceActionService';
import { toast } from '@/services/toastService';
import { getLaunchURL } from '@/shared/utils/instance';
import { isRealInstance, parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';

export type LaunchDialogDetails = {
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

function resolveLaunchLocation(location: string): string {
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
    tag: string,
    shortName: string = '',
    launchToken: string = ''
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
        try {
            const response =
                await vrchatInstanceRepository.getInstanceShortName({
                    worldId: parsed.worldId,
                    instanceId: parsed.instanceId
                });
            nextShortName = normalizeString(response.json?.shortName);
            secureOrShortName =
                nextShortName || normalizeString(response.json?.secureName);
        } catch (error) {
            console.warn(
                'Failed to resolve launch dialog shortName, continuing with the instance location:',
                error
            );
        }
    }

    const launchParsed = {
        ...parsed,
        shortName: nextShortName
    };

    return {
        tag: normalizedTag,
        location: resolveLaunchLocation(normalizedTag),
        url: getLaunchURL(launchParsed),
        vrcUrl: await resolveVrcLaunchUrl(normalizedTag, secureOrShortName),
        shortName: nextShortName,
        launchToken: secureOrShortName,
        shortUrl: nextShortName ? `https://vrch.at/${nextShortName}` : '',
        secureOrShortName,
        worldName,
        parsed: launchParsed
    };
}

export async function attachRunningVrchat(
    location: string,
    shortName: string = ''
): Promise<void> {
    const parsed = parseLocation(location);
    const launchLocation = resolveLaunchLocation(location);
    const launchShortName = normalizeString(shortName || parsed.shortName);
    const outcome = await joinInstanceWithFallback(
        launchLocation,
        launchShortName
    );
    if (outcome.status === 'opened') {
        return;
    }
    if (outcome.status === 'selfInvited') {
        toast.add({
            type: 'warning',
            title: i18n.t(
                'common.error.failed_open_instance_in_vrchat_falling_back_to_self_invite'
            )
        });
        toast.add({
            type: 'success',
            title: i18n.t('message.invite.self_sent')
        });
        return;
    }
    throw new Error(outcome.reason);
}

export async function selfInviteToInstance(
    location: string,
    shortName: string = ''
): Promise<void> {
    const parsed = parseLocation(location);
    if (!parsed.worldId || !parsed.instanceId) {
        throw new Error(
            'Cannot self invite: location is not a concrete instance.'
        );
    }
    const launchLocation = resolveLaunchLocation(location);
    const launchShortName = normalizeString(shortName || parsed.shortName);
    await sendSelfInviteToInstance(launchLocation, launchShortName);
}

export async function launchVrchat(
    location: string,
    shortName: string = '',
    desktopMode: boolean = false
): Promise<void> {
    requireHostCapabilitySupported('gameLaunch');
    const launchLocation = normalizeString(location);
    const launchShortName = normalizeString(shortName);
    const launchUrl = await resolveVrcLaunchUrl(
        launchLocation,
        launchShortName
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
    toast.add({
        type: 'success',
        title: i18n.t('common.label.vrchat_launched')
    });
}
