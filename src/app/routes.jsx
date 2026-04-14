import { Navigate } from 'react-router-dom';

import { LoginPage } from '@/features/auth/LoginPage.jsx';
import { InstanceActivityPage } from '@/features/charts/InstanceActivityPage.jsx';
import { MutualFriendsPage } from '@/features/charts/MutualFriendsPage.jsx';
import { DashboardPage } from '@/features/dashboard/DashboardPage.jsx';
import { FeedPage } from '@/features/feed/FeedPage.jsx';
import {
    FavoriteAvatarsPage,
    FavoriteFriendsPage,
    FavoriteWorldsPage
} from '@/features/favorites/FavoritesPage.jsx';
import { GameLogPage } from '@/features/game-log/GameLogPage.jsx';
import { FriendLogPage } from '@/features/friends/FriendLogPage.jsx';
import { FriendsLocationsPage } from '@/features/friends/FriendsLocationsPage.jsx';
import { FriendListPage } from '@/features/friends/FriendListPage.jsx';
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
        title: 'Feed',
        description: 'Table-heavy social feed page.',
        element: <FeedPage />
    },
    {
        path: '/friends-locations',
        title: 'Friends Locations',
        description: 'Live friend presence and location board.',
        element: <FriendsLocationsPage />
    },
    {
        path: '/game-log',
        title: 'Game Log',
        description: 'Table-heavy game event log.',
        element: <GameLogPage />
    },
    {
        path: '/player-list',
        title: 'Player List',
        description: 'Current-instance player roster rebuilt from local activity data.',
        element: <PlayerListPage />
    },
    {
        path: '/search',
        title: 'Search',
        description: 'World and group search route.',
        element: <SearchPage />
    },
    {
        path: '/dashboard/:id',
        title: 'Dashboard',
        description: 'Dashboard shell with embedded widgets and supported page panels.',
        element: <DashboardPage />
    },
    {
        path: '/favorites/friends',
        title: 'Favorite Friends',
        description: 'Favorite friends groups and local cache view.',
        element: <FavoriteFriendsPage />
    },
    {
        path: '/favorites/worlds',
        title: 'Favorite Worlds',
        description: 'Favorite worlds groups and local cache view.',
        element: <FavoriteWorldsPage />
    },
    {
        path: '/favorites/avatars',
        title: 'Favorite Avatars',
        description: 'Favorite avatars groups and local cache view.',
        element: <FavoriteAvatarsPage />
    },
    {
        path: '/social/friend-log',
        title: 'Friend Log',
        description: 'Friend history table backed by local SQL.',
        element: <FriendLogPage />
    },
    {
        path: '/social/moderation',
        title: 'Moderation',
        description: 'Moderation history table.',
        element: <ModerationPage />
    },
    {
        path: '/my-avatars',
        title: 'My Avatars',
        description: 'My avatars browser with grid and table modes.',
        element: <MyAvatarsPage />
    },
    {
        path: '/notification',
        title: 'Notification',
        description: 'Notification center table.',
        element: <VrcNotificationPage />
    },
    {
        path: '/social/friend-list',
        title: 'Friend List',
        description: 'Friend roster table.',
        element: <FriendListPage />
    },
    {
        path: '/charts',
        title: 'Charts',
        description: 'Charts landing route.',
        element: <Navigate to="/charts/instance" replace />
    },
    {
        path: '/charts/instance',
        title: 'Charts Instance',
        description: 'Instance activity timeline chart.',
        element: <InstanceActivityPage />
    },
    {
        path: '/charts/mutual',
        title: 'Charts Mutual',
        description: 'Mutual-friends graph over cached data.',
        element: <MutualFriendsPage />
    },
    {
        path: '/tools',
        title: 'Tools',
        description: 'Tools landing route and folder shortcuts.',
        element: <ToolsPage />
    },
    {
        path: '/tools/gallery',
        title: 'Gallery',
        description: 'Gallery browser and media actions.',
        element: <GalleryPage />
    },
    {
        path: '/tools/screenshot-metadata',
        title: 'Screenshot Metadata',
        description: 'Screenshot metadata browser and file actions.',
        element: <ScreenshotMetadataPage />
    },
    {
        path: '/settings',
        title: 'Settings',
        description: 'Settings and diagnostics.',
        element: <SettingsPage />
    }
];
