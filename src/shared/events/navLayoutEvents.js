export const NAV_LAYOUT_UPDATED_EVENT = 'vrcx:nav-layout-updated';

export function publishNavLayoutUpdated() {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(NAV_LAYOUT_UPDATED_EVENT));
    }
}
