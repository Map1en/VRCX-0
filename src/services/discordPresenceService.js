import { backend } from '@/platform/index.js';
import {
    configRepository,
    groupProfileRepository,
    playerListRepository,
    worldProfileRepository
} from '@/repositories/index.js';
import { ActivityType, StatusDisplayType } from '@/shared/constants/discord.js';
import {
    getPlatformLabel,
    getRpcWorldConfig,
    getStatusInfo,
    isPopcornPalaceWorld
} from '@/shared/utils/discordPresence.js';
import { getLaunchURL, isRealInstance } from '@/shared/utils/instance.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { translateCurrentLocale } from './i18nService.js';

const DEFAULT_APP_ID = '883308884863901717';
const i18nKeys = [
    'dialog.new_instance.access_type_public',
    'dialog.new_instance.access_type_invite_plus',
    'dialog.new_instance.access_type_invite',
    'dialog.new_instance.access_type_friend',
    'dialog.new_instance.access_type_friend_plus',
    'dialog.new_instance.access_type_group',
    'dialog.new_instance.group_access_type_public',
    'dialog.new_instance.group_access_type_plus',
    'dialog.user.status.active',
    'dialog.user.status.join_me',
    'dialog.user.status.ask_me',
    'dialog.user.status.busy',
    'dialog.user.status.offline',
    'view.settings.discord_presence.rpc.desktop',
    'view.settings.discord_presence.rpc.vr',
    'view.settings.discord_presence.rpc.powered_by_vrcx',
    'view.settings.discord_presence.rpc.private_world'
];

let isDiscordActive = false;
let lastLocationDetails = createEmptyLocationDetails();

function createEmptyLocationDetails() {
    return {
        tag: '',
        parsed: null,
        worldName: '',
        thumbnailImageUrl: '',
        worldCapacity: 0,
        worldLink: '',
        groupName: ''
    };
}

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function timestampSeconds(value) {
    if (!value) {
        return 0;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function createActivityTimestamps(startTime, endTime = 0) {
    const timestamps = {};
    const start = timestampSeconds(startTime);
    const end = timestampSeconds(endTime);
    if (start > 0) {
        timestamps.start = start;
    }
    if (end > 0) {
        timestamps.end = end;
    }
    return Object.keys(timestamps).length ? timestamps : undefined;
}

function createActivityAssets(bigIcon, poweredBy, statusImage, statusName) {
    const assets = {};
    if (bigIcon) {
        assets.large_image = bigIcon;
    }
    if (poweredBy) {
        assets.large_text = poweredBy;
    }
    if (statusImage) {
        assets.small_image = statusImage;
    }
    if (statusName) {
        assets.small_text = statusName;
    }
    return Object.keys(assets).length ? assets : undefined;
}

function createActivityParty(partyId, partySize, partyMaxSize) {
    if (!partyId || partySize <= 0 || partyMaxSize <= 0) {
        return undefined;
    }
    return {
        id: partyId,
        size: [partySize, partyMaxSize]
    };
}

function createActivityButtons(buttonText, buttonUrl) {
    if (!buttonText || !buttonUrl) {
        return undefined;
    }
    return [
        {
            label: buttonText,
            url: buttonUrl
        }
    ];
}

function compactObject(value) {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== '')
    );
}

async function createTranslator() {
    const pairs = await Promise.all(
        i18nKeys.map(async (key) => [key, await translateCurrentLocale(key)])
    );
    const labels = Object.fromEntries(pairs);
    return (key) => labels[key] ?? key;
}

async function loadDiscordConfig() {
    const [
        discordActive,
        discordInstance,
        discordHideInvite,
        discordJoinButton,
        discordHideImage,
        discordShowPlatform,
        discordWorldIntegration,
        discordWorldNameAsDiscordStatus
    ] = await Promise.all([
        configRepository.getBool('discordActive', false),
        configRepository.getBool('discordInstance', true),
        configRepository.getBool('discordHideInvite', true),
        configRepository.getBool('discordJoinButton', false),
        configRepository.getBool('discordHideImage', false),
        configRepository.getBool('discordShowPlatform', true),
        configRepository.getBool('discordWorldIntegration', true),
        configRepository.getBool('discordWorldNameAsDiscordStatus', false)
    ]);

    return {
        discordActive,
        discordInstance,
        discordHideInvite,
        discordJoinButton,
        discordHideImage,
        discordShowPlatform,
        discordWorldIntegration,
        discordWorldNameAsDiscordStatus
    };
}

function getCurrentLocationContext(runtimeState, currentUser) {
    let currentLocation = normalizeString(runtimeState.gameState.currentLocation);
    let startTime = runtimeState.gameState.currentLocationStartedAt;
    if (currentLocation === 'traveling') {
        currentLocation = normalizeString(runtimeState.gameState.currentDestination);
        startTime = runtimeState.gameState.currentLocationStartedAt;
    }

    if (!currentLocation) {
        currentLocation = normalizeString(
            currentUser?.$locationTag ||
            currentUser?.location ||
            currentUser?.worldId
        );
        startTime = currentUser?.$location_at || currentUser?.locationAt || currentUser?.updated_at || '';
        const travelingToLocation = normalizeString(
            currentUser?.$travelingToLocation ||
            currentUser?.travelingToLocation
        );
        if (travelingToLocation) {
            currentLocation = travelingToLocation;
        }
    }

    return { currentLocation, startTime };
}

async function setDiscordActiveState(active) {
    if (active === isDiscordActive) {
        return isDiscordActive;
    }
    try {
        isDiscordActive = Boolean(await backend.discord.SetActive(active));
        return isDiscordActive;
    } catch (error) {
        isDiscordActive = false;
        useRuntimeStore.getState().setUpdateLoopState({
            lastDiscordPresenceAt: new Date().toISOString(),
            lastDiscordPresenceDetail: error instanceof Error ? error.message : String(error)
        });
        return false;
    }
}

async function loadLocationDetails(currentLocation, endpoint) {
    if (currentLocation === lastLocationDetails.tag && lastLocationDetails.parsed) {
        return lastLocationDetails;
    }

    const parsed = parseLocation(currentLocation);
    const details = {
        ...createEmptyLocationDetails(),
        tag: parsed.tag,
        parsed
    };

    if (parsed.worldId) {
        try {
            const world = await worldProfileRepository.getWorldProfile({
                worldId: parsed.worldId,
                endpoint
            });
            details.worldName = world.name || parsed.worldId;
            details.thumbnailImageUrl = world.thumbnailImageUrl || world.imageUrl || '';
            details.worldCapacity = Number(world.capacity) || 0;
            details.worldLink = world.releaseStatus === 'public'
                ? `https://vrchat.com/home/world/${parsed.worldId}`
                : '';
        } catch (error) {
            console.warn(`Failed to get world details for ${parsed.worldId}`, error);
            details.worldName = parsed.worldId;
        }
    }

    if (parsed.groupId) {
        try {
            const group = await groupProfileRepository.getGroupProfile({
                groupId: parsed.groupId,
                endpoint,
                includeRoles: false
            });
            details.groupName = group.name || '';
        } catch (error) {
            console.warn(`Failed to get group details for ${parsed.groupId}`, error);
        }
    }

    lastLocationDetails = details;
    return details;
}

function getGroupAccessName(parsed, t) {
    if (parsed.groupAccessType === 'public') {
        return t('dialog.new_instance.group_access_type_public');
    }
    if (parsed.groupAccessType === 'plus') {
        return t('dialog.new_instance.group_access_type_plus');
    }
    return '';
}

function buildAccessName({ parsed, groupName, platform, t }) {
    switch (parsed.accessType) {
        case 'public':
            return `${t('dialog.new_instance.access_type_public')} #${parsed.instanceName}${platform}`;
        case 'invite+':
            return `${t('dialog.new_instance.access_type_invite_plus')} #${parsed.instanceName}${platform}`;
        case 'invite':
            return `${t('dialog.new_instance.access_type_invite')} #${parsed.instanceName}${platform}`;
        case 'friends':
            return `${t('dialog.new_instance.access_type_friend')} #${parsed.instanceName}${platform}`;
        case 'friends+':
            return `${t('dialog.new_instance.access_type_friend_plus')} #${parsed.instanceName}${platform}`;
        case 'group': {
            const groupAccessName = getGroupAccessName(parsed, t);
            const suffix = groupName ? ` ${groupAccessName}(${groupName})` : groupAccessName ? ` ${groupAccessName}` : '';
            return `${t('dialog.new_instance.access_type_group')}${suffix} #${parsed.instanceName}${platform}`;
        }
        default:
            return '';
    }
}

async function getPartySize({ currentUserId, currentLocation }) {
    try {
        const snapshot = await playerListRepository.getCurrentInstanceSnapshot({
            currentUserId,
            currentLocation
        });
        return Array.isArray(snapshot.players) ? snapshot.players.length : 0;
    } catch {
        return 0;
    }
}

function getNowPlayingTimes(nowPlaying) {
    if (!nowPlaying?.url && !nowPlaying?.name) {
        return { startTime: 0, endTime: 0 };
    }
    const startSeconds = timestampSeconds(nowPlaying.startedAt);
    if (!startSeconds) {
        return { startTime: 0, endTime: 0 };
    }
    const length = Number(nowPlaying.length) || 0;
    return {
        startTime: startSeconds,
        endTime: length > 0 ? startSeconds + length : 0
    };
}

export function invalidateDiscordPresenceCache() {
    lastLocationDetails = createEmptyLocationDetails();
}

export async function refreshDiscordPresence({ force = false } = {}) {
    if (force) {
        invalidateDiscordPresenceCache();
    }

    const config = await loadDiscordConfig();
    const runtimeState = useRuntimeStore.getState();
    const auth = runtimeState.auth;
    const currentUser = auth.currentUserSnapshot;
    const { currentLocation, startTime: rawStartTime } = getCurrentLocationContext(runtimeState, currentUser);

    if (!config.discordActive || !isRealInstance(currentLocation)) {
        await setDiscordActiveState(false);
        return;
    }

    const t = await createTranslator();
    const locationDetails = await loadLocationDetails(currentLocation, auth.currentUserEndpoint);
    const parsed = locationDetails.parsed;
    if (!parsed) {
        await setDiscordActiveState(false);
        return;
    }

    const platform = config.discordShowPlatform
        ? getPlatformLabel(
            currentUser?.presence?.platform || currentUser?.platform || currentUser?.last_platform || '',
            Boolean(runtimeState.gameState.isGameRunning),
            Boolean(runtimeState.gameState.isGameNoVR),
            t
        )
        : '';
    const accessName = buildAccessName({
        parsed,
        groupName: locationDetails.groupName,
        platform,
        t
    });

    await setDiscordActiveState(true);

    let hidePrivate = false;
    if (
        config.discordHideInvite &&
        (parsed.accessType === 'invite' ||
            parsed.accessType === 'invite+' ||
            parsed.groupAccessType === 'members')
    ) {
        hidePrivate = true;
    }

    const statusInfo = getStatusInfo(currentUser?.status, config.discordHideInvite, t);
    if (statusInfo.hidePrivate) {
        hidePrivate = true;
    }

    let details = locationDetails.worldName || parsed.worldId || 'VRChat';
    let stateText = accessName;
    let startTime = rawStartTime;
    let endTime = 0;
    let activityType = ActivityType.Playing;
    let statusDisplayType = config.discordWorldNameAsDiscordStatus
        ? StatusDisplayType.Details
        : StatusDisplayType.Name;
    let appId = DEFAULT_APP_ID;
    let bigIcon = 'vrchat';
    let detailsUrl = locationDetails.worldLink;
    const poweredBy = t('view.settings.discord_presence.rpc.powered_by_vrcx');
    let partyId = `${parsed.worldId}:${parsed.instanceName}`;
    let partySize = await getPartySize({
        currentUserId: auth.currentUserId,
        currentLocation
    });
    let partyMaxSize = locationDetails.worldCapacity;
    if (partySize > partyMaxSize) {
        partyMaxSize = partySize;
    }
    if (partySize === 0) {
        partyMaxSize = 0;
    }
    if (!config.discordInstance) {
        partySize = 0;
        partyMaxSize = 0;
        stateText = '';
    }

    let buttonText = 'Join';
    let buttonUrl = parsed.accessType === 'public' ? getLaunchURL(parsed) : '';
    if (!config.discordJoinButton) {
        buttonText = '';
        buttonUrl = '';
    }

    const rpcConfig = config.discordWorldIntegration
        ? getRpcWorldConfig(parsed.worldId)
        : null;
    if (rpcConfig) {
        activityType = rpcConfig.activityType;
        statusDisplayType = rpcConfig.statusDisplayType;
        appId = rpcConfig.appId;
        bigIcon = rpcConfig.bigIcon;
        if (
            isPopcornPalaceWorld(parsed.worldId) &&
            !config.discordHideImage &&
            runtimeState.nowPlaying.thumbnailUrl
        ) {
            bigIcon = runtimeState.nowPlaying.thumbnailUrl;
        }
        if (runtimeState.nowPlaying.name) {
            details = runtimeState.nowPlaying.name;
        }
        if (runtimeState.nowPlaying.url || runtimeState.nowPlaying.name) {
            const playingTimes = getNowPlayingTimes(runtimeState.nowPlaying);
            startTime = playingTimes.startTime;
            endTime = playingTimes.endTime;
        }
    } else if (!config.discordHideImage && locationDetails.thumbnailImageUrl) {
        bigIcon = locationDetails.thumbnailImageUrl;
    }

    if (hidePrivate) {
        partyId = '';
        partySize = 0;
        partyMaxSize = 0;
        buttonText = '';
        buttonUrl = '';
        detailsUrl = '';
        details = t('view.settings.discord_presence.rpc.private_world');
        stateText = '';
        startTime = 0;
        endTime = 0;
        appId = DEFAULT_APP_ID;
        bigIcon = 'vrchat';
        activityType = ActivityType.Playing;
        statusDisplayType = StatusDisplayType.Name;
    }

    if (details.length < 2) {
        details += '\uFFA0'.repeat(2 - details.length);
    }

    const activity = compactObject({
        type: activityType,
        name: details || 'VRChat',
        details,
        details_url: detailsUrl,
        state: stateText,
        status_display_type: statusDisplayType,
        timestamps: createActivityTimestamps(startTime, endTime),
        assets: createActivityAssets(bigIcon, poweredBy, statusInfo.statusImage, statusInfo.statusName),
        party: createActivityParty(partyId, partySize, partyMaxSize),
        buttons: createActivityButtons(buttonText, buttonUrl)
    });

    try {
        isDiscordActive = Boolean(await backend.discord.SetAssets({ appId, activity }));
        useRuntimeStore.getState().setUpdateLoopState({
            lastDiscordPresenceAt: new Date().toISOString(),
            lastDiscordPresenceDetail: `${details}${stateText ? ` - ${stateText}` : ''}`
        });
    } catch (error) {
        isDiscordActive = false;
        useRuntimeStore.getState().setUpdateLoopState({
            lastDiscordPresenceAt: new Date().toISOString(),
            lastDiscordPresenceDetail: error instanceof Error ? error.message : String(error)
        });
    }
}

export async function disableDiscordPresence() {
    invalidateDiscordPresenceCache();
    await setDiscordActiveState(false);
}
