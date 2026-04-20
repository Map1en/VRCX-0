import {
    ActivityIcon,
    ArchiveIcon,
    BellIcon,
    BookOpenIcon,
    BotIcon,
    CalendarDaysIcon,
    CameraIcon,
    ChartBarIcon,
    CircleIcon,
    CompassIcon,
    ContactIcon,
    DatabaseIcon,
    DownloadIcon,
    FileTextIcon,
    FolderIcon,
    Gamepad2Icon,
    GaugeIcon,
    GlobeIcon,
    HeartIcon,
    HistoryIcon,
    HouseIcon,
    ImageIcon,
    ImagesIcon,
    LayoutDashboardIcon,
    ListIcon,
    MapPinIcon,
    MessageSquareTextIcon,
    PanelLeftIcon,
    RocketIcon,
    RssIcon,
    SearchIcon,
    ServerCogIcon,
    SettingsIcon,
    ShieldAlertIcon,
    SlidersHorizontalIcon,
    SmileIcon,
    SquareTerminalIcon,
    StarIcon,
    TagsIcon,
    UserRoundIcon,
    UsersIcon,
    WrenchIcon
} from 'lucide-react';

const LUCIDE_ICON_PREFIX = 'lucide:';

export const DEFAULT_NAV_ICON_KEY = 'lucide:Circle';
export const DEFAULT_FOLDER_ICON = 'lucide:Folder';

const navIconEntries = [
    ['lucide:Circle', 'Circle', CircleIcon],
    ['lucide:Rss', 'RSS', RssIcon],
    ['lucide:MapPin', 'Map Pin', MapPinIcon],
    ['lucide:History', 'History', HistoryIcon],
    ['lucide:Gamepad2', 'Gamepad', Gamepad2Icon],
    ['lucide:Search', 'Search', SearchIcon],
    ['lucide:Heart', 'Heart', HeartIcon],
    ['lucide:Globe', 'Globe', GlobeIcon],
    ['lucide:Smile', 'Smile', SmileIcon],
    ['lucide:Contact', 'Contact', ContactIcon],
    ['lucide:BookOpen', 'Book', BookOpenIcon],
    ['lucide:ShieldAlert', 'Shield', ShieldAlertIcon],
    ['lucide:Bell', 'Bell', BellIcon],
    ['lucide:Image', 'Image', ImageIcon],
    ['lucide:ChartBar', 'Chart', ChartBarIcon],
    ['lucide:Users', 'Users', UsersIcon],
    ['lucide:Wrench', 'Tools', WrenchIcon],
    ['lucide:Star', 'Star', StarIcon],
    ['lucide:Folder', 'Folder', FolderIcon],
    ['lucide:LayoutDashboard', 'Dashboard', LayoutDashboardIcon],
    ['lucide:Camera', 'Camera', CameraIcon],
    ['lucide:Images', 'Images', ImagesIcon],
    ['lucide:Database', 'Database', DatabaseIcon],
    ['lucide:ServerCog', 'Server', ServerCogIcon],
    ['lucide:Archive', 'Archive', ArchiveIcon],
    ['lucide:SlidersHorizontal', 'Sliders', SlidersHorizontalIcon],
    ['lucide:SquareTerminal', 'Terminal', SquareTerminalIcon],
    ['lucide:Bot', 'Bot', BotIcon],
    ['lucide:CalendarDays', 'Calendar', CalendarDaysIcon],
    ['lucide:FileText', 'File Text', FileTextIcon],
    ['lucide:Download', 'Download', DownloadIcon],
    ['lucide:MessageSquareText', 'Message', MessageSquareTextIcon],
    ['lucide:Settings', 'Settings', SettingsIcon],
    ['lucide:House', 'Home', HouseIcon],
    ['lucide:Compass', 'Compass', CompassIcon],
    ['lucide:Tags', 'Tags', TagsIcon],
    ['lucide:UserRound', 'User', UserRoundIcon],
    ['lucide:Activity', 'Activity', ActivityIcon],
    ['lucide:Rocket', 'Rocket', RocketIcon],
    ['lucide:Gauge', 'Gauge', GaugeIcon],
    ['lucide:List', 'List', ListIcon],
    ['lucide:PanelLeft', 'Panel', PanelLeftIcon]
];

const navIconComponentByName = Object.fromEntries(
    navIconEntries.map(([key, , icon]) => [
        key.slice(LUCIDE_ICON_PREFIX.length),
        icon
    ])
);

export const NAV_ICON_OPTIONS = navIconEntries.map(([key, label]) => ({
    key,
    label
}));

function extractLucideIconName(value) {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    const rawName = trimmed.startsWith(LUCIDE_ICON_PREFIX)
        ? trimmed.slice(LUCIDE_ICON_PREFIX.length)
        : trimmed;
    return rawName.endsWith('Icon') ? rawName.slice(0, -4) : rawName;
}

export function normalizeNavIconKey(value, fallback = DEFAULT_NAV_ICON_KEY) {
    const name = extractLucideIconName(value);
    if (name && navIconComponentByName[name]) {
        return `${LUCIDE_ICON_PREFIX}${name}`;
    }

    const fallbackName = extractLucideIconName(fallback);
    if (fallbackName && navIconComponentByName[fallbackName]) {
        return `${LUCIDE_ICON_PREFIX}${fallbackName}`;
    }

    return '';
}

export function getNavIconComponent(value, fallback = DEFAULT_NAV_ICON_KEY) {
    const normalized = normalizeNavIconKey(value, fallback);
    const name = extractLucideIconName(normalized);
    return navIconComponentByName[name] || CircleIcon;
}
