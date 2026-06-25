export const OWNER_USER_ID = 'usr_63f57413-1470-4703-b655-50b7c0845414';

type SelectOption = {
    name: string;
    value: string;
};

const userDialogWorldSortingOptions: Record<string, SelectOption> = {
    name: {
        name: 'dialog.user.worlds.sorting.name',
        value: 'name'
    },
    updated: {
        name: 'dialog.user.worlds.sorting.updated',
        value: 'updated'
    },
    created: {
        name: 'dialog.user.worlds.sorting.created',
        value: 'created'
    },
    favorites: {
        name: 'dialog.user.worlds.sorting.favorites',
        value: 'favorites'
    },
    popularity: {
        name: 'dialog.user.worlds.sorting.popularity',
        value: 'popularity'
    }
};

const userDialogWorldOrderOptions: Record<string, SelectOption> = {
    descending: {
        name: 'dialog.user.worlds.order.descending',
        value: 'descending'
    },
    ascending: {
        name: 'dialog.user.worlds.order.ascending',
        value: 'ascending'
    }
};

const userDialogGroupSortingOptions: Record<string, SelectOption> = {
    alphabetical: {
        name: 'dialog.user.groups.sorting.alphabetical',
        value: 'alphabetical'
    },
    members: {
        name: 'dialog.user.groups.sorting.members',
        value: 'members'
    },
    inGame: {
        name: 'dialog.user.groups.sorting.in_game',
        value: 'inGame'
    }
};

const userDialogMutualFriendSortingOptions: Record<string, SelectOption> = {
    alphabetical: {
        name: 'dialog.user.mutual_friends.sorting.alphabetical',
        value: 'alphabetical'
    },
    lastActive: {
        name: 'dialog.user.mutual_friends.sorting.last_active',
        value: 'lastActive'
    },
    friendOrder: {
        name: 'dialog.user.mutual_friends.sorting.friend_order',
        value: 'friendOrder'
    }
};

export {
    userDialogWorldSortingOptions,
    userDialogWorldOrderOptions,
    userDialogGroupSortingOptions,
    userDialogMutualFriendSortingOptions
};
