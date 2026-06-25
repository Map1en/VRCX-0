import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';
import { Kbd, KbdGroup } from '@/ui/shadcn/kbd';

const KEY_LABELS: Record<string, string> = {
    ArrowLeft: '\u2190',
    ArrowRight: '\u2192',
    ArrowUp: '\u2191',
    ArrowDown: '\u2193',
    Meta: '\u2318',
    Mod: 'Ctrl',
    Control: 'Ctrl',
    Escape: 'Esc'
};

const KEY_ARIA_LABELS: Record<string, string> = {
    ArrowLeft: 'Arrow Left',
    ArrowRight: 'Arrow Right',
    ArrowUp: 'Arrow Up',
    ArrowDown: 'Arrow Down',
    Meta: 'Command',
    Mod: 'Control',
    Control: 'Control',
    Escape: 'Escape'
};

type KeyboardShortcutProps = ComponentProps<typeof KbdGroup> & {
    kbdClassName?: string;
    keys: string | string[];
};

function normalizeKeys(keys: string | string[]): string[] {
    return Array.isArray(keys) ? keys : [keys];
}

export function KeyboardShortcut({
    keys,
    className = '',
    kbdClassName = '',
    ...props
}: KeyboardShortcutProps) {
    const normalizedKeys = normalizeKeys(keys).filter(Boolean);

    if (!normalizedKeys.length) {
        return null;
    }

    return (
        <KbdGroup
            aria-label={normalizedKeys
                .map((key) => KEY_ARIA_LABELS[key] || key)
                .join(' + ')}
            className={cn('shrink-0', className)}
            {...props}
        >
            {normalizedKeys.map((key) => (
                <Kbd key={key} className={kbdClassName}>
                    {KEY_LABELS[key] || key}
                </Kbd>
            ))}
        </KbdGroup>
    );
}
