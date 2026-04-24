import { createContext, useContext } from 'react';

import { useSettingsPageController } from './useSettingsPageController.js';

const SettingsShellContext = createContext(null);
const SettingsSystemContext = createContext(null);
const SettingsInterfaceContext = createContext(null);
const SettingsMediaContext = createContext(null);
const SettingsIntegrationsContext = createContext(null);
const SettingsSocialContext = createContext(null);
const SettingsNotificationsContext = createContext(null);
const SettingsAdvancedContext = createContext(null);
const SettingsDialogsContext = createContext(null);

function useRequiredSettingsContext(context, name) {
    const value = useContext(context);
    if (!value) {
        throw new Error(`${name} must be used within SettingsPageProvider.`);
    }
    return value;
}

export function SettingsPageProvider({ children }) {
    const value = useSettingsPageController();

    return (
        <SettingsShellContext.Provider value={value.shell}>
            <SettingsSystemContext.Provider value={value.system}>
                <SettingsInterfaceContext.Provider value={value.interface}>
                    <SettingsMediaContext.Provider value={value.media}>
                        <SettingsIntegrationsContext.Provider
                            value={value.integrations}
                        >
                            <SettingsSocialContext.Provider
                                value={value.social}
                            >
                                <SettingsNotificationsContext.Provider
                                    value={value.notifications}
                                >
                                    <SettingsAdvancedContext.Provider
                                        value={value.advanced}
                                    >
                                        <SettingsDialogsContext.Provider
                                            value={value.dialogs}
                                        >
                                            {children}
                                        </SettingsDialogsContext.Provider>
                                    </SettingsAdvancedContext.Provider>
                                </SettingsNotificationsContext.Provider>
                            </SettingsSocialContext.Provider>
                        </SettingsIntegrationsContext.Provider>
                    </SettingsMediaContext.Provider>
                </SettingsInterfaceContext.Provider>
            </SettingsSystemContext.Provider>
        </SettingsShellContext.Provider>
    );
}

export function useSettingsShell() {
    return useRequiredSettingsContext(SettingsShellContext, 'useSettingsShell');
}

export function useSettingsSystem() {
    return useRequiredSettingsContext(
        SettingsSystemContext,
        'useSettingsSystem'
    );
}

export function useSettingsInterface() {
    return useRequiredSettingsContext(
        SettingsInterfaceContext,
        'useSettingsInterface'
    );
}

export function useSettingsMedia() {
    return useRequiredSettingsContext(SettingsMediaContext, 'useSettingsMedia');
}

export function useSettingsIntegrationsSection() {
    return useRequiredSettingsContext(
        SettingsIntegrationsContext,
        'useSettingsIntegrationsSection'
    );
}

export function useSettingsSocial() {
    return useRequiredSettingsContext(
        SettingsSocialContext,
        'useSettingsSocial'
    );
}

export function useSettingsNotifications() {
    return useRequiredSettingsContext(
        SettingsNotificationsContext,
        'useSettingsNotifications'
    );
}

export function useSettingsAdvanced() {
    return useRequiredSettingsContext(
        SettingsAdvancedContext,
        'useSettingsAdvanced'
    );
}

export function useSettingsDialogs() {
    return useRequiredSettingsContext(
        SettingsDialogsContext,
        'useSettingsDialogs'
    );
}
