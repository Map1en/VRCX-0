const sidePanelHiddenPaths = [
    '/friends-locations',
    '/social/friend-list',
    '/charts/instance',
    '/charts/mutual'
];

function matchesPath(pathname: any, path: any) {
    return pathname === path || pathname.startsWith(`${path}/`);
}

export function getDefaultHiddenSidePanelPath(pathname: any) {
    return sidePanelHiddenPaths.find((path: any) =>
        matchesPath(pathname, path)
    );
}

export function isSidePanelDefaultHidden(pathname: any) {
    return Boolean(getDefaultHiddenSidePanelPath(pathname));
}
