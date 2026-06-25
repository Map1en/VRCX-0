import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import playerListPersistenceRepository from '@/repositories/playerListPersistenceRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { ActivityType, StatusDisplayType } from '@/shared/constants/discord';
import type {
    ActivityTypeValue,
    StatusDisplayTypeValue
} from '@/shared/constants/discord';
import {
    getPlatformLabel,
    getRpcWorldConfig,
    getStatusInfo,
    isPopcornPalaceWorld
} from '@/shared/utils/discordPresence';
import { getLaunchURL, isRealInstance } from '@/shared/utils/instance';
import { normalizeLocationValue } from '@/shared/utils/location';
import { parseLocation } from '@/shared/utils/location';
import { useRuntimeStore } from '@/state/runtimeStore';

import i18n from './i18nService';

const DEFAULT_APP_ID = '1510639562177642557';
const GAME_STOP_DISCORD_CLOSE_ATTEMPTS = 5;
type RuntimeState = ReturnType<typeof useRuntimeStore.getState>;
type CurrentUserSnapshot = RuntimeState['auth']['currentUserSnapshot'];
type ParsedLocation = ReturnType<typeof parseLocation>;
type DiscordPresenceOptions = {
    force?: boolean;
};
type DiscordConfig = {
    discordActive: boolean;
    discordInstance: boolean;
    discordHideInvite: boolean;
    discordJoinButton: boolean;
    discordHideImage: boolean;
    discordShowPlatform: boolean;
    discordWorldIntegration: boolean;
    discordWorldNameAsDiscordStatus: boolean;
};
type LocationDetails = {
    tag: string;
    parsed: ParsedLocation | null;
    worldName: string;
    thumbnailImageUrl: string;
    worldCapacity: number;
    worldLink: string;
    groupName: string;
};
type DiscordActivityPayload = Record<string, unknown>;
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
    'view.settings.discord_presence.rpc.private_world'
];

let isDiscordActive = false;
let lastLocationDetails = createEmptyLocationDetails();
let gameStopDiscordCloseAttemptsRemaining = 0;

function createEmptyLocationDetails(): LocationDetails {
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

function timestampSeconds(value: unknown) {
    if (!value) {
        return 0;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 10_000_000_000
            ? Math.floor(value / 1000)
            : Math.floor(value);
    }
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function createActivityTimestamps(startTime: unknown, endTime: unknown = 0) {
    const timestamps: Record<string, number> = {};
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

function clampGameSessionStartTime(
    runtimeState: RuntimeState,
    startTime: unknown
) {
    if (!runtimeState.gameState.isGameRunning) {
        return startTime;
    }

    const gameStartedAt = runtimeState.gameState.lastGameStartedAt;
    const gameStartedAtSeconds = timestampSeconds(gameStartedAt);
    if (!gameStartedAtSeconds) {
        return startTime;
    }

    const startTimeSeconds = timestampSeconds(startTime);
    if (!startTimeSeconds || startTimeSeconds < gameStartedAtSeconds) {
        return gameStartedAt;
    }
    return startTime;
}

function createActivityAssets(
    bigIcon: unknown,
    statusImage: unknown,
    statusName: unknown
) {
    const assets: Record<string, unknown> = {};
    if (bigIcon) {
        assets.large_image = bigIcon;
    }
    if (statusImage) {
        assets.small_image = statusImage;
    }
    if (statusName) {
        assets.small_text = statusName;
    }
    return Object.keys(assets).length ? assets : undefined;
}

function createActivityParty(
    partyId: unknown,
    partySize: number,
    partyMaxSize: number
) {
    if (!partyId || partySize <= 0 || partyMaxSize <= 0) {
        return undefined;
    }
    return {
        id: partyId,
        size: [partySize, partyMaxSize]
    };
}

function createActivityButtons(buttonText: unknown, buttonUrl: unknown) {
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

function compactObject(value: Record<string, unknown>) {
    return Object.fromEntries(
        Object.entries(value).filter(
            ([, entry]) => entry !== undefined && entry !== null && entry !== ''
        )
    );
}

async function createTranslator() {
    const pairs = await Promise.all(
        i18nKeys.map(async (key) => [key, await i18n.t(key)] as const)
    );
    const labels = Object.fromEntries(pairs);
    return (key: string) => labels[key] ?? key;
}

async function loadDiscordConfig(): Promise<DiscordConfig> {
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

function getCurrentLocationContext(
    runtimeState: RuntimeState,
    currentUser: CurrentUserSnapshot
) {
    let currentLocation = normalizeLocationValue(
        runtimeState.gameState.currentLocation
    );
    let startTime = runtimeState.gameState.currentLocationStartedAt;
    if (currentLocation === 'traveling') {
        currentLocation = normalizeLocationValue(
            runtimeState.gameState.currentDestination
        );
        startTime = runtimeState.gameState.currentLocationStartedAt;
    }

    if (!currentLocation) {
        currentLocation = normalizeLocationValue(
            currentUser?.$locationTag ||
                currentUser?.location ||
                currentUser?.worldId
        );
        startTime = String(
            currentUser?.$location_at ||
                currentUser?.locationAt ||
                currentUser?.updated_at ||
                ''
        ).trim();
        const travelingToLocation = normalizeLocationValue(
            currentUser?.$travelingToLocation ||
                currentUser?.travelingToLocation
        );
        if (travelingToLocation) {
            currentLocation = travelingToLocation;
        }
    }

    return {
        currentLocation,
        startTime: clampGameSessionStartTime(runtimeState, startTime)
    };
}

async function setDiscordActiveState(
    active: boolean,
    { force = false }: DiscordPresenceOptions = {}
) {
    if (!force && active === isDiscordActive) {
        return isDiscordActive;
    }
    try {
        isDiscordActive = Boolean(await commands.discordSetActive(active));
        return isDiscordActive;
    } catch (error) {
        isDiscordActive = false;
        useRuntimeStore.getState().setUpdateLoopState({
            lastDiscordPresenceAt: new Date().toISOString(),
            lastDiscordPresenceDetail:
                error instanceof Error ? error.message : String(error)
        });
        return false;
    }
}

async function loadLocationDetails(currentLocation: string, endpoint: string) {
    if (
        currentLocation === lastLocationDetails.tag &&
        lastLocationDetails.parsed
    ) {
        return lastLocationDetails;
    }

    const parsed = parseLocation(currentLocation);
    const details: LocationDetails = {
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
            details.thumbnailImageUrl =
                world.thumbnailImageUrl || world.imageUrl || '';
            details.worldCapacity = Number(world.capacity) || 0;
            details.worldLink =
                world.releaseStatus === 'public'
                    ? `https://vrchat.com/home/world/${parsed.worldId}`
                    : '';
        } catch (error) {
            console.warn(
                `Failed to get world details for ${parsed.worldId}`,
                error
            );
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
            console.warn(
                `Failed to get group details for ${parsed.groupId}`,
                error
            );
        }
    }

    lastLocationDetails = details;
    return details;
}

function getGroupAccessName(
    parsed: ParsedLocation,
    t: (key: string) => string
) {
    if (parsed.groupAccessType === 'public') {
        return t('dialog.new_instance.group_access_type_public');
    }
    if (parsed.groupAccessType === 'plus') {
        return t('dialog.new_instance.group_access_type_plus');
    }
    return '';
}

function buildAccessName({
    parsed,
    groupName,
    platform,
    t
}: {
    parsed: ParsedLocation;
    groupName: string;
    platform: string;
    t: (key: string) => string;
}) {
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
            const suffix = groupName
                ? ` ${groupAccessName}(${groupName})`
                : groupAccessName
                  ? ` ${groupAccessName}`
                  : '';
            return `${t('dialog.new_instance.access_type_group')}${suffix} #${parsed.instanceName}${platform}`;
        }
        default:
            return '';
    }
}

async function getPartySize({
    currentUserId,
    currentLocation,
    runtimeState
}: {
    currentUserId: string;
    currentLocation: string;
    runtimeState: RuntimeState;
}) {
    const runtimePartySize = Array.isArray(
        runtimeState?.gameState?.currentLocationPlayerIds
    )
        ? runtimeState.gameState.currentLocationPlayerIds.length
        : 0;

    try {
        const snapshot =
            await playerListPersistenceRepository.getCurrentInstanceSnapshot({
                currentUserId,
                currentLocation
            });
        const snapshotPartySize = Array.isArray(snapshot.players)
            ? snapshot.players.length
            : 0;
        return Math.max(runtimePartySize, snapshotPartySize);
    } catch {
        return runtimePartySize;
    }
}

function getNowPlayingTimes(nowPlaying: RuntimeState['nowPlaying']) {
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

async function publishDiscordActivity({
    appId = DEFAULT_APP_ID,
    activity,
    detail
}: {
    appId?: string;
    activity: DiscordActivityPayload;
    detail: string;
}) {
    try {
        isDiscordActive = Boolean(
            await commands.discordSetAssets({ appId, activity })
        );
        useRuntimeStore.getState().setUpdateLoopState({
            lastDiscordPresenceAt: new Date().toISOString(),
            lastDiscordPresenceDetail: detail
        });
    } catch (error) {
        isDiscordActive = false;
        useRuntimeStore.getState().setUpdateLoopState({
            lastDiscordPresenceAt: new Date().toISOString(),
            lastDiscordPresenceDetail:
                error instanceof Error ? error.message : String(error)
        });
    }
}

async function publishRunningFallbackPresence({
    config,
    currentUser,
    runtimeState
}: {
    config: DiscordConfig;
    currentUser: CurrentUserSnapshot;
    runtimeState: RuntimeState;
}) {
    const t = await createTranslator();
    const statusInfo = getStatusInfo(
        String(currentUser?.status || '').trim(),
        Boolean(config.discordHideInvite),
        t
    );
    const platform = config.discordShowPlatform
        ? getPlatformLabel(
              String(
                  currentUser?.presence?.platform ||
                      currentUser?.platform ||
                      currentUser?.last_platform ||
                      ''
              ).trim(),
              true,
              Boolean(runtimeState.gameState.isGameNoVR),
              t
          )
        : '';
    const details = 'VRChat';
    const stateText = platform.trim();
    const activity = compactObject({
        type: ActivityType.Playing,
        name: 'VRChat',
        details,
        state: stateText,
        status_display_type: StatusDisplayType.Name,
        timestamps: createActivityTimestamps(
            runtimeState.gameState.lastGameStartedAt
        ),
        assets: createActivityAssets(
            'vrchat',
            statusInfo.statusImage,
            statusInfo.statusName
        )
    });

    await publishDiscordActivity({
        activity,
        detail: `${details}${stateText ? ` - ${stateText}` : ''}`
    });
}

export function invalidateDiscordPresenceCache() {
    lastLocationDetails = createEmptyLocationDetails();
}

export function queueDiscordPresenceGameStopCloseAttempts() {
    gameStopDiscordCloseAttemptsRemaining = GAME_STOP_DISCORD_CLOSE_ATTEMPTS;
}

export async function runDiscordPresenceMaintenanceTick() {
    const runtimeState = useRuntimeStore.getState();
    if (
        runtimeState.gameState.isGameRunning !== true &&
        gameStopDiscordCloseAttemptsRemaining <= 0
    ) {
        return;
    }

    await refreshDiscordPresence();
}

export async function refreshDiscordPresence({
    force = false
}: DiscordPresenceOptions = {}) {
    if (force) {
        invalidateDiscordPresenceCache();
    }

    const runtimeState = useRuntimeStore.getState();
    if (runtimeState.gameState.isGameRunning !== true) {
        if (gameStopDiscordCloseAttemptsRemaining > 0) {
            gameStopDiscordCloseAttemptsRemaining -= 1;
            await setDiscordActiveState(false, { force: true });
            return;
        }

        await setDiscordActiveState(false);
        return;
    }
    gameStopDiscordCloseAttemptsRemaining = 0;

    const config = await loadDiscordConfig();
    const auth = runtimeState.auth;
    const currentUser = auth.currentUserSnapshot;
    const { currentLocation, startTime: rawStartTime } =
        getCurrentLocationContext(runtimeState, currentUser);

    if (!config.discordActive) {
        await setDiscordActiveState(false, { force });
        return;
    }
    if (!isRealInstance(currentLocation)) {
        await publishRunningFallbackPresence({
            config,
            currentUser,
            runtimeState
        });
        return;
    }

    const t = await createTranslator();
    const locationDetails = await loadLocationDetails(
        currentLocation,
        auth.currentUserEndpoint
    );
    const parsed = locationDetails.parsed;
    if (!parsed) {
        await setDiscordActiveState(false, { force });
        return;
    }

    const platform = config.discordShowPlatform
        ? getPlatformLabel(
              String(
                  currentUser?.presence?.platform ||
                      currentUser?.platform ||
                      currentUser?.last_platform ||
                      ''
              ).trim(),
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

    let hidePrivate = false;
    if (
        config.discordHideInvite &&
        (parsed.accessType === 'invite' ||
            parsed.accessType === 'invite+' ||
            parsed.groupAccessType === 'members')
    ) {
        hidePrivate = true;
    }

    const statusInfo = getStatusInfo(
        String(currentUser?.status || '').trim(),
        Boolean(config.discordHideInvite),
        t
    );
    if (statusInfo.hidePrivate) {
        hidePrivate = true;
    }

    let details = locationDetails.worldName || parsed.worldId || 'VRChat';
    let stateText = accessName;
    let startTime = rawStartTime;
    let endTime = 0;
    let activityType: ActivityTypeValue = ActivityType.Playing;
    let statusDisplayType: StatusDisplayTypeValue =
        config.discordWorldNameAsDiscordStatus
            ? StatusDisplayType.Details
            : StatusDisplayType.Name;
    let appId = DEFAULT_APP_ID;
    let bigIcon = 'vrchat';
    let detailsUrl = locationDetails.worldLink;
    let partyId = `${parsed.worldId}:${parsed.instanceName}`;
    let partySize = await getPartySize({
        currentUserId: auth.currentUserId || '',
        currentLocation,
        runtimeState
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
        name: 'VRChat',
        details,
        details_url: detailsUrl,
        state: stateText,
        status_display_type: statusDisplayType,
        timestamps: createActivityTimestamps(startTime, endTime),
        assets: createActivityAssets(
            bigIcon,
            statusInfo.statusImage,
            statusInfo.statusName
        ),
        party: createActivityParty(partyId, partySize, partyMaxSize),
        buttons: createActivityButtons(buttonText, buttonUrl)
    });

    await publishDiscordActivity({
        appId,
        activity,
        detail: `${details}${stateText ? ` - ${stateText}` : ''}`
    });
}

export async function disableDiscordPresence() {
    invalidateDiscordPresenceCache();
    await setDiscordActiveState(false, { force: true });
}
