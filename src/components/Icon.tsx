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
    LogInIcon,
    LogOutIcon,
    LucideIcon,
    MapPinnedIcon,
    MapPinIcon,
    MessageSquareTextIcon,
    PackageIcon,
    PaletteIcon,
    PanelLeftIcon,
    PencilLineIcon,
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
    VideoIcon,
    WrenchIcon
} from 'lucide-react';
import React from 'react';

import { cn } from '@/lib/utils';

export type Meta = { Icon: LucideIcon; className: string };

export const IconType: Record<string, Meta> = {
    Location: { Icon: MapPinIcon, className: '' },
    LogIn: { Icon: LogInIcon, className: '' },
    LogOut: { Icon: LogOutIcon, className: '' },
    Status: { Icon: PencilLineIcon, className: '' },
    Avatar: { Icon: PersonStandingIcon, className: 'stroke-1.5 scale-145' },
    Doc: { Icon: FileTextIcon, className: '' },
    Users: { Icon: UsersIcon, className: '' },
    Video: { Icon: VideoIcon, className: '' },
    Activity: { Icon: ActivityIcon, className: '' },
    Archive: { Icon: ArchiveIcon, className: '' },
    Bell: { Icon: BellIcon, className: '' },
    BookOpen: { Icon: BookOpenIcon, className: '' },
    Bot: { Icon: BotIcon, className: '' },
    Box: { Icon: BoxIcon, className: '' },
    Boxes: { Icon: BoxesIcon, className: '' },
    CalendarDays: { Icon: CalendarDaysIcon, className: '' },
    Camera: { Icon: CameraIcon, className: '' },
    ChartBar: { Icon: ChartBarIcon, className: '' },
    Circle: { Icon: CircleIcon, className: '' },
    Compass: { Icon: CompassIcon, className: '' },
    Contact: { Icon: ContactIcon, className: '' },
    ContactRound: { Icon: ContactRoundIcon, className: '' },
    Cuboid: { Icon: CuboidIcon, className: '' },
    DatabaseBackup: { Icon: DatabaseBackupIcon, className: '' },
    Database: { Icon: DatabaseIcon, className: '' },
    Download: { Icon: DownloadIcon, className: '' },
    Folder: { Icon: FolderIcon, className: '' },
    Gamepad2: { Icon: Gamepad2Icon, className: '' },
    Gauge: { Icon: GaugeIcon, className: '' },
    Globe: { Icon: GlobeIcon, className: '' },
    Heart: { Icon: HeartIcon, className: '' },
    History: { Icon: HistoryIcon, className: '' },
    House: { Icon: HouseIcon, className: '' },
    Image: { Icon: ImageIcon, className: '' },
    Images: { Icon: ImagesIcon, className: '' },
    LayoutDashboard: { Icon: LayoutDashboardIcon, className: '' },
    List: { Icon: ListIcon, className: '' },
    MapPinned: { Icon: MapPinnedIcon, className: '' },
    MessageSquareText: { Icon: MessageSquareTextIcon, className: '' },
    Package: { Icon: PackageIcon, className: '' },
    Palette: { Icon: PaletteIcon, className: '' },
    PanelLeft: { Icon: PanelLeftIcon, className: '' },
    Rocket: { Icon: RocketIcon, className: '' },
    Rss: { Icon: RssIcon, className: '' },
    Search: { Icon: SearchIcon, className: '' },
    ServerCog: { Icon: ServerCogIcon, className: '' },
    Settings: { Icon: SettingsIcon, className: '' },
    ShieldAlert: { Icon: ShieldAlertIcon, className: '' },
    ShieldUser: { Icon: ShieldUserIcon, className: '' },
    SlidersHorizontal: { Icon: SlidersHorizontalIcon, className: '' },
    Smile: { Icon: SmileIcon, className: '' },
    SquareTerminal: { Icon: SquareTerminalIcon, className: '' },
    Star: { Icon: StarIcon, className: '' },
    Tags: { Icon: TagsIcon, className: '' },
    TextSearch: { Icon: TextSearchIcon, className: '' },
    UserRound: { Icon: UserRoundIcon, className: '' },
    UserStar: { Icon: UserStarIcon, className: '' },
    UsersRound: { Icon: UsersRoundIcon, className: '' },
    Wrench: { Icon: WrenchIcon, className: '' }
};

export interface CustomIconProps extends React.ComponentPropsWithoutRef<'svg'> {
    containerClassName?: string;
}

interface IconProps extends CustomIconProps {
    meta: Meta;
}

function BaseIcon({
    meta,
    containerClassName,
    className,
    ...props
}: IconProps) {
    return (
        <div
            className={cn(
                'flex h-4 w-4 items-center justify-center',
                containerClassName
            )}
        >
            <meta.Icon
                aria-hidden="true"
                className={cn('size-3.5 shrink-0', meta.className, className)}
                {...props}
            />
        </div>
    );
}

export const Location = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Location}
        containerClassName={containerClassName}
        {...props}
    />
);

export const LogIn = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.LogIn}
        containerClassName={containerClassName}
        {...props}
    />
);

export const LogOut = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.LogOut}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Status = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Status}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Avatar = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Avatar}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Doc = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Doc}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Users = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Users}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Video = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Video}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Activity = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Activity}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Archive = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Archive}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Bell = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Bell}
        containerClassName={containerClassName}
        {...props}
    />
);

export const BookOpen = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.BookOpen}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Bot = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Bot}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Box = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Box}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Boxes = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Boxes}
        containerClassName={containerClassName}
        {...props}
    />
);

export const CalendarDays = ({
    containerClassName,
    ...props
}: CustomIconProps) => (
    <BaseIcon
        meta={IconType.CalendarDays}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Camera = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Camera}
        containerClassName={containerClassName}
        {...props}
    />
);

export const ChartBar = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.ChartBar}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Circle = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Circle}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Compass = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Compass}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Contact = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Contact}
        containerClassName={containerClassName}
        {...props}
    />
);

export const ContactRound = ({
    containerClassName,
    ...props
}: CustomIconProps) => (
    <BaseIcon
        meta={IconType.ContactRound}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Cuboid = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Cuboid}
        containerClassName={containerClassName}
        {...props}
    />
);

export const DatabaseBackup = ({
    containerClassName,
    ...props
}: CustomIconProps) => (
    <BaseIcon
        meta={IconType.DatabaseBackup}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Database = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Database}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Download = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Download}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Folder = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Folder}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Gamepad2 = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Gamepad2}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Gauge = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Gauge}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Globe = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Globe}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Heart = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Heart}
        containerClassName={containerClassName}
        {...props}
    />
);

export const History = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.History}
        containerClassName={containerClassName}
        {...props}
    />
);

export const House = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.House}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Image = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Image}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Images = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Images}
        containerClassName={containerClassName}
        {...props}
    />
);

export const LayoutDashboard = ({
    containerClassName,
    ...props
}: CustomIconProps) => (
    <BaseIcon
        meta={IconType.LayoutDashboard}
        containerClassName={containerClassName}
        {...props}
    />
);

export const List = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.List}
        containerClassName={containerClassName}
        {...props}
    />
);

export const MapPinned = ({
    containerClassName,
    ...props
}: CustomIconProps) => (
    <BaseIcon
        meta={IconType.MapPinned}
        containerClassName={containerClassName}
        {...props}
    />
);

export const MessageSquareText = ({
    containerClassName,
    ...props
}: CustomIconProps) => (
    <BaseIcon
        meta={IconType.MessageSquareText}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Package = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Package}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Palette = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Palette}
        containerClassName={containerClassName}
        {...props}
    />
);

export const PanelLeft = ({
    containerClassName,
    ...props
}: CustomIconProps) => (
    <BaseIcon
        meta={IconType.PanelLeft}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Rocket = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Rocket}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Rss = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Rss}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Search = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Search}
        containerClassName={containerClassName}
        {...props}
    />
);

export const ServerCog = ({
    containerClassName,
    ...props
}: CustomIconProps) => (
    <BaseIcon
        meta={IconType.ServerCog}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Settings = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Settings}
        containerClassName={containerClassName}
        {...props}
    />
);

export const ShieldAlert = ({
    containerClassName,
    ...props
}: CustomIconProps) => (
    <BaseIcon
        meta={IconType.ShieldAlert}
        containerClassName={containerClassName}
        {...props}
    />
);

export const ShieldUser = ({
    containerClassName,
    ...props
}: CustomIconProps) => (
    <BaseIcon
        meta={IconType.ShieldUser}
        containerClassName={containerClassName}
        {...props}
    />
);

export const SlidersHorizontal = ({
    containerClassName,
    ...props
}: CustomIconProps) => (
    <BaseIcon
        meta={IconType.SlidersHorizontal}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Smile = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Smile}
        containerClassName={containerClassName}
        {...props}
    />
);

export const SquareTerminal = ({
    containerClassName,
    ...props
}: CustomIconProps) => (
    <BaseIcon
        meta={IconType.SquareTerminal}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Star = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Star}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Tags = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Tags}
        containerClassName={containerClassName}
        {...props}
    />
);

export const TextSearch = ({
    containerClassName,
    ...props
}: CustomIconProps) => (
    <BaseIcon
        meta={IconType.TextSearch}
        containerClassName={containerClassName}
        {...props}
    />
);

export const UserRound = ({
    containerClassName,
    ...props
}: CustomIconProps) => (
    <BaseIcon
        meta={IconType.UserRound}
        containerClassName={containerClassName}
        {...props}
    />
);

export const UserStar = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.UserStar}
        containerClassName={containerClassName}
        {...props}
    />
);

export const UsersRound = ({
    containerClassName,
    ...props
}: CustomIconProps) => (
    <BaseIcon
        meta={IconType.UsersRound}
        containerClassName={containerClassName}
        {...props}
    />
);

export const Wrench = ({ containerClassName, ...props }: CustomIconProps) => (
    <BaseIcon
        meta={IconType.Wrench}
        containerClassName={containerClassName}
        {...props}
    />
);
