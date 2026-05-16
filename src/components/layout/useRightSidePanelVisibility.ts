// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';

import { useShellStore } from '@/state/shellStore.js';

import { getDefaultHiddenSidePanelPath } from './sidePanelRoutes.js';

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

function writeSidePanelRouteOpenState(routeKey, open) {
    if (typeof window === 'undefined') {
        return;
    }

    const nextState = {
        ...readSidePanelRouteOpenState(),
        [routeKey]: Boolean(open)
    };

    try {
        window.localStorage.setItem(
            sidePanelRouteOpenStateStorageKey,
            JSON.stringify(nextState)
        );
    } catch {
        // Persisted layout state is optional.
    }

    window.dispatchEvent(
        new CustomEvent(sidePanelRouteOpenStateEvent, {
            detail: { routeKey, open: Boolean(open) }
        })
    );
}

export function useRightSidePanelVisibility(pathname) {
    const routeKey = getDefaultHiddenSidePanelPath(pathname);
    const rightSidebarOpen = useShellStore((state) => state.rightSidebarOpen);
    const setRightSidebarOpen = useShellStore(
        (state) => state.setRightSidebarOpen
    );
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

        const handleRouteStateChange = (event) => {
            const detail = event.detail;
            if (detail?.routeKey) {
                setRouteOpenState((currentState) => ({
                    ...currentState,
                    [detail.routeKey]: detail.open === true
                }));
                return;
            }
            setRouteOpenState(readSidePanelRouteOpenState());
        };
        const handleStorage = (event) => {
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
        (open) => {
            if (routeKey) {
                writeSidePanelRouteOpenState(routeKey, open);
                return;
            }
            setRightSidebarOpen(open);
        },
        [routeKey, setRightSidebarOpen]
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
