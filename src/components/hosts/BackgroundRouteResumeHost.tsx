import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import storageRepository from '@/repositories/storageRepository';
import {
    BACKGROUND_MODE_RESUME_ROUTE_STORAGE_KEY,
    normalizeBackgroundResumeRoute
} from '@/services/backgroundRouteResumeService';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

function currentRoute(location: any): string {
    return `${location.pathname}${location.search}${location.hash}`;
}

function consumeBackgroundRouteResumeMarker(): boolean {
    const shouldResume =
        window.__VRCX_BACKGROUND_ROUTE_RESUME_PENDING__ === true;
    window.__VRCX_BACKGROUND_ROUTE_RESUME_PENDING__ = false;
    return shouldResume;
}

export function BackgroundRouteResumeHost(): null {
    const navigate = useNavigate();
    const location = useLocation();
    const consumedRef = useRef(false);
    const sessionReady = useSessionStore(
        (state: any) => state.sessionPhase === 'ready'
    );
    const canResume = useRuntimeStore(
        (state: any) =>
            state.shell.backendRuntimeSnapshotHydrated &&
            !state.shell.backendRuntimeSessionHydrating
    );

    useEffect(() => {
        if (!canResume || !sessionReady || consumedRef.current) {
            return;
        }
        consumedRef.current = true;
        if (!consumeBackgroundRouteResumeMarker()) {
            return;
        }
        let cancelled = false;
        storageRepository
            .getString(BACKGROUND_MODE_RESUME_ROUTE_STORAGE_KEY, '')
            .then((storedRoute: any) => {
                if (cancelled) {
                    return;
                }
                const route = normalizeBackgroundResumeRoute(storedRoute);
                if (!route) {
                    if (storedRoute) {
                        storageRepository
                            .remove(BACKGROUND_MODE_RESUME_ROUTE_STORAGE_KEY)
                            .catch(() => {});
                    }
                    return;
                }
                storageRepository
                    .remove(BACKGROUND_MODE_RESUME_ROUTE_STORAGE_KEY)
                    .catch(() => {});
                if (currentRoute(location) !== route) {
                    navigate(route, { replace: true });
                }
            })
            .catch(() => {});

        return () => {
            cancelled = true;
        };
    }, [canResume, location, navigate, sessionReady]);

    return null;
}
