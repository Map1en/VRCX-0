import {
    DoorOpenIcon,
    FileTextIcon,
    ImageIcon,
    LogInIcon,
    LogOutIcon,
    type LucideIcon,
    MapPinIcon,
    PlayIcon,
    SparklesIcon,
    TypeIcon
} from 'lucide-react';

import { cn } from '@/lib/utils';

const TYPE_META: Record<string, { Icon: LucideIcon; className: string }> = {
    Location: { Icon: MapPinIcon, className: 'text-sky-500' },
    OnPlayerJoined: {
        Icon: LogInIcon,
        className: 'text-[var(--status-online)]'
    },
    OnPlayerLeft: { Icon: LogOutIcon, className: 'text-slate-400' },
    PortalSpawn: { Icon: DoorOpenIcon, className: 'text-violet-400' },
    VideoPlay: { Icon: PlayIcon, className: 'text-muted-foreground' },
    Event: { Icon: SparklesIcon, className: 'text-muted-foreground' },
    External: { Icon: FileTextIcon, className: 'text-muted-foreground' },
    StringLoad: { Icon: TypeIcon, className: 'text-muted-foreground' },
    ImageLoad: { Icon: ImageIcon, className: 'text-muted-foreground' }
};

export function GameLogTypeIndicator({
    type,
    label
}: {
    type: string;
    label: string;
}) {
    const meta = TYPE_META[type];
    return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
            {meta ? (
                <meta.Icon
                    aria-hidden="true"
                    className={cn('size-3.5 shrink-0', meta.className)}
                />
            ) : null}
            <span className="text-foreground/80 min-w-0 truncate text-sm font-normal">
                {label}
            </span>
        </span>
    );
}
