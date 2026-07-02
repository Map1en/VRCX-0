export const TELEMETRY_ROUTE_KEYS = [
    'friends_locations',
    'game_log',
    'instance_history',
    'player_list',
    'search',
    'dashboard',
    'favorites_friends',
    'favorites_worlds',
    'favorites_avatars',
    'friend_log',
    'moderation',
    'my_avatars',
    'notification',
    'friend_list',
    'charts_mutual',
    'tools',
    'gallery',
    'inventory',
    'screenshot_metadata',
    'vrchat_log',
    'themes',
    'settings'
] as const;

export type TelemetryPageRouteKey = (typeof TELEMETRY_ROUTE_KEYS)[number];

export const TELEMETRY_VIEW_MODE_DIMENSIONS = {
    gameLogViewMode: ['sessions', 'table'],
    myAvatarsViewMode: ['grid', 'table'],
    feedViewMode: ['table', 'columns'],
    feedTimeDisplayMode: ['relative', 'exact']
} as const;

export type TelemetryViewModeDimension =
    keyof typeof TELEMETRY_VIEW_MODE_DIMENSIONS;
