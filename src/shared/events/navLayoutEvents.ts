export const NAV_LAYOUT_UPDATED_EVENT = 'vrcx:nav-layout-updated';
export const NAV_CUSTOMIZE_REQUESTED_EVENT = 'vrcx:nav-customize-requested';
export const NAV_SHORTCUT_REQUESTED_EVENT = 'vrcx:nav-shortcut-requested';
export const NAV_SHORTCUT_POSITION_LIMIT = 9;

export function publishNavLayoutUpdated(): void {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(NAV_LAYOUT_UPDATED_EVENT));
    }
}

export function publishNavCustomizeRequested(): void {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(NAV_CUSTOMIZE_REQUESTED_EVENT));
    }
}

export function publishNavShortcutRequested(position: number): void {
    if (
        typeof window === 'undefined' ||
        !Number.isInteger(position) ||
        position < 1 ||
        position > NAV_SHORTCUT_POSITION_LIMIT
    ) {
        return;
    }
    window.dispatchEvent(
        new CustomEvent(NAV_SHORTCUT_REQUESTED_EVENT, { detail: position })
    );
}
