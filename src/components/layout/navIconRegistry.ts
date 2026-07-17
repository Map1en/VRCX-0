import { CircleIcon } from 'lucide-react';
import React from 'react';

import * as Icon from '@/components/Icon';
import {
    DEFAULT_NAV_ICON_KEY,
    normalizeNavIconKey
} from '@/shared/constants/navIcons';

const navIconComponentByName: Record<string, React.ComponentType<any>> = {
    Activity: Icon.Activity,
    Archive: Icon.Archive,
    Bell: Icon.Bell,
    BookOpen: Icon.BookOpen,
    Bot: Icon.Bot,
    Box: Icon.Box,
    Boxes: Icon.Boxes,
    CalendarDays: Icon.CalendarDays,
    Camera: Icon.Camera,
    ChartBar: Icon.ChartBar,
    Circle: Icon.Circle,
    Compass: Icon.Compass,
    Contact: Icon.Contact,
    ContactRound: Icon.ContactRound,
    Cuboid: Icon.Cuboid,
    DatabaseBackup: Icon.DatabaseBackup,
    Database: Icon.Database,
    Download: Icon.Download,
    FileText: Icon.Doc,
    Folder: Icon.Folder,
    Gamepad2: Icon.Gamepad2,
    Gauge: Icon.Gauge,
    Globe: Icon.Globe,
    Heart: Icon.Heart,
    History: Icon.History,
    House: Icon.House,
    Image: Icon.Image,
    Images: Icon.Images,
    LayoutDashboard: Icon.LayoutDashboard,
    List: Icon.List,
    MapPinned: Icon.MapPinned,
    MapPin: Icon.Location,
    MessageSquareText: Icon.MessageSquareText,
    Package: Icon.Package,
    Palette: Icon.Palette,
    PanelLeft: Icon.PanelLeft,
    PersonStanding: Icon.Avatar,
    Rocket: Icon.Rocket,
    Rss: Icon.Rss,
    Search: Icon.Search,
    ServerCog: Icon.ServerCog,
    Settings: Icon.Settings,
    ShieldAlert: Icon.ShieldAlert,
    ShieldUser: Icon.ShieldUser,
    SlidersHorizontal: Icon.SlidersHorizontal,
    Smile: Icon.Smile,
    SquareTerminal: Icon.SquareTerminal,
    Star: Icon.Star,
    Tags: Icon.Tags,
    TextSearch: Icon.TextSearch,
    UserRound: Icon.UserRound,
    UserStar: Icon.UserStar,
    Users: Icon.Users,
    UsersRound: Icon.UsersRound,
    Wrench: Icon.Wrench
};

function extractLucideIconName(value: unknown): string {
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
    const name = extractLucideIconName(normalized);
    return navIconComponentByName[name] || CircleIcon;
}
