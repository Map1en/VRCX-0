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
import { appI18n } from '@/services/i18nService.js';

export const publicRoutes = [
    {
        path: '/login',
        element: <LoginPage />
    }
];

export const protectedRoutes = [
    {
        path: '/feed',
        title: appI18n.t('app.routes.feed'),
        description: appI18n.t('app.routes.table_heavy_social_feed_page'),
        element: <FeedPage />
    },
    {
        path: '/friends-locations',
        title: appI18n.t('app.routes.friend_locations'),
        description: appI18n.t('app.routes.live_friend_location_board_for_finding_people'),
        element: <FriendsLocationsPage />
    },
    {
        path: '/game-log',
        title: appI18n.t('app.routes.game_log'),
        description: appI18n.t('app.routes.table_heavy_game_event_log'),
        element: <GameLogPage />
    },
    {
        path: '/player-list',
        title: appI18n.t('app.routes.current_players'),
        description:
            appI18n.t('app.routes.current_instance_player_roster_rebuilt_from_loca'),
        element: <PlayerListPage />
    },
    {
        path: '/search',
        title: appI18n.t('app.routes.search'),
        description: appI18n.t('app.routes.world_and_group_search_route'),
        element: <SearchPage />
    },
    {
        path: '/dashboard/:id',
        title: appI18n.t('app.routes.dashboard'),
        description:
            appI18n.t('app.routes.dashboard_shell_with_embedded_widgets_and_suppor'),
        element: <DashboardPage />
    },
    {
        path: '/favorites/friends',
        title: appI18n.t('app.routes.favorite_friends'),
        description: appI18n.t('app.routes.favorite_friends_groups_and_local_cache_view'),
        element: <FavoriteFriendsPage />
    },
    {
        path: '/favorites/worlds',
        title: appI18n.t('app.routes.favorite_worlds'),
        description: appI18n.t('app.routes.favorite_worlds_groups_and_local_cache_view'),
        element: <FavoriteWorldsPage />
    },
    {
        path: '/favorites/avatars',
        title: appI18n.t('app.routes.favorite_avatars'),
        description: appI18n.t('app.routes.favorite_avatars_groups_and_local_cache_view'),
        element: <FavoriteAvatarsPage />
    },
    {
        path: '/social/friend-log',
        title: appI18n.t('app.routes.friend_history'),
        description: appI18n.t('app.routes.friend_relationship_history_table_backed_by_loca'),
        element: <FriendLogPage />
    },
    {
        path: '/social/moderation',
        title: appI18n.t('app.routes.moderation'),
        description: appI18n.t('app.routes.moderation_history_table'),
        element: <ModerationPage />
    },
    {
        path: '/my-avatars',
        title: appI18n.t('app.routes.my_avatars'),
        description: appI18n.t('app.routes.my_avatars_browser_with_grid_and_table_modes'),
        element: <MyAvatarsPage />
    },
    {
        path: '/notification',
        title: appI18n.t('app.routes.notification'),
        description: appI18n.t('app.routes.notification_center_table'),
        element: <VrcNotificationPage />
    },
    {
        path: '/social/friend-list',
        title: appI18n.t('app.routes.friends'),
        description: appI18n.t('app.routes.friend_management_table_and_roster_details'),
        element: <FriendListPage />
    },
    {
        path: '/charts',
        title: appI18n.t('app.routes.charts'),
        description: appI18n.t('app.routes.charts_landing_route'),
        element: <Navigate to="/charts/instance" replace />
    },
    {
        path: '/charts/instance',
        title: appI18n.t('app.routes.charts_instance'),
        description: appI18n.t('app.routes.instance_activity_timeline_chart'),
        element: <InstanceActivityPage />
    },
    {
        path: '/charts/mutual',
        title: appI18n.t('app.routes.charts_mutual'),
        description: appI18n.t('app.routes.mutual_friends_graph_over_cached_data'),
        element: <MutualFriendsPage />
    },
    {
        path: '/tools',
        title: appI18n.t('app.routes.tools'),
        description: appI18n.t('app.routes.tools_landing_route_and_folder_shortcuts'),
        element: <ToolsPage />
    },
    {
        path: '/tools/gallery',
        title: appI18n.t('app.routes.gallery'),
        description: appI18n.t('app.routes.gallery_browser_and_media_actions'),
        element: <GalleryPage />
    },
    {
        path: '/tools/screenshot-metadata',
        title: appI18n.t('app.routes.screenshot_metadata'),
        description: appI18n.t('app.routes.screenshot_metadata_browser_and_file_actions'),
        element: <ScreenshotMetadataPage />
    },
    {
        path: '/settings',
        title: appI18n.t('app.routes.settings'),
        description: appI18n.t('app.routes.settings_and_diagnostics'),
        element: <SettingsPage />
    }
];
