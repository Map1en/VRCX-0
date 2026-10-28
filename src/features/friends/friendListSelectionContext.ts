import { createContext, useContext } from 'react';

export const FriendListSelectedIdsContext =
    createContext<ReadonlySet<string> | null>(null);

export function useFriendListSelectedIds(): ReadonlySet<string> {
    const selectedFriendIds = useContext(FriendListSelectedIdsContext);
    if (!selectedFriendIds) {
        throw new Error('Friend list selection requires a provider.');
    }
    return selectedFriendIds;
}
