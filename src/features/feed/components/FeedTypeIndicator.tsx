import * as Icon from '@/components/Icon';

import { normalizeFeedId } from '../feedRows';

const TYPE_ICONS = {
    GPS: { Component: Icon.Location, className: 'text-sky-500' },
    Online: { Component: Icon.LogIn, className: 'text-[var(--status-online)]' },
    Offline: { Component: Icon.LogOut, className: 'text-slate-400' },
    Status: {
        Component: Icon.Status,
        className: 'text-muted-foreground opacity-70'
    },
    Avatar: {
        Component: Icon.Avatar,
        className: 'text-muted-foreground opacity-70'
    },
    Bio: { Component: Icon.Doc, className: 'text-muted-foreground opacity-70' }
} as const;

function FeedTypeIndicator({ label, type }: { label: string; type: unknown }) {
    const normalizedId = normalizeFeedId(type);
    const meta =
        normalizedId in TYPE_ICONS
            ? TYPE_ICONS[normalizedId as keyof typeof TYPE_ICONS]
            : null;
    return (
        <span className="flex min-w-0 items-center gap-1.5">
            {meta ? <meta.Component className={meta.className} /> : null}
            <span
                className="text-foreground/80 text-sm font-normal"
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
