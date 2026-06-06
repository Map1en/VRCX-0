import {
    ActivityIcon,
    ArchiveIcon,
    BellIcon,
    BookOpenIcon,
    BotIcon,
    BoxIcon,
    BoxesIcon,
    CalendarDaysIcon,
    CameraIcon,
    ChartBarIcon,
    CircleIcon,
    CompassIcon,
    ContactIcon,
    ContactRoundIcon,
    CuboidIcon,
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
    MapPinnedIcon,
    MapPinIcon,
    MessageSquareTextIcon,
    PackageIcon,
    PaletteIcon,
    PanelLeftIcon,
    PersonStandingIcon,
    RocketIcon,
    RssIcon,
    SearchIcon,
    ServerCogIcon,
    SettingsIcon,
    ShieldAlertIcon,
    ShieldUserIcon,
    SlidersHorizontalIcon,
    SmileIcon,
    SquareTerminalIcon,
    StarIcon,
    TagsIcon,
    TextSearchIcon,
    UserRoundIcon,
    UserStarIcon,
    UsersIcon,
    UsersRoundIcon,
    WrenchIcon
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import {
    DEFAULT_NAV_ICON_KEY,
    normalizeNavIconKey
} from '@/shared/constants/navIcons';

const navIconComponentByName: Record<string, LucideIcon> = {
    Activity: ActivityIcon,
    Archive: ArchiveIcon,
    Bell: BellIcon,
    BookOpen: BookOpenIcon,
    Bot: BotIcon,
    Box: BoxIcon,
    Boxes: BoxesIcon,
    CalendarDays: CalendarDaysIcon,
    Camera: CameraIcon,
    ChartBar: ChartBarIcon,
    Circle: CircleIcon,
    Compass: CompassIcon,
    Contact: ContactIcon,
    ContactRound: ContactRoundIcon,
    Cuboid: CuboidIcon,
    Database: DatabaseIcon,
    Download: DownloadIcon,
    FileText: FileTextIcon,
    Folder: FolderIcon,
    Gamepad2: Gamepad2Icon,
    Gauge: GaugeIcon,
    Globe: GlobeIcon,
    Heart: HeartIcon,
    History: HistoryIcon,
    House: HouseIcon,
    Image: ImageIcon,
    Images: ImagesIcon,
    LayoutDashboard: LayoutDashboardIcon,
    List: ListIcon,
    MapPinned: MapPinnedIcon,
    MapPin: MapPinIcon,
    MessageSquareText: MessageSquareTextIcon,
    Package: PackageIcon,
    Palette: PaletteIcon,
    PanelLeft: PanelLeftIcon,
    PersonStanding: PersonStandingIcon,
    Rocket: RocketIcon,
    Rss: RssIcon,
    Search: SearchIcon,
    ServerCog: ServerCogIcon,
    Settings: SettingsIcon,
    ShieldAlert: ShieldAlertIcon,
    ShieldUser: ShieldUserIcon,
    SlidersHorizontal: SlidersHorizontalIcon,
    Smile: SmileIcon,
    SquareTerminal: SquareTerminalIcon,
    Star: StarIcon,
    Tags: TagsIcon,
    TextSearch: TextSearchIcon,
    UserRound: UserRoundIcon,
    UserStar: UserStarIcon,
    Users: UsersIcon,
    UsersRound: UsersRoundIcon,
    Wrench: WrenchIcon
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
): LucideIcon {
    const normalized = normalizeNavIconKey(value, fallback);
    const name = extractLucideIconName(normalized);
    return navIconComponentByName[name] || CircleIcon;
}
