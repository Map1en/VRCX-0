// @ts-nocheck
import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { GlobalHosts } from '@/components/hosts/GlobalHosts';
import { AppTitleBar } from '@/components/layout/AppTitleBar';
import { useSessionStore } from '@/state/sessionStore.js';

import {
    protectedRoutes,
    publicRoutes,
    RouteLoadingFallback
} from './routes';

const AppShellLayout = lazy(() =>
    import('@/components/layout/AppShellLayout').then((module) => ({
        default: module.AppShellLayout
    }))
);

function RequireAuth() {
    const isSessionReady = useSessionStore(
        (state) => state.sessionPhase === 'ready'
    );

    if (!isSessionReady) {
        return <Navigate to="/login" replace />;
    }

    return <Outlet />;
}

function RedirectIfAuthenticated() {
    const isSessionReady = useSessionStore(
        (state) => state.sessionPhase === 'ready'
    );

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
    return (
        <div className="bg-background flex h-screen min-h-0 w-full flex-col overflow-hidden">
            <AppTitleBar />
            <div className="min-h-0 flex-1 overflow-hidden">
                <Routes>
                    <Route element={<RedirectIfAuthenticated />}>
                        {publicRoutes.map((route) => (
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
                            {protectedRoutes.map((route) => (
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
