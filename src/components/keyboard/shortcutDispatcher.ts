import { useEffect, useEffectEvent } from 'react';

import {
    SHORTCUT_DIGIT_RANGE_KEY,
    SHORTCUT_REGISTRY,
    type GlobalShortcutDefinition,
    type GlobalShortcutId,
    type ShortcutModifier
} from '@/shared/keyboard/shortcutRegistry';

import { isImeComposing, isTextEntryTarget } from './keyboardShortcutGuards';

type ShortcutHandler = (event: KeyboardEvent) => void;

type RegisteredGlobalShortcut = GlobalShortcutDefinition & {
    id: GlobalShortcutId;
};

const GLOBAL_SHORTCUTS: readonly RegisteredGlobalShortcut[] =
    SHORTCUT_REGISTRY.filter(
        (
            definition
        ): definition is Extract<
            (typeof SHORTCUT_REGISTRY)[number],
            { scope: 'global' }
        > => definition.scope === 'global'
    );

const shortcutHandlers = new Map<GlobalShortcutId, ShortcutHandler[]>();

export function registerShortcutHandler(
    id: GlobalShortcutId,
    handler: ShortcutHandler
) {
    const stack = shortcutHandlers.get(id) ?? [];
    stack.push(handler);
    shortcutHandlers.set(id, stack);
    return () => {
        const current = shortcutHandlers.get(id);
        const index = current?.lastIndexOf(handler) ?? -1;
        if (!current || index < 0) {
            return;
        }
        current.splice(index, 1);
        if (current.length === 0) {
            shortcutHandlers.delete(id);
        }
    };
}

export function useShortcutHandler(
    id: GlobalShortcutId,
    handler: ShortcutHandler,
    enabled = true
) {
    const onShortcut = useEffectEvent(handler);
    useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        return registerShortcutHandler(id, (event) => onShortcut(event));
    }, [enabled, id]);
}

export function hasPrimaryModifier(
    event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>,
    isMacHost: boolean
) {
    return isMacHost ? event.metaKey : event.ctrlKey || event.metaKey;
}

function matchesModifier(
    definition: RegisteredGlobalShortcut,
    modifier: ShortcutModifier,
    pressed: boolean
) {
    return (
        definition.ignoredModifiers?.includes(modifier) === true ||
        pressed === definition.keys.includes(modifier)
    );
}

function matchesKey(token: string, key: string) {
    if (token === SHORTCUT_DIGIT_RANGE_KEY) {
        return /^[1-9]$/.test(key);
    }
    return token !== 'Mod' && key.toLowerCase() === token.toLowerCase();
}

export function findGlobalShortcut(event: KeyboardEvent, isMacHost: boolean) {
    if (!hasPrimaryModifier(event, isMacHost)) {
        return undefined;
    }
    return GLOBAL_SHORTCUTS.find((definition) => {
        const token = definition.keys.at(-1);
        return (
            token !== undefined &&
            matchesKey(token, event.key) &&
            matchesModifier(definition, 'Shift', event.shiftKey) &&
            matchesModifier(definition, 'Alt', event.altKey)
        );
    });
}

export function dispatchGlobalShortcut(
    event: KeyboardEvent,
    isMacHost: boolean
) {
    if (isImeComposing(event)) {
        return;
    }
    const definition = findGlobalShortcut(event, isMacHost);
    if (!definition) {
        return;
    }

    const handledElsewhere = event.defaultPrevented;
    if (definition.alwaysPreventDefault) {
        event.preventDefault();
    }
    if (
        handledElsewhere ||
        (definition.allowRepeat === false && event.repeat) ||
        (!definition.allowInTextEntry && isTextEntryTarget(event.target))
    ) {
        return;
    }

    const handler = shortcutHandlers.get(definition.id)?.at(-1);
    if (!handler) {
        return;
    }
    event.preventDefault();
    handler(event);
}
