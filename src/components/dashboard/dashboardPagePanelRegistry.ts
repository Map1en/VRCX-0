import type { ElementType } from 'react';

import {
    FavoriteAvatarsPage,
    FavoriteFriendsPage,
    FavoriteWorldsPage
} from '@/features/favorites/FavoritesPage';
import { FeedPage } from '@/features/feed/FeedPage';
import { FriendListPage } from '@/features/friends/FriendListPage';
import { FriendLogPage } from '@/features/friends/FriendLogPage';
import { FriendsLocationsPage } from '@/features/friends/FriendsLocationsPage';
import { GameLogPage } from '@/features/game-log/GameLogPage';
import { ModerationPage } from '@/features/moderation/ModerationPage';
import { MyAvatarsPage } from '@/features/my-avatars/MyAvatarsPage';
import { VrcNotificationPage } from '@/features/notifications/VrcNotificationPage';
import { PlayerListPage } from '@/features/player-list/PlayerListPage';
import { SearchPage } from '@/features/search/SearchPage';
import { ToolsPage } from '@/features/tools/ToolsPage';

const dashboardPagePanelComponentMap: Record<string, ElementType> = {
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
    tools: ToolsPage
};

export function getDashboardPagePanelComponent(key: unknown) {
    const normalizedKey = String(key || '').trim();
    return normalizedKey
        ? (dashboardPagePanelComponentMap[normalizedKey] ?? null)
        : null;
}

export function canEmbedDashboardPagePanel(key: unknown) {
    return Boolean(getDashboardPagePanelComponent(key));
}
