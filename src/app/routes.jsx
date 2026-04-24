import { Navigate } from 'react-router-dom';

import { LoginPage } from '@/features/auth/LoginPage.jsx';
import { InstanceActivityPage } from '@/features/charts/InstanceActivityPage.jsx';
import { MutualFriendsPage } from '@/features/charts/MutualFriendsPage.jsx';
import { DashboardPage } from '@/features/dashboard/DashboardPage.jsx';
import {
    FavoriteAvatarsPage,
    FavoriteFriendsPage,
    FavoriteWorldsPage
} from '@/features/favorites/FavoritesPage.jsx';
import { FeedPage } from '@/features/feed/FeedPage.jsx';
import { FriendListPage } from '@/features/friends/FriendListPage.jsx';
import { FriendLogPage } from '@/features/friends/FriendLogPage.jsx';
import { FriendsLocationsPage } from '@/features/friends/FriendsLocationsPage.jsx';
import { GameLogPage } from '@/features/game-log/GameLogPage.jsx';
import { ModerationPage } from '@/features/moderation/ModerationPage.jsx';
import { MyAvatarsPage } from '@/features/my-avatars/MyAvatarsPage.jsx';
import { VrcNotificationPage } from '@/features/notifications/VrcNotificationPage.jsx';
import { PlayerListPage } from '@/features/player-list/PlayerListPage.jsx';
import { SearchPage } from '@/features/search/SearchPage.jsx';
import { SettingsPage } from '@/features/settings/SettingsPage.jsx';
import { GalleryPage } from '@/features/tools/GalleryPage.jsx';
import { ScreenshotMetadataPage } from '@/features/tools/ScreenshotMetadataPage.jsx';
import { ToolsPage } from '@/features/tools/ToolsPage.jsx';

export const publicRoutes = [
    {
        path: '/login',
        element: <LoginPage />
    }
];

export const protectedRoutes = [
    {
        path: '/feed',
        titleKey: 'app.routes.feed',
        descriptionKey: 'app.routes.table_heavy_social_feed_page',
        element: <FeedPage />
    },
    {
        path: '/friends-locations',
        titleKey: 'app.routes.friend_locations',
        descriptionKey: 'app.routes.live_friend_location_board_for_finding_people',
        element: <FriendsLocationsPage />
    },
    {
        path: '/game-log',
        titleKey: 'app.routes.game_log',
        descriptionKey: 'app.routes.table_heavy_game_event_log',
        element: <GameLogPage />
    },
    {
        path: '/player-list',
        titleKey: 'app.routes.current_players',
        descriptionKey: 'app.routes.current_instance_player_roster_rebuilt_from_loca',
        element: <PlayerListPage />
    },
    {
        path: '/search',
        titleKey: 'app.routes.search',
        descriptionKey: 'app.routes.world_and_group_search_route',
        element: <SearchPage />
    },
    {
        path: '/dashboard/:id',
        titleKey: 'app.routes.dashboard',
        descriptionKey: 'app.routes.dashboard_shell_with_embedded_widgets_and_suppor',
        element: <DashboardPage />
    },
    {
        path: '/favorites/friends',
        titleKey: 'app.routes.favorite_friends',
        descriptionKey: 'app.routes.favorite_friends_groups_and_local_cache_view',
        element: <FavoriteFriendsPage />
    },
    {
        path: '/favorites/worlds',
        titleKey: 'app.routes.favorite_worlds',
        descriptionKey: 'app.routes.favorite_worlds_groups_and_local_cache_view',
        element: <FavoriteWorldsPage />
    },
    {
        path: '/favorites/avatars',
        titleKey: 'app.routes.favorite_avatars',
        descriptionKey: 'app.routes.favorite_avatars_groups_and_local_cache_view',
        element: <FavoriteAvatarsPage />
    },
    {
        path: '/social/friend-log',
        titleKey: 'app.routes.friend_history',
        descriptionKey: 'app.routes.friend_relationship_history_table_backed_by_loca',
        element: <FriendLogPage />
    },
    {
        path: '/social/moderation',
        titleKey: 'app.routes.moderation',
        descriptionKey: 'app.routes.moderation_history_table',
        element: <ModerationPage />
    },
    {
        path: '/my-avatars',
        titleKey: 'app.routes.my_avatars',
        descriptionKey: 'app.routes.my_avatars_browser_with_grid_and_table_modes',
        element: <MyAvatarsPage />
    },
    {
        path: '/notification',
        titleKey: 'app.routes.notification',
        descriptionKey: 'app.routes.notification_center_table',
        element: <VrcNotificationPage />
    },
    {
        path: '/social/friend-list',
        titleKey: 'app.routes.friends',
        descriptionKey: 'app.routes.friend_management_table_and_roster_details',
        element: <FriendListPage />
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
        element: <InstanceActivityPage />
    },
    {
        path: '/charts/mutual',
        titleKey: 'app.routes.charts_mutual',
        descriptionKey: 'app.routes.mutual_friends_graph_over_cached_data',
        element: <MutualFriendsPage />
    },
    {
        path: '/tools',
        titleKey: 'app.routes.tools',
        descriptionKey: 'app.routes.tools_landing_route_and_folder_shortcuts',
        element: <ToolsPage />
    },
    {
        path: '/tools/gallery',
        titleKey: 'app.routes.gallery',
        descriptionKey: 'app.routes.gallery_browser_and_media_actions',
        element: <GalleryPage />
    },
    {
        path: '/tools/screenshot-metadata',
        titleKey: 'app.routes.screenshot_metadata',
        descriptionKey: 'app.routes.screenshot_metadata_browser_and_file_actions',
        element: <ScreenshotMetadataPage />
    },
    {
        path: '/settings',
        titleKey: 'app.routes.settings',
        descriptionKey: 'app.routes.settings_and_diagnostics',
        element: <SettingsPage />
    }
];
