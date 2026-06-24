import { postTelemetry } from './telemetryClient';
import { isAnonymousUsageTelemetryEnabled } from './telemetryConfig';
import {
    recordTelemetryErrorDetail,
    serializeTelemetryErrorDetails
} from './telemetryErrorDetails';
import { buildTelemetryContext } from './telemetryPayload';
import type {
    TelemetryErrorDetail,
    TelemetryPageRouteKey,
    TelemetryPageUsageEntry,
    TelemetryRouteErrorClass,
    TelemetrySessionState
} from './telemetryTypes';

const EXACT_ROUTES: Record<string, TelemetryPageRouteKey> = {
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
    '/tools/gallery': 'gallery',
    '/tools/inventory': 'inventory',
    '/tools/screenshot-metadata': 'screenshot_metadata',
    '/tools/vrchat-log': 'vrchat_log',
    '/themes': 'themes',
    '/settings': 'settings'
};

export function normalizeRouteKey(
    pathname: string
): TelemetryPageRouteKey | null {
    const path = pathname.split('?')[0].replace(/\/+$/, '') || '/';
    const exact = EXACT_ROUTES[path];
    if (exact) {
        return exact;
    }
    if (path === '/dashboard' || path.startsWith('/dashboard/')) {
        return 'dashboard';
    }
    return null;
}

type RouteUsage = {
    visits: number;
    errors: Record<TelemetryRouteErrorClass, number>;
    details: Map<string, TelemetryErrorDetail>;
};

const usage = new Map<TelemetryPageRouteKey, RouteUsage>();
let currentRoute: TelemetryPageRouteKey | null = null;

function ensureUsage(route: TelemetryPageRouteKey): RouteUsage {
    let entry = usage.get(route);
    if (!entry) {
        entry = {
            visits: 0,
            errors: { load_fail: 0, render_crash: 0 },
            details: new Map()
        };
        usage.set(route, entry);
    }
    return entry;
}

export function recordRouteEnter(pathname: string): void {
    if (!isAnonymousUsageTelemetryEnabled()) {
        return;
    }
    const route = normalizeRouteKey(pathname);
    currentRoute = route;
    if (route) {
        ensureUsage(route).visits += 1;
    }
}

export function recordRouteError(
    errorClass: TelemetryRouteErrorClass,
    error?: unknown
): void {
    if (!isAnonymousUsageTelemetryEnabled() || !currentRoute) {
        return;
    }
    const entry = ensureUsage(currentRoute);
    entry.errors[errorClass] += 1;
    recordTelemetryErrorDetail(entry.details, {
        kind: errorClass,
        name: error instanceof Error ? error.name : typeof error,
        summary: error instanceof Error ? error.message : String(error ?? '')
    });
}

export async function sendPageReach(
    session: TelemetrySessionState
): Promise<void> {
    if (!isAnonymousUsageTelemetryEnabled() || usage.size === 0) {
        return;
    }
    const routes: TelemetryPageUsageEntry[] = [];
    for (const [route, entry] of usage) {
        const result: TelemetryPageUsageEntry = {
            route,
            visits: entry.visits
        };
        if (entry.errors.load_fail > 0) {
            result.loadFail = entry.errors.load_fail;
        }
        if (entry.errors.render_crash > 0) {
            result.renderCrash = entry.errors.render_crash;
        }
        const details = serializeTelemetryErrorDetails(entry.details);
        if (details) {
            result.details = details;
        }
        routes.push(result);
    }
    await postTelemetry('/api/v1/telemetry/page-health', {
        ...buildTelemetryContext(session),
        routes
    });
}

export function resetPageReach(): void {
    usage.clear();
    currentRoute = null;
}
