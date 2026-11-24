const sidePanelHiddenPaths = [
    '/friends-locations',
    '/social/friend-list',
    '/charts/mutual'
];

function matchesPath(pathname: string, path: string) {
    return pathname === path || pathname.startsWith(`${path}/`);
}

export function getDefaultHiddenSidePanelPath(pathname: string) {
    return sidePanelHiddenPaths.find((path) => matchesPath(pathname, path));
}
