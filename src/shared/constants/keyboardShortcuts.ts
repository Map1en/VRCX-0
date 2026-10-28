export const SHORTCUT_GROUPS = [
    {
        titleKey: 'shortcuts.group.general',
        items: [
            { labelKey: 'app_menu.quick_search', keys: ['Mod', 'K'] },
            { labelKey: 'app_menu.settings', keys: ['Mod', ','] },
            {
                labelKey: 'prompt.direct_access_omni.header',
                keys: ['Mod', 'D']
            },
            { labelKey: 'app_menu.keyboard_shortcuts', keys: ['Mod', '/'] },
            {
                labelKey: 'shortcuts.toggle_theme_safe_mode',
                keys: ['Mod', 'Alt', 'Shift', 'T']
            },
            { labelKey: 'shortcuts.hold_for_hints', keys: ['Mod'] }
        ]
    },
    {
        titleKey: 'shortcuts.group.layout',
        items: [
            { labelKey: 'shortcuts.navigation_items', keys: ['Mod', '1–9'] },
            { labelKey: 'nav_tooltip.collapse_nav', keys: ['Mod', 'B'] },
            {
                labelKey: 'app_menu.hide_friends_sidebar',
                keys: ['Mod', 'Shift', 'B']
            }
        ]
    },
    {
        titleKey: 'shortcuts.group.pagination',
        items: [
            { labelKey: 'table.pagination.previous', keys: ['ArrowLeft'] },
            { labelKey: 'table.pagination.next', keys: ['ArrowRight'] }
        ]
    },
    {
        titleKey: 'shortcuts.group.screenshots',
        items: [
            { labelKey: 'view.tools.label.prev', keys: ['ArrowLeft'] },
            { labelKey: 'table.pagination.next', keys: ['ArrowRight'] },
            { labelKey: 'shortcuts.toggle_details', keys: ['I'] }
        ]
    },
    {
        titleKey: 'shortcuts.group.image_viewer',
        items: [
            { labelKey: 'message.image.zoom_in', keys: ['+'] },
            { labelKey: 'message.image.zoom_out', keys: ['-'] },
            { labelKey: 'message.image.rotate_clockwise', keys: ['R'] },
            { labelKey: 'message.image.reset', keys: ['0'] },
            { labelKey: 'message.image.close', keys: ['Escape'] }
        ]
    },
    {
        titleKey: 'shortcuts.group.selection',
        items: [{ labelKey: 'shortcuts.clear_selection', keys: ['Escape'] }]
    },
    {
        titleKey: 'shortcuts.group.gallery_inventory',
        items: [
            {
                labelKey: 'dialog.gallery_icons.paste_upload',
                keys: ['Mod', 'V']
            }
        ]
    }
] as const;
