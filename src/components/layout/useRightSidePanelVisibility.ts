import { useCallback, useEffect, useState } from 'react';

import {
    STORAGE_KEYS,
    readStoredJson,
    writeStoredText
} from '@/lib/browserStorage';
import { setRightSidebarOpenPreference } from '@/services/preferencesService';
import { isRecord } from '@/shared/utils/record';
import { useShellStore } from '@/state/shellStore';

import { getDefaultHiddenSidePanelPath } from './sidePanelRoutes';

const sidePanelRouteOpenStateStorageKey =
    STORAGE_KEYS.rightSidebarRouteOpenState;
const sidePanelRouteOpenStateEvent =
    'vrcx-main-layout-right-sidebar-route-open-state-change';

type SidePanelRouteOpenState = Record<string, boolean>;

function readSidePanelRouteOpenState(): SidePanelRouteOpenState {
    const value = readStoredJson(sidePanelRouteOpenStateStorageKey);
    if (!isRecord(value)) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(value).filter(
            (entry): entry is [string, boolean] => typeof entry[1] === 'boolean'
        )
    );
}

function writeSidePanelRouteOpenState(routeKey: string, open: boolean) {
    const nextState: SidePanelRouteOpenState = {
        ...readSidePanelRouteOpenState(),
        [routeKey]: Boolean(open)
    };

    writeStoredText(
        sidePanelRouteOpenStateStorageKey,
        JSON.stringify(nextState)
    );

    window.dispatchEvent(
        new CustomEvent(sidePanelRouteOpenStateEvent, {
            detail: { routeKey, open: Boolean(open) }
        })
    );
}

export function useRightSidePanelVisibility(pathname: string) {
    const routeKey = getDefaultHiddenSidePanelPath(pathname);
    const rightSidebarOpen = useShellStore((state) => state.rightSidebarOpen);
    const [routeOpenState, setRouteOpenState] = useState(
        readSidePanelRouteOpenState
    );
    const sidePanelOpen = routeKey
        ? routeOpenState[routeKey] === true
        : rightSidebarOpen;

    useEffect(() => {
        const handleRouteStateChange = (event: Event) => {
            const detail =
                event instanceof CustomEvent && isRecord(event.detail)
                    ? event.detail
                    : null;
            if (detail && typeof detail.routeKey === 'string') {
                const routeKey = detail.routeKey;
                setRouteOpenState((currentState) => ({
                    ...currentState,
                    [routeKey]: detail.open === true
                }));
                return;
            }
            setRouteOpenState(readSidePanelRouteOpenState());
        };
        const handleStorage = (event: StorageEvent) => {
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
        (open: boolean) => {
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
