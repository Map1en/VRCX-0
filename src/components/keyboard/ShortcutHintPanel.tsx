import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { KeyboardShortcut } from './KeyboardShortcut';

export type ShortcutHintItem = {
    icon: ReactNode;
    id: string;
    keys: string | string[];
    label: string;
};

const SHORTCUT_KEY_CLASS =
    'bg-muted/80 text-foreground h-5 min-w-5 rounded px-1 font-mono text-[11px] leading-5 tabular-nums shadow-none';

export function ShortcutKey({
    keys,
    className
}: {
    keys: string | string[];
    className?: string;
}) {
    return (
        <KeyboardShortcut
            aria-hidden="true"
            keys={keys}
            className={className}
            kbdClassName={SHORTCUT_KEY_CLASS}
        />
    );
}

export function ShortcutHintPanel({
    className,
    groups
}: {
    className?: string;
    groups: readonly (readonly ShortcutHintItem[])[];
}) {
    const visibleGroups = groups.filter((group) => group.length > 0);
    if (visibleGroups.length === 0) {
        return null;
    }

    return (
        <div
            aria-hidden="true"
            className={cn(
                'bg-popover/95 text-popover-foreground ring-foreground/10 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 pointer-events-none z-[70] max-h-[calc(100vh-4rem)] w-64 overflow-y-auto rounded-lg p-1.5 shadow-lg ring-1 backdrop-blur-md select-none motion-safe:duration-100',
                className
            )}
        >
            {visibleGroups.map((group, groupIndex) => (
                <div
                    key={group[0].id}
                    className={cn(
                        'space-y-0.5',
                        groupIndex > 0 && 'border-border mt-1 border-t pt-1'
                    )}
                >
                    {group.map((item) => (
                        <div
                            key={item.id}
                            className="flex min-h-7 items-center gap-2 rounded-md px-2 py-1"
                        >
                            <span className="text-muted-foreground flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5">
                                {item.icon}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs">
                                {item.label}
                            </span>
                            <ShortcutKey keys={item.keys} />
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}
