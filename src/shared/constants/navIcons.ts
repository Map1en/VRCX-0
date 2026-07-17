export const DEFAULT_NAV_ICON_KEY = 'Circle';
export const DEFAULT_FOLDER_ICON = 'Folder';

export type NavIconKey = string;

export interface NavIconOption {
    key: string;
    label: string;
}

const navIconEntries: Array<readonly [NavIconKey, string]> = [
    ['Circle', 'Circle'],
    ['Feed', 'Feed'],
    ['Location', 'Location'],
    ['GameLog', 'Game Log'],
    ['InstanceHistory', 'Instance History'],
    ['Gamepad2', 'Gamepad'],
    ['Players', 'Players'],
    ['Search', 'Search'],
    ['Heart', 'Heart'],
    ['FavoriteFriends', 'Favorite Friends'],
    ['Globe', 'Globe'],
    ['FavoriteWorlds', 'Favorite Worlds'],
    ['Smile', 'Smile'],
    ['Box', 'Model'],
    ['Cuboid', '3D Model'],
    ['Boxes', 'Model Library'],
    ['FriendLog', 'Friend Log'],
    ['ContactRound', 'Round Contact'],
    ['FavoriteAvatars', 'Favorite Avatars'],
    ['FriendList', 'Friend List'],
    ['ShieldAlert', 'Shield Alert'],
    ['Moderation', 'Moderation'],
    ['Notification', 'Notification'],
    ['SteamScreenshots', 'Steam Screenshots'],
    ['ChartBar', 'Chart'],
    ['ChartsMutual', 'Charts Mutual'],
    ['Tools', 'Tools'],
    ['DashboardDefault', 'Dashboard Default'],
    ['Folder', 'Folder'],
    ['LayoutDashboard', 'Dashboard'],
    ['ScreenshotMetadata', 'Screenshot Metadata'],
    ['Gallery', 'Gallery'],
    ['VrcxData', 'VRCX Data'],
    ['ProfileBackup', 'Profile Backup'],
    ['VrchatData', 'VRChat Data'],
    ['CrashDumps', 'Crash Dumps'],
    ['Inventory', 'Inventory'],
    ['VrchatConfig', 'VRChat Config'],
    ['LaunchOptions', 'Launch Options'],
    ['AutoChangeStatus', 'Auto Change Status'],
    ['PresenceSchedule', 'Presence Schedule'],
    ['VrchatLog', 'VRChat Log'],
    ['ExportOwnAvatars', 'Export Own Avatars'],
    ['PresenceInviteRequests', 'Presence Invite Requests'],
    ['Settings', 'Settings'],
    ['House', 'Home'],
    ['Compass', 'Compass'],
    ['Tags', 'Tags'],
    ['UserRound', 'User'],
    ['Activity', 'Activity'],
    ['AppLauncher', 'App Launcher'],
    ['Gauge', 'Gauge'],
    ['List', 'List'],
    ['PanelLeft', 'Panel']
];

const navIconNames = new Set(navIconEntries.map(([key]) => key));

export const NAV_ICON_OPTIONS: NavIconOption[] = navIconEntries.map(
    ([key, label]) => ({
        key,
        label
    })
);

function extractIconName(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    const rawName = trimmed.startsWith('lucide:')
        ? trimmed.slice('lucide:'.length)
        : trimmed;
    return rawName.endsWith('Icon') ? rawName.slice(0, -4) : rawName;
}

export function normalizeNavIconKey(
    value: unknown,
    fallback: unknown = DEFAULT_NAV_ICON_KEY
): string {
    const name = extractIconName(value);
    if (name && navIconNames.has(name)) {
        return name;
    }

    const fallbackName = extractIconName(fallback);
    if (fallbackName && navIconNames.has(fallbackName)) {
        return fallbackName;
    }

    return '';
}
