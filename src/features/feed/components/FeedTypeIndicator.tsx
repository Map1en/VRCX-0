import {
    FileTextIcon,
    LogInIcon,
    LogOutIcon,
    MapPinIcon,
    PencilLineIcon,
    PersonStandingIcon
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

import { normalizeFeedId } from '../feedRows';

const TYPE_ICONS: Record<string, { Icon: LucideIcon; className: string }> = {
    GPS: { Icon: MapPinIcon, className: 'text-sky-500' },
    Online: { Icon: LogInIcon, className: 'text-[var(--status-online)]' },
    Offline: { Icon: LogOutIcon, className: 'text-slate-400' },
    Status: {
        Icon: PencilLineIcon,
        className: 'text-muted-foreground opacity-70'
    },
    Avatar: {
        Icon: PersonStandingIcon,
        className: 'text-muted-foreground opacity-70'
    },
    Bio: { Icon: FileTextIcon, className: 'text-muted-foreground opacity-70' }
};

function FeedTypeIndicator({ label, type }: { label: string; type: unknown }) {
    const normalizedId = normalizeFeedId(type);
    const meta =
        normalizedId in TYPE_ICONS
            ? TYPE_ICONS[normalizedId as keyof typeof TYPE_ICONS]
            : null;
    return (
        <span className="flex min-w-0 items-center gap-1.5">
            {meta ? (
                <meta.Icon
                    aria-hidden="true"
                    className={cn('size-3.5 shrink-0', meta.className)}
                />
            ) : null}
            <span
                className="text-foreground/80 min-w-0 truncate text-sm font-normal"
                style={{
                    textBoxTrim: 'trim-both',
                    textBoxEdge: 'cap alphabetic'
                }}
            >
                {label}
            </span>
        </span>
    );
}

export { FeedTypeIndicator };
