import { createContext, useContext } from 'react';

import { useFriendsLocationsPageController } from './useFriendsLocationsPageController.js';

const FriendsLocationsPageContext = createContext(null);

export function FriendsLocationsPageProvider({ embedded = false, children }) {
    const value = useFriendsLocationsPageController({ embedded });

    return (
        <FriendsLocationsPageContext.Provider value={value}>
            {children}
        </FriendsLocationsPageContext.Provider>
    );
}

export function useFriendsLocationsPage() {
    const value = useContext(FriendsLocationsPageContext);
    if (!value) {
        throw new Error(
            'useFriendsLocationsPage must be used within FriendsLocationsPageProvider.'
        );
    }
    return value;
}
