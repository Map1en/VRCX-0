import { InstanceActivityPage } from '@/features/charts/InstanceActivityPage.jsx';
import { MutualFriendsPage } from '@/features/charts/MutualFriendsPage.jsx';
import { FeedPage } from '@/features/feed/FeedPage.jsx';
import {
    FavoriteAvatarsPage,
    FavoriteFriendsPage,
    FavoriteWorldsPage
} from '@/features/favorites/FavoritesPage.jsx';
import { FriendListPage } from '@/features/friends/FriendListPage.jsx';
import { FriendLogPage } from '@/features/friends/FriendLogPage.jsx';
import { FriendsLocationsPage } from '@/features/friends/FriendsLocationsPage.jsx';
import { GameLogPage } from '@/features/game-log/GameLogPage.jsx';
import { ModerationPage } from '@/features/moderation/ModerationPage.jsx';
import { MyAvatarsPage } from '@/features/my-avatars/MyAvatarsPage.jsx';
import { VrcNotificationPage } from '@/features/notifications/VrcNotificationPage.jsx';
import { PlayerListPage } from '@/features/player-list/PlayerListPage.jsx';
import { SearchPage } from '@/features/search/SearchPage.jsx';
import { ToolsPage } from '@/features/tools/ToolsPage.jsx';

const dashboardPagePanelComponentMap = {
    feed: FeedPage,
    'friends-locations': FriendsLocationsPage,
    'game-log': GameLogPage,
    'player-list': PlayerListPage,
    search: SearchPage,
    'favorite-friends': FavoriteFriendsPage,
    'favorite-worlds': FavoriteWorldsPage,
    'favorite-avatars': FavoriteAvatarsPage,
    'social/friend-log': FriendLogPage,
    'social/friend-list': FriendListPage,
    'social/moderation': ModerationPage,
    notification: VrcNotificationPage,
    'my-avatars': MyAvatarsPage,
    'friend-log': FriendLogPage,
    'friend-list': FriendListPage,
    moderation: ModerationPage,
    'charts-instance': InstanceActivityPage,
    'charts-mutual': MutualFriendsPage,
    tools: ToolsPage
};

export function getDashboardPagePanelComponent(key) {
    const normalizedKey = String(key || '').trim();
    return normalizedKey ? dashboardPagePanelComponentMap[normalizedKey] ?? null : null;
}

export function canEmbedDashboardPagePanel(key) {
    return Boolean(getDashboardPagePanelComponent(key));
}
