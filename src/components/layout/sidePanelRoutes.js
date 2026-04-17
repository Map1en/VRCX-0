const sidePanelHiddenPaths = ['/friends-locations', '/social/friend-list', '/charts/instance', '/charts/mutual'];

export function shouldShowSidePanel(pathname) {
    return !sidePanelHiddenPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
