import { HashRouter, Navigate, Outlet, Route, Routes, matchPath, useLocation } from 'react-router-dom';

import { GlobalHosts } from '@/components/hosts/GlobalHosts.jsx';
import { AppShellLayout } from '@/components/layout/AppShellLayout.jsx';
import { AppTitleBar } from '@/components/layout/AppTitleBar.jsx';
import { useSessionStore } from '@/state/sessionStore.js';

import { protectedRoutes, publicRoutes } from './routes.jsx';

function sanitizeRedirectTarget(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('/login')) {
        return '/feed';
    }

    return value;
}

function RequireAuth() {
    const isSessionReady = useSessionStore((state) => state.sessionPhase === 'ready');
    const location = useLocation();

    if (!isSessionReady) {
        const redirectTo = `${location.pathname}${location.search}${location.hash}`;
        return (
            <Navigate
                to={`/login?redirect=${encodeURIComponent(redirectTo)}`}
                replace
                state={{ redirectTo }}
            />
        );
    }

    return <Outlet />;
}

function RedirectIfAuthenticated() {
    const isSessionReady = useSessionStore((state) => state.sessionPhase === 'ready');
    const location = useLocation();

    if (isSessionReady) {
        const redirectQuery = new URLSearchParams(location.search).get('redirect');
        const redirectTo = sanitizeRedirectTarget(
            location.state?.redirectTo ?? redirectQuery ?? '/feed'
        );
        return <Navigate to={redirectTo} replace />;
    }

    return <Outlet />;
}

function getWindowTitle(pathname) {
    if (pathname === '/login') {
        return 'Login';
    }

    const matchedRoute = protectedRoutes.find((route) =>
        matchPath({ path: route.path, end: true }, pathname)
    );
    return matchedRoute?.title || 'VRCX';
}

function AppRouterContent() {
    const location = useLocation();

    return (
        <div className="flex h-screen min-h-0 w-full flex-col overflow-hidden bg-background">
            <AppTitleBar title={getWindowTitle(location.pathname)} />
            <div className="min-h-0 flex-1 overflow-hidden">
                <Routes>
                    <Route element={<RedirectIfAuthenticated />}>
                        {publicRoutes.map((route) => (
                            <Route key={route.path} path={route.path} element={route.element} />
                        ))}
                    </Route>

                    <Route element={<RequireAuth />}>
                        <Route element={<AppShellLayout />}>
                            <Route index element={<Navigate to="/feed" replace />} />
                            {protectedRoutes.map((route) => (
                                <Route key={route.path} path={route.path} element={route.element} />
                            ))}
                            <Route path="*" element={<Navigate to="/feed" replace />} />
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
