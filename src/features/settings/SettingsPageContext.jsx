import { createContext, useContext } from 'react';

import { useSettingsPageController } from './useSettingsPageController.js';

const SettingsPageContext = createContext(null);

export function SettingsPageProvider({ children }) {
    const value = useSettingsPageController();

    return (
        <SettingsPageContext.Provider value={value}>
            {children}
        </SettingsPageContext.Provider>
    );
}

export function useSettingsPage() {
    const value = useContext(SettingsPageContext);
    if (!value) {
        throw new Error(
            'useSettingsPage must be used within SettingsPageProvider.'
        );
    }
    return value;
}
