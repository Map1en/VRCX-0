import { toolNavDefinitions } from './tools';

const navDefinitions = [
    {
        key: 'feed',
        icon: 'lucide:Rss',
        tooltip: 'nav_tooltip.feed',
        labelKey: 'nav_tooltip.feed',
        routeName: 'feed'
    },
    {
        key: 'friends-locations',
        icon: 'lucide:MapPin',
        tooltip: 'nav_tooltip.friends_locations',
        labelKey: 'nav_tooltip.friends_locations',
        routeName: 'friends-locations'
    },
    {
        key: 'game-log',
        icon: 'lucide:History',
        tooltip: 'nav_tooltip.game_log',
        labelKey: 'nav_tooltip.game_log',
        routeName: 'game-log'
    },
    {
        key: 'player-list',
        icon: 'lucide:UsersRound',
        tooltip: 'nav_tooltip.player_list',
        labelKey: 'nav_tooltip.player_list',
        routeName: 'player-list'
    },
    {
        key: 'search',
        icon: 'lucide:Search',
        tooltip: 'nav_tooltip.search',
        labelKey: 'nav_tooltip.search',
        routeName: 'search'
    },
    {
        key: 'favorite-friends',
        icon: 'lucide:UserStar',
        tooltip: 'nav_tooltip.favorite_friends',
        labelKey: 'nav_tooltip.favorite_friends',
        routeName: 'favorite-friends'
    },
    {
        key: 'favorite-worlds',
        icon: 'lucide:MapPinned',
        tooltip: 'nav_tooltip.favorite_worlds',
        labelKey: 'nav_tooltip.favorite_worlds',
        routeName: 'favorite-worlds'
    },
    {
        key: 'favorite-avatars',
        icon: 'lucide:Box',
        tooltip: 'nav_tooltip.favorite_avatars',
        labelKey: 'nav_tooltip.favorite_avatars',
        routeName: 'favorite-avatars'
    },
    {
        key: 'friend-log',
        icon: 'lucide:Contact',
        tooltip: 'nav_tooltip.friend_log',
        labelKey: 'nav_tooltip.friend_log',
        routeName: 'friend-log'
    },
    {
        key: 'friend-list',
        icon: 'lucide:BookOpen',
        tooltip: 'nav_tooltip.friend_list',
        labelKey: 'nav_tooltip.friend_list',
        routeName: 'friend-list'
    },
    {
        key: 'moderation',
        icon: 'lucide:ShieldUser',
        tooltip: 'nav_tooltip.moderation',
        labelKey: 'nav_tooltip.moderation',
        routeName: 'moderation'
    },
    {
        key: 'notification',
        icon: 'lucide:Bell',
        tooltip: 'nav_tooltip.notification',
        labelKey: 'nav_tooltip.notification',
        routeName: 'notification'
    },
    {
        key: 'my-avatars',
        icon: 'lucide:Shirt',
        tooltip: 'nav_tooltip.my_avatars',
        labelKey: 'nav_tooltip.my_avatars',
        routeName: 'my-avatars'
    },
    {
        key: 'charts-instance',
        icon: 'lucide:ChartBar',
        tooltip: 'view.charts.instance_activity.header',
        labelKey: 'view.charts.instance_activity.header',
        routeName: 'charts-instance'
    },
    {
        key: 'charts-mutual',
        icon: 'lucide:Users',
        tooltip: 'view.charts.mutual_friend.tab_label',
        labelKey: 'view.charts.mutual_friend.tab_label',
        routeName: 'charts-mutual'
    },
    {
        key: 'tools',
        icon: 'lucide:Wrench',
        tooltip: 'nav_tooltip.tools',
        labelKey: 'nav_tooltip.tools',
        routeName: 'tools'
    },
    ...toolNavDefinitions
];

export { navDefinitions };
