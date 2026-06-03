import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { GlobalHosts } from '@/components/hosts/GlobalHosts';
import { AppTitleBar } from '@/components/layout/AppTitleBar';
import { MacNativeMenuActionHost } from '@/components/layout/MacNativeMenuActionHost';
import { MacOverlayTitleBar } from '@/components/layout/MacOverlayTitleBar';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    protectedRoutes,
    publicRoutes,
    RouteLoadingFallback
} from './routes';

const AppShellLayout = lazy(() =>
    import('@/components/layout/AppShellLayout').then((module: any) => ({
        default: module.AppShellLayout
    }))
);

function RequireAuth() {
    const sessionPhase = useSessionStore((state: any) => state.sessionPhase);
    const isSessionReady = sessionPhase === 'ready';
    const isSessionPending =
        sessionPhase === 'authenticating' || sessionPhase === 'bootstrapping';
    const backendRuntimeReady = useRuntimeStore(
        (state: any) =>
            state.shell.backendRuntimeSnapshotHydrated &&
            !state.shell.backendRuntimeSessionHydrating
    );

    if (!backendRuntimeReady || isSessionPending) {
        return <RouteLoadingFallback />;
    }
    if (!isSessionReady) {
        return <Navigate to="/login" replace />;
    }

    return <Outlet />;
}

function RedirectIfAuthenticated() {
    const sessionPhase = useSessionStore((state: any) => state.sessionPhase);
    const isSessionReady = sessionPhase === 'ready';
    const isSessionPending =
        sessionPhase === 'authenticating' || sessionPhase === 'bootstrapping';
    const backendRuntimeReady = useRuntimeStore(
        (state: any) =>
            state.shell.backendRuntimeSnapshotHydrated &&
            !state.shell.backendRuntimeSessionHydrating
    );

    if (!backendRuntimeReady || isSessionPending) {
        return <RouteLoadingFallback />;
    }
    if (isSessionReady) {
        return <Navigate to="/feed" replace />;
    }

    return <Outlet />;
}

function AppShellRoute() {
    return (
        <Suspense fallback={<RouteLoadingFallback />}>
            <AppShellLayout />
        </Suspense>
    );
}

function AppRouterContent() {
    const isMacHost = useRuntimeStore(
        (state: any) => state.hostCapabilities.platform === 'macos'
    );

    return (
        <div
            data-vrcx-0-surface="app-root"
            className="vrcx-0-app-root flex h-screen min-h-0 w-full flex-col overflow-hidden"
        >
            {isMacHost ? <MacOverlayTitleBar /> : <AppTitleBar />}
            <div
                data-vrcx-0-surface="route-host"
                className="vrcx-0-route-host min-h-0 flex-1 overflow-hidden"
            >
                <Routes>
                    <Route element={<RedirectIfAuthenticated />}>
                        {publicRoutes.map((route: any) => (
                            <Route
                                key={route.path}
                                path={route.path}
                                element={route.element}
                            />
                        ))}
                    </Route>

                    <Route element={<RequireAuth />}>
                        <Route element={<AppShellRoute />}>
                            <Route
                                index
                                element={<Navigate to="/feed" replace />}
                            />
                            {protectedRoutes.map((route: any) => (
                                <Route
                                    key={route.path}
                                    path={route.path}
                                    element={route.element}
                                />
                            ))}
                            <Route
                                path="*"
                                element={<Navigate to="/feed" replace />}
                            />
                        </Route>
                    </Route>
                </Routes>
            </div>
            <GlobalHosts />
            <MacNativeMenuActionHost />
        </div>
    );
}

export function AppRouter() {
    return (
        <HashRouter>
            <AppRouterContent />
        </HashRouter>
    );
}
