export type ShortcutGroupId =
    | 'general'
    | 'layout'
    | 'pagination'
    | 'screenshots'
    | 'image_viewer'
    | 'selection'
    | 'gallery_inventory';

export type ShortcutModifier = 'Shift' | 'Alt';

interface ShortcutDefinitionBase {
    id: string;
    keys: readonly string[];
    group?: ShortcutGroupId;
    labelKey?: string;
}

export interface GlobalShortcutDefinition extends ShortcutDefinitionBase {
    scope: 'global';
    allowInTextEntry: boolean;
    ignoredModifiers?: readonly ShortcutModifier[];
    allowRepeat?: boolean;
    alwaysPreventDefault?: boolean;
}

export interface PageShortcutDefinition extends ShortcutDefinitionBase {
    scope: 'page';
    group: ShortcutGroupId;
    labelKey: string;
}

export type ShortcutDefinition =
    | GlobalShortcutDefinition
    | PageShortcutDefinition;

export const SHORTCUT_DIGIT_RANGE_KEY = '1–9';

export const SHORTCUT_REGISTRY = [
    {
        id: 'quick-search',
        scope: 'global',
        keys: ['Mod', 'K'],
        allowInTextEntry: true,
        ignoredModifiers: ['Shift', 'Alt'],
        group: 'general',
        labelKey: 'app_menu.quick_search'
    },
    {
        id: 'settings',
        scope: 'global',
        keys: ['Mod', ','],
        allowInTextEntry: false,
        ignoredModifiers: ['Shift', 'Alt'],
        group: 'general',
        labelKey: 'app_menu.settings'
    },
    {
        id: 'direct-access',
        scope: 'global',
        keys: ['Mod', 'D'],
        allowInTextEntry: true,
        ignoredModifiers: ['Shift', 'Alt'],
        group: 'general',
        labelKey: 'prompt.direct_access_omni.header'
    },
    {
        id: 'keyboard-shortcuts',
        scope: 'global',
        keys: ['Mod', '/'],
        allowInTextEntry: false,
        ignoredModifiers: ['Shift', 'Alt'],
        group: 'general',
        labelKey: 'app_menu.keyboard_shortcuts'
    },
    {
        id: 'theme-safe-mode',
        scope: 'global',
        keys: ['Mod', 'Alt', 'Shift', 'T'],
        allowInTextEntry: false,
        group: 'general',
        labelKey: 'shortcuts.toggle_theme_safe_mode'
    },
    {
        id: 'shortcut-hints',
        scope: 'global',
        keys: ['Mod'],
        allowInTextEntry: false,
        group: 'general',
        labelKey: 'shortcuts.hold_for_hints'
    },
    {
        id: 'nav-position',
        scope: 'global',
        keys: ['Mod', SHORTCUT_DIGIT_RANGE_KEY],
        allowInTextEntry: false,
        allowRepeat: false,
        alwaysPreventDefault: true,
        group: 'layout',
        labelKey: 'shortcuts.navigation_items'
    },
    {
        id: 'collapse-nav',
        scope: 'global',
        keys: ['Mod', 'B'],
        allowInTextEntry: true,
        ignoredModifiers: ['Alt'],
        group: 'layout',
        labelKey: 'nav_tooltip.collapse_nav'
    },
    {
        id: 'friends-sidebar',
        scope: 'global',
        keys: ['Mod', 'Shift', 'B'],
        allowInTextEntry: false,
        ignoredModifiers: ['Alt'],
        group: 'layout',
        labelKey: 'app_menu.hide_friends_sidebar'
    },
    {
        id: 'suppress-print',
        scope: 'global',
        keys: ['Mod', 'P'],
        allowInTextEntry: true,
        alwaysPreventDefault: true
    },
    {
        id: 'pagination-previous',
        scope: 'page',
        keys: ['ArrowLeft'],
        group: 'pagination',
        labelKey: 'table.pagination.previous'
    },
    {
        id: 'pagination-next',
        scope: 'page',
        keys: ['ArrowRight'],
        group: 'pagination',
        labelKey: 'table.pagination.next'
    },
    {
        id: 'screenshot-previous',
        scope: 'page',
        keys: ['ArrowLeft'],
        group: 'screenshots',
        labelKey: 'view.tools.label.prev'
    },
    {
        id: 'screenshot-next',
        scope: 'page',
        keys: ['ArrowRight'],
        group: 'screenshots',
        labelKey: 'table.pagination.next'
    },
    {
        id: 'screenshot-details',
        scope: 'page',
        keys: ['I'],
        group: 'screenshots',
        labelKey: 'shortcuts.toggle_details'
    },
    {
        id: 'image-zoom-in',
        scope: 'page',
        keys: ['+'],
        group: 'image_viewer',
        labelKey: 'message.image.zoom_in'
    },
    {
        id: 'image-zoom-out',
        scope: 'page',
        keys: ['-'],
        group: 'image_viewer',
        labelKey: 'message.image.zoom_out'
    },
    {
        id: 'image-rotate',
        scope: 'page',
        keys: ['R'],
        group: 'image_viewer',
        labelKey: 'message.image.rotate_clockwise'
    },
    {
        id: 'image-reset',
        scope: 'page',
        keys: ['0'],
        group: 'image_viewer',
        labelKey: 'message.image.reset'
    },
    {
        id: 'image-close',
        scope: 'page',
        keys: ['Escape'],
        group: 'image_viewer',
        labelKey: 'message.image.close'
    },
    {
        id: 'clear-selection',
        scope: 'page',
        keys: ['Escape'],
        group: 'selection',
        labelKey: 'shortcuts.clear_selection'
    },
    {
        id: 'gallery-paste-upload',
        scope: 'page',
        keys: ['Mod', 'V'],
        group: 'gallery_inventory',
        labelKey: 'dialog.gallery_icons.paste_upload'
    }
] as const satisfies readonly ShortcutDefinition[];

export type ShortcutId = (typeof SHORTCUT_REGISTRY)[number]['id'];

export type GlobalShortcutId = Extract<
    (typeof SHORTCUT_REGISTRY)[number],
    { scope: 'global' }
>['id'];

const SHORTCUT_GROUP_ORDER: readonly ShortcutGroupId[] = [
    'general',
    'layout',
    'pagination',
    'screenshots',
    'image_viewer',
    'selection',
    'gallery_inventory'
];

export interface ShortcutHelpItem {
    labelKey: string;
    keys: readonly string[];
}

export interface ShortcutHelpGroup {
    titleKey: string;
    items: readonly ShortcutHelpItem[];
}

export function buildShortcutHelpGroups(
    registry: readonly ShortcutDefinition[]
): ShortcutHelpGroup[] {
    return SHORTCUT_GROUP_ORDER.flatMap((group) => {
        const items = registry.flatMap((definition) =>
            definition.group === group && definition.labelKey
                ? [{ labelKey: definition.labelKey, keys: definition.keys }]
                : []
        );
        return items.length
            ? [{ titleKey: `shortcuts.group.${group}`, items }]
            : [];
    });
}

export const SHORTCUT_GROUPS = buildShortcutHelpGroups(SHORTCUT_REGISTRY);
