// @ts-nocheck
import { cn } from '@/lib/utils.js';
import { Kbd, KbdGroup } from '@/ui/shadcn/kbd';

const KEY_LABELS = {
    ArrowLeft: '\u2190',
    ArrowRight: '\u2192',
    ArrowUp: '\u2191',
    ArrowDown: '\u2193',
    Meta: '\u2318',
    Mod: 'Ctrl',
    Control: 'Ctrl',
    Escape: 'Esc'
};

const KEY_ARIA_LABELS = {
    ArrowLeft: 'Arrow Left',
    ArrowRight: 'Arrow Right',
    ArrowUp: 'Arrow Up',
    ArrowDown: 'Arrow Down',
    Meta: 'Command',
    Mod: 'Control',
    Control: 'Control',
    Escape: 'Escape'
};

function normalizeKeys(keys) {
    return Array.isArray(keys) ? keys : [keys];
}

export function KeyboardShortcut({
    keys,
    className = '',
    kbdClassName = '',
    ...props
}) {
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
