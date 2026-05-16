// @ts-nocheck
const sidePanelHiddenPaths = [
    '/friends-locations',
    '/social/friend-list',
    '/charts/instance',
    '/charts/mutual'
];

function matchesPath(pathname, path) {
    return pathname === path || pathname.startsWith(`${path}/`);
}

export function getDefaultHiddenSidePanelPath(pathname) {
    return sidePanelHiddenPaths.find((path) => matchesPath(pathname, path));
}

export function isSidePanelDefaultHidden(pathname) {
    return Boolean(getDefaultHiddenSidePanelPath(pathname));
}
