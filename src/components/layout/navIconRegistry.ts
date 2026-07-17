import { CircleIcon } from 'lucide-react';
import React from 'react';

import * as Icon from '@/components/Icon';
import {
    DEFAULT_NAV_ICON_KEY,
    normalizeNavIconKey
} from '@/shared/constants/navIcons';

const navIconComponentByName: Record<string, React.ComponentType<any>> = {
    Feed: Icon.Feed,
    Location: Icon.Location,
    GameLog: Icon.GameLog,
    InstanceHistory: Icon.InstanceHistory,
    Gamepad2: Icon.Gamepad2,
    Players: Icon.Players,
    Search: Icon.Search,
    Heart: Icon.Heart,
    FavoriteFriends: Icon.FavoriteFriends,
    Globe: Icon.Globe,
    FavoriteWorlds: Icon.FavoriteWorlds,
    Smile: Icon.Smile,
    Box: Icon.Box,
    Cuboid: Icon.Cuboid,
    Boxes: Icon.Boxes,
    FriendLog: Icon.FriendLog,
    ContactRound: Icon.ContactRound,
    FavoriteAvatars: Icon.FavoriteAvatars,
    FriendList: Icon.FriendList,
    ShieldAlert: Icon.ShieldAlert,
    Moderation: Icon.Moderation,
    Notification: Icon.Notification,
    SteamScreenshots: Icon.SteamScreenshots,
    ChartBar: Icon.ChartBar,
    ChartsMutual: Icon.ChartsMutual,
    Tools: Icon.Tools,
    DashboardDefault: Icon.DashboardDefault,
    Folder: Icon.Folder,
    LayoutDashboard: Icon.LayoutDashboard,
    ScreenshotMetadata: Icon.ScreenshotMetadata,
    Gallery: Icon.Gallery,
    VrcxData: Icon.VrcxData,
    ProfileBackup: Icon.ProfileBackup,
    VrchatData: Icon.VrchatData,
    CrashDumps: Icon.CrashDumps,
    Inventory: Icon.Inventory,
    VrchatConfig: Icon.VrchatConfig,
    LaunchOptions: Icon.LaunchOptions,
    AutoChangeStatus: Icon.AutoChangeStatus,
    PresenceSchedule: Icon.PresenceSchedule,
    VrchatLog: Icon.VrchatLog,
    ExportOwnAvatars: Icon.ExportOwnAvatars,
    PresenceInviteRequests: Icon.PresenceInviteRequests,
    Settings: Icon.Settings,
    House: Icon.House,
    Compass: Icon.Compass,
    Tags: Icon.Tags,
    UserRound: Icon.UserRound,
    Activity: Icon.Activity,
    AppLauncher: Icon.AppLauncher,
    Gauge: Icon.Gauge,
    List: Icon.List,
    PanelLeft: Icon.PanelLeft,
    Circle: Icon.Circle,
    LogIn: Icon.LogIn,
    LogOut: Icon.LogOut,
    Status: Icon.Status,
    Avatar: Icon.Avatar,
    Doc: Icon.Doc,
    Users: Icon.Users,
    Video: Icon.Video,
    Star: Icon.Star
};

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

export function getNavIconComponent(
    value: unknown,
    fallback: unknown = DEFAULT_NAV_ICON_KEY
): React.ComponentType<any> {
    const normalized = normalizeNavIconKey(value, fallback);
    const name = extractIconName(normalized);
    return navIconComponentByName[name] || CircleIcon;
}
