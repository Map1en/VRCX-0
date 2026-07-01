import { useCallback, useEffect, useState } from 'react';

import { setRightSidebarOpenPreference } from '@/services/preferencesService';
import { useShellStore } from '@/state/shellStore';

import { getDefaultHiddenSidePanelPath } from './sidePanelRoutes';

const sidePanelRouteOpenStateStorageKey =
    'vrcx-main-layout-right-sidebar-route-open-state';
const sidePanelRouteOpenStateEvent =
    'vrcx-main-layout-right-sidebar-route-open-state-change';

function readSidePanelRouteOpenState() {
    if (typeof window === 'undefined') {
        return {};
    }
    try {
        const value = JSON.parse(
            window.localStorage.getItem(sidePanelRouteOpenStateStorageKey) ||
                '{}'
        );
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return {};
        }
        return value;
    } catch {
        return {};
    }
}

function writeSidePanelRouteOpenState(routeKey: any, open: any) {
    if (typeof window === 'undefined') {
        return;
    }

    const nextState: any = {
        ...readSidePanelRouteOpenState(),
        [routeKey]: Boolean(open)
    };

    try {
        window.localStorage.setItem(
            sidePanelRouteOpenStateStorageKey,
            JSON.stringify(nextState)
        );
    } catch {
        // no-op
    }

    window.dispatchEvent(
        new CustomEvent(sidePanelRouteOpenStateEvent, {
            detail: { routeKey, open: Boolean(open) }
        })
    );
}

export function useRightSidePanelVisibility(pathname: any) {
    const routeKey = getDefaultHiddenSidePanelPath(pathname);
    const rightSidebarOpen = useShellStore((state) => state.rightSidebarOpen);
    const [routeOpenState, setRouteOpenState] = useState(
        readSidePanelRouteOpenState
    );
    const sidePanelOpen = routeKey
        ? routeOpenState[routeKey] === true
        : rightSidebarOpen;

    useEffect(() => {
        if (typeof window === 'undefined') {
            return undefined;
        }

        const handleRouteStateChange = (event: any) => {
            const detail = event.detail;
            if (detail?.routeKey) {
                setRouteOpenState((currentState: any) => ({
                    ...currentState,
                    [detail.routeKey]: detail.open === true
                }));
                return;
            }
            setRouteOpenState(readSidePanelRouteOpenState());
        };
        const handleStorage = (event: any) => {
            if (
                event.key === sidePanelRouteOpenStateStorageKey ||
                event.key === null
            ) {
                setRouteOpenState(readSidePanelRouteOpenState());
            }
        };

        window.addEventListener(
            sidePanelRouteOpenStateEvent,
            handleRouteStateChange
        );
        window.addEventListener('storage', handleStorage);
        return () => {
            window.removeEventListener(
                sidePanelRouteOpenStateEvent,
                handleRouteStateChange
            );
            window.removeEventListener('storage', handleStorage);
        };
    }, []);

    const setSidePanelOpen = useCallback(
        (open: any) => {
            if (routeKey) {
                writeSidePanelRouteOpenState(routeKey, open);
                return;
            }
            void setRightSidebarOpenPreference(open);
        },
        [routeKey]
    );

    const toggleSidePanelOpen = useCallback(() => {
        setSidePanelOpen(!sidePanelOpen);
    }, [setSidePanelOpen, sidePanelOpen]);

    return {
        routeKey,
        sidePanelOpen,
        setSidePanelOpen,
        toggleSidePanelOpen
    };
}
