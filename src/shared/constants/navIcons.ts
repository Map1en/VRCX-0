const LUCIDE_ICON_PREFIX = 'lucide:';

export const DEFAULT_NAV_ICON_KEY = 'lucide:Circle';
export const DEFAULT_FOLDER_ICON = 'lucide:Folder';

export type NavIconKey = `${typeof LUCIDE_ICON_PREFIX}${string}`;

export interface NavIconOption {
    key: string;
    label: string;
}

const navIconEntries: Array<readonly [NavIconKey, string]> = [
    ['lucide:Circle', 'Circle'],
    ['lucide:Rss', 'RSS'],
    ['lucide:MapPin', 'Map Pin'],
    ['lucide:History', 'History'],
    ['lucide:TextSearch', 'Text Search'],
    ['lucide:Gamepad2', 'Gamepad'],
    ['lucide:UsersRound', 'Room Players'],
    ['lucide:Search', 'Search'],
    ['lucide:Heart', 'Heart'],
    ['lucide:UserStar', 'Favorite User'],
    ['lucide:Globe', 'Globe'],
    ['lucide:MapPinned', 'Map'],
    ['lucide:Smile', 'Smile'],
    ['lucide:Box', 'Model'],
    ['lucide:Cuboid', '3D Model'],
    ['lucide:Boxes', 'Model Library'],
    ['lucide:Contact', 'Contact'],
    ['lucide:ContactRound', 'Round Contact'],
    ['lucide:PersonStanding', 'Person Standing'],
    ['lucide:BookOpen', 'Book'],
    ['lucide:ShieldAlert', 'Shield'],
    ['lucide:ShieldUser', 'Moderation'],
    ['lucide:Bell', 'Bell'],
    ['lucide:Image', 'Image'],
    ['lucide:ChartBar', 'Chart'],
    ['lucide:Users', 'Users'],
    ['lucide:Wrench', 'Tools'],
    ['lucide:Star', 'Star'],
    ['lucide:Folder', 'Folder'],
    ['lucide:LayoutDashboard', 'Dashboard'],
    ['lucide:Camera', 'Camera'],
    ['lucide:Images', 'Images'],
    ['lucide:Database', 'Database'],
    ['lucide:ServerCog', 'Server'],
    ['lucide:Archive', 'Archive'],
    ['lucide:Package', 'Package'],
    ['lucide:SlidersHorizontal', 'Sliders'],
    ['lucide:SquareTerminal', 'Terminal'],
    ['lucide:Bot', 'Bot'],
    ['lucide:CalendarDays', 'Calendar'],
    ['lucide:FileText', 'File Text'],
    ['lucide:Download', 'Download'],
    ['lucide:MessageSquareText', 'Message'],
    ['lucide:Settings', 'Settings'],
    ['lucide:House', 'Home'],
    ['lucide:Compass', 'Compass'],
    ['lucide:Tags', 'Tags'],
    ['lucide:UserRound', 'User'],
    ['lucide:Activity', 'Activity'],
    ['lucide:Rocket', 'Rocket'],
    ['lucide:Gauge', 'Gauge'],
    ['lucide:List', 'List'],
    ['lucide:PanelLeft', 'Panel']
];

const navIconNames = new Set(
    navIconEntries.map(([key]) => key.slice(LUCIDE_ICON_PREFIX.length))
);

export const NAV_ICON_OPTIONS: NavIconOption[] = navIconEntries.map(([key, label]) => ({
    key,
    label
}));

function extractLucideIconName(value: unknown): string {
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

export function normalizeNavIconKey(
    value: unknown,
    fallback: unknown = DEFAULT_NAV_ICON_KEY
): string {
    const name = extractLucideIconName(value);
    if (name && navIconNames.has(name)) {
        return `${LUCIDE_ICON_PREFIX}${name}`;
    }

    const fallbackName = extractLucideIconName(fallback);
    if (fallbackName && navIconNames.has(fallbackName)) {
        return `${LUCIDE_ICON_PREFIX}${fallbackName}`;
    }

    return '';
}
