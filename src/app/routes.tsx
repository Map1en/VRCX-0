import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';

import { Spinner } from '@/ui/shadcn/spinner';

export function RouteLoadingFallback() {
    return (
        <div className="text-muted-foreground flex h-full min-h-0 items-center justify-center gap-2 text-sm">
            <Spinner className="size-4" />
        </div>
    );
}

function lazyRouteElement(importPage: any, exportName: any) {
    const RouteComponent = lazy(() =>
        importPage().then((module: any) => ({
            default: module[exportName]
        }))
    );

    return (
        <Suspense fallback={<RouteLoadingFallback />}>
            <RouteComponent />
        </Suspense>
    );
}

export const publicRoutes = [
    {
        path: '/login',
        element: lazyRouteElement(
            () => import('@/features/auth/LoginPage'),
            'LoginPage'
        )
    }
];

export const protectedRoutes = [
    {
        path: '/feed',
        titleKey: 'app.routes.feed',
        descriptionKey: 'app.routes.table_heavy_social_feed_page',
        element: lazyRouteElement(
            () => import('@/features/feed/FeedPage'),
            'FeedPage'
        )
    },
    {
        path: '/friends-locations',
        titleKey: 'app.routes.friend_locations',
        descriptionKey:
            'app.routes.live_friend_location_board_for_finding_people',
        element: lazyRouteElement(
            () => import('@/features/friends/FriendsLocationsPage'),
            'FriendsLocationsPage'
        )
    },
    {
        path: '/game-log',
        titleKey: 'app.routes.game_log',
        descriptionKey: 'app.routes.table_heavy_game_event_log',
        element: lazyRouteElement(
            () => import('@/features/game-log/GameLogPage'),
            'GameLogPage'
        )
    },
    {
        path: '/instance-history',
        titleKey: 'app.routes.instance_history',
        descriptionKey: 'app.routes.local_instance_history_for_a_selected_user',
        element: lazyRouteElement(
            () => import('@/features/instance-history/InstanceHistoryPage'),
            'InstanceHistoryPage'
        )
    },
    {
        path: '/player-list',
        titleKey: 'app.routes.current_players',
        descriptionKey:
            'app.routes.current_instance_player_roster_rebuilt_from_local_activity_data',
        element: lazyRouteElement(
            () => import('@/features/player-list/PlayerListPage'),
            'PlayerListPage'
        )
    },
    {
        path: '/search',
        titleKey: 'app.routes.search',
        descriptionKey: 'app.routes.world_and_group_search_route',
        element: lazyRouteElement(
            () => import('@/features/search/SearchPage'),
            'SearchPage'
        )
    },
    {
        path: '/dashboard/:id',
        titleKey: 'app.routes.dashboard',
        descriptionKey:
            'app.routes.dashboard_shell_with_embedded_widgets_and_suppor',
        element: lazyRouteElement(
            () => import('@/features/dashboard/DashboardPage'),
            'DashboardPage'
        )
    },
    {
        path: '/favorites/friends',
        titleKey: 'app.routes.favorite_friends',
        descriptionKey:
            'app.routes.favorite_friends_groups_and_local_cache_view',
        element: lazyRouteElement(
            () => import('@/features/favorites/FavoritesPage'),
            'FavoriteFriendsPage'
        )
    },
    {
        path: '/favorites/worlds',
        titleKey: 'app.routes.favorite_worlds',
        descriptionKey:
            'app.routes.favorite_worlds_groups_and_local_cache_view',
        element: lazyRouteElement(
            () => import('@/features/favorites/FavoritesPage'),
            'FavoriteWorldsPage'
        )
    },
    {
        path: '/favorites/avatars',
        titleKey: 'app.routes.favorite_avatars',
        descriptionKey:
            'app.routes.favorite_avatars_groups_and_local_cache_view',
        element: lazyRouteElement(
            () => import('@/features/favorites/FavoritesPage'),
            'FavoriteAvatarsPage'
        )
    },
    {
        path: '/social/friend-log',
        titleKey: 'app.routes.friend_history',
        descriptionKey:
            'app.routes.friend_relationship_history_table_backed_by_loca',
        element: lazyRouteElement(
            () => import('@/features/friends/FriendLogPage'),
            'FriendLogPage'
        )
    },
    {
        path: '/social/moderation',
        titleKey: 'app.routes.moderation',
        descriptionKey: 'app.routes.moderation_history_table',
        element: lazyRouteElement(
            () => import('@/features/moderation/ModerationPage'),
            'ModerationPage'
        )
    },
    {
        path: '/my-avatars',
        titleKey: 'app.routes.my_avatars',
        descriptionKey:
            'app.routes.my_avatars_browser_with_grid_and_table_modes',
        element: lazyRouteElement(
            () => import('@/features/my-avatars/MyAvatarsPage'),
            'MyAvatarsPage'
        )
    },
    {
        path: '/notification',
        titleKey: 'app.routes.notification',
        descriptionKey: 'app.routes.notification_center_table',
        element: lazyRouteElement(
            () => import('@/features/notifications/VrcNotificationPage'),
            'VrcNotificationPage'
        )
    },
    {
        path: '/social/friend-list',
        titleKey: 'app.routes.friends',
        descriptionKey: 'app.routes.friend_management_table_and_roster_details',
        element: lazyRouteElement(
            () => import('@/features/friends/FriendListPage'),
            'FriendListPage'
        )
    },
    {
        path: '/charts',
        titleKey: 'app.routes.charts',
        descriptionKey: 'app.routes.charts_landing_route',
        element: <Navigate to="/charts/instance" replace />
    },
    {
        path: '/charts/instance',
        titleKey: 'app.routes.charts_instance',
        descriptionKey: 'app.routes.instance_activity_timeline_chart',
        element: lazyRouteElement(
            () => import('@/features/charts/InstanceActivityPage'),
            'InstanceActivityPage'
        )
    },
    {
        path: '/charts/mutual',
        titleKey: 'app.routes.charts_mutual',
        descriptionKey: 'app.routes.mutual_friends_graph_over_cached_data',
        element: lazyRouteElement(
            () => import('@/features/charts/MutualFriendsPage'),
            'MutualFriendsPage'
        )
    },
    {
        path: '/tools',
        titleKey: 'app.routes.tools',
        descriptionKey: 'app.routes.tools_landing_route_and_folder_shortcuts',
        element: lazyRouteElement(
            () => import('@/features/tools/ToolsPage'),
            'ToolsPage'
        )
    },
    {
        path: '/tools/gallery',
        titleKey: 'app.routes.gallery',
        descriptionKey: 'app.routes.gallery_browser_and_media_actions',
        element: lazyRouteElement(
            () => import('@/features/tools/GalleryPage'),
            'GalleryPage'
        )
    },
    {
        path: '/tools/inventory',
        titleKey: 'app.routes.inventory',
        descriptionKey: 'app.routes.inventory_browser_and_media_actions',
        element: lazyRouteElement(
            () => import('@/features/tools/InventoryPage'),
            'InventoryPage'
        )
    },
    {
        path: '/tools/screenshot-metadata',
        titleKey: 'app.routes.screenshot_metadata',
        descriptionKey:
            'app.routes.screenshot_metadata_browser_and_file_actions',
        element: lazyRouteElement(
            () => import('@/features/tools/ScreenshotMetadataPage'),
            'ScreenshotMetadataPage'
        )
    },
    {
        path: '/tools/vrchat-log',
        titleKey: 'app.routes.vrchat_log',
        descriptionKey: 'app.routes.vrchat_log_viewer_for_local_output_logs',
        element: lazyRouteElement(
            () => import('@/features/tools/VrchatLogPage'),
            'VrchatLogPage'
        )
    },
    {
        path: '/themes',
        titleKey: 'app.routes.themes',
        descriptionKey: 'app.routes.themes_description',
        element: lazyRouteElement(
            () => import('@/features/themes/ThemesPage'),
            'ThemesPage'
        )
    },
    {
        path: '/community-themes',
        element: <Navigate to="/themes" replace />
    },
    {
        path: '/settings',
        titleKey: 'app.routes.settings',
        descriptionKey: 'app.routes.settings_and_diagnostics',
        element: lazyRouteElement(
            () => import('@/features/settings/SettingsPage'),
            'SettingsPage'
        )
    }
];
