import { recordTelemetryEvent } from './telemetryEvent';
import type {
    TelemetryPageRouteKey,
    TelemetryRouteErrorClass
} from './telemetryTypes';

const EXACT_ROUTES: Record<string, TelemetryPageRouteKey> = {
    '/login': 'login',
    '/feed': 'feed',
    '/friends-locations': 'friends_locations',
    '/game-log': 'game_log',
    '/instance-history': 'instance_history',
    '/player-list': 'player_list',
    '/search': 'search',
    '/favorites/friends': 'favorites_friends',
    '/favorites/worlds': 'favorites_worlds',
    '/favorites/avatars': 'favorites_avatars',
    '/social/friend-log': 'friend_log',
    '/social/moderation': 'moderation',
    '/my-avatars': 'my_avatars',
    '/notification': 'notification',
    '/social/friend-list': 'friend_list',
    '/charts/mutual': 'charts_mutual',
    '/tools': 'tools',
    '/settings': 'settings'
};

let currentRoute: TelemetryPageRouteKey | null = null;
let landingPending = true;

export function currentTelemetryRoute(): TelemetryPageRouteKey | null {
    return currentRoute;
}

function normalizePath(pathname: string): string {
    return pathname.split('?')[0].replace(/\/+$/, '') || '/';
}

export function normalizeRouteKey(
    pathname: string
): TelemetryPageRouteKey | null {
    const path = normalizePath(pathname);
    const exact = EXACT_ROUTES[path];
    if (exact) {
        return exact;
    }
    if (path === '/dashboard' || path.startsWith('/dashboard/')) {
        return 'dashboard';
    }
    return null;
}

export function recordRouteEnter(pathname: string): void {
    if (normalizePath(pathname) === '/') {
        currentRoute = null;
        return;
    }
    const route = normalizeRouteKey(pathname);
    const landing = landingPending && route !== 'login';
    landingPending = route === 'login';
    currentRoute = route;
    if (!route) {
        return;
    }
    recordTelemetryEvent({ type: 'pageVisit', route, landing });
}

export function recordRouteError(
    errorClass: TelemetryRouteErrorClass,
    error?: unknown
): void {
    if (!currentRoute) {
        return;
    }
    recordTelemetryEvent({
        type: 'routeError',
        error_class: errorClass,
        name: error instanceof Error ? error.name : typeof error,
        summary: error instanceof Error ? error.message : String(error ?? '')
    });
}
