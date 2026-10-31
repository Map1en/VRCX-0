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
    DatabaseBackupIcon,
    DatabaseIcon,
    DownloadIcon,
    FileTextIcon,
    FlagIcon,
    FolderIcon,
    FootprintsIcon,
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
    LogsIcon,
    MapPinnedIcon,
    MapPinIcon,
    MessageSquareTextIcon,
    PackageIcon,
    PaletteIcon,
    PanelLeftIcon,
    PersonStandingIcon,
    PlugIcon,
    RadioTowerIcon,
    ReceiptIcon,
    RocketIcon,
    RssIcon,
    SearchIcon,
    ServerCogIcon,
    ServerIcon,
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
    UserRoundCheckIcon,
    UserStarIcon,
    UsersIcon,
    UsersRoundIcon,
    WaypointsIcon,
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
    DatabaseBackup: DatabaseBackupIcon,
    Database: DatabaseIcon,
    Download: DownloadIcon,
    FileText: FileTextIcon,
    Flag: FlagIcon,
    Folder: FolderIcon,
    Footprints: FootprintsIcon,
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
    Logs: LogsIcon,
    MapPinned: MapPinnedIcon,
    MapPin: MapPinIcon,
    MessageSquareText: MessageSquareTextIcon,
    Package: PackageIcon,
    Palette: PaletteIcon,
    PanelLeft: PanelLeftIcon,
    PersonStanding: PersonStandingIcon,
    Plug: PlugIcon,
    RadioTower: RadioTowerIcon,
    Receipt: ReceiptIcon,
    Rocket: RocketIcon,
    Rss: RssIcon,
    Search: SearchIcon,
    Server: ServerIcon,
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
    UserRoundCheck: UserRoundCheckIcon,
    UserStar: UserStarIcon,
    Users: UsersIcon,
    UsersRound: UsersRoundIcon,
    Waypoints: WaypointsIcon,
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
