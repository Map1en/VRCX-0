import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import { GlobalHosts } from '@/components/hosts/GlobalHosts.jsx';
import { AppShellLayout } from '@/components/layout/AppShellLayout.jsx';
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

export function AppRouter() {
    return (
        <HashRouter>
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
            <GlobalHosts />
        </HashRouter>
    );
}
