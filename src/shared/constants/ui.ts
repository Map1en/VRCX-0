import { toolNavDefinitions } from './tools';

const navDefinitions = [
    {
        key: 'feed',
        icon: 'Feed',
        tooltip: 'nav_tooltip.feed',
        labelKey: 'nav_tooltip.feed',
        routeName: 'feed'
    },
    {
        key: 'friends-locations',
        icon: 'Location',
        tooltip: 'nav_tooltip.friends_locations',
        labelKey: 'nav_tooltip.friends_locations',
        routeName: 'friends-locations'
    },
    {
        key: 'game-log',
        icon: 'GameLog',
        tooltip: 'nav_tooltip.game_log',
        labelKey: 'nav_tooltip.game_log',
        routeName: 'game-log'
    },
    {
        key: 'instance-history',
        icon: 'InstanceHistory',
        tooltip: 'nav_tooltip.instance_history',
        labelKey: 'nav_tooltip.instance_history',
        routeName: 'instance-history'
    },
    {
        key: 'player-list',
        icon: 'Players',
        tooltip: 'nav_tooltip.player_list',
        labelKey: 'nav_tooltip.player_list',
        routeName: 'player-list'
    },
    {
        key: 'search',
        icon: 'Search',
        tooltip: 'nav_tooltip.search',
        labelKey: 'nav_tooltip.search',
        routeName: 'search'
    },
    {
        key: 'favorite-friends',
        icon: 'FavoriteFriends',
        tooltip: 'nav_tooltip.favorite_friends',
        labelKey: 'nav_tooltip.favorite_friends',
        routeName: 'favorite-friends'
    },
    {
        key: 'favorite-worlds',
        icon: 'FavoriteWorlds',
        tooltip: 'nav_tooltip.favorite_worlds',
        labelKey: 'nav_tooltip.favorite_worlds',
        routeName: 'favorite-worlds'
    },
    {
        key: 'favorite-avatars',
        icon: 'FavoriteAvatars',
        tooltip: 'nav_tooltip.favorite_avatars',
        labelKey: 'nav_tooltip.favorite_avatars',
        routeName: 'favorite-avatars'
    },
    {
        key: 'friend-log',
        icon: 'FriendLog',
        tooltip: 'nav_tooltip.friend_log',
        labelKey: 'nav_tooltip.friend_log',
        routeName: 'friend-log'
    },
    {
        key: 'friend-list',
        icon: 'FriendList',
        tooltip: 'nav_tooltip.friend_list',
        labelKey: 'nav_tooltip.friend_list',
        routeName: 'friend-list'
    },
    {
        key: 'moderation',
        icon: 'Moderation',
        tooltip: 'nav_tooltip.moderation',
        labelKey: 'nav_tooltip.moderation',
        routeName: 'moderation'
    },
    {
        key: 'notification',
        icon: 'Notification',
        tooltip: 'nav_tooltip.notification',
        labelKey: 'nav_tooltip.notification',
        routeName: 'notification'
    },
    {
        key: 'my-avatars',
        icon: 'MyAvatars',
        tooltip: 'nav_tooltip.my_avatars',
        labelKey: 'nav_tooltip.my_avatars',
        routeName: 'my-avatars'
    },
    {
        key: 'charts-mutual',
        icon: 'ChartsMutual',
        tooltip: 'view.charts.mutual_friend.tab_label',
        labelKey: 'view.charts.mutual_friend.tab_label',
        routeName: 'charts-mutual'
    },
    {
        key: 'tools',
        icon: 'Tools',
        tooltip: 'nav_tooltip.tools',
        labelKey: 'nav_tooltip.tools',
        routeName: 'tools'
    },
    ...toolNavDefinitions
];

export { navDefinitions };
