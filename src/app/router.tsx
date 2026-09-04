import { lazy, Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
    HashRouter,
    Navigate,
    Outlet,
    Route,
    Routes,
    useLocation
} from 'react-router';

import { GlobalHosts } from '@/app/GlobalHosts';
import { AppTitleBar } from '@/components/layout/AppTitleBar';
import { MacNativeMenuActionHost } from '@/components/layout/MacNativeMenuActionHost';
import { MacOverlayTitleBar } from '@/components/layout/MacOverlayTitleBar';
import { useGlobalKeyboardShortcuts } from '@/components/layout/useGlobalKeyboardShortcuts';
import { useSidebarAutoHide } from '@/components/layout/useSidebarAutoHide';
import { WindowResizeHandles } from '@/components/layout/WindowResizeHandles';
import { cn } from '@/lib/utils';
import { recordRouteEnter } from '@/services/telemetry/telemetryPageReach';
import {
    initializeWindowDisplayMode,
    leaveSidebarWindowModeForLogin,
    restoreSidebarWindowModeAfterLogin,
    subscribeSidebarModeToggle
} from '@/services/windowModeService';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { Button } from '@/ui/shadcn/button';

import { RouteErrorBoundary } from './RouteErrorBoundary';
import { protectedRoutes, publicRoutes, RouteLoadingFallback } from './routes';

function RouteErrorFallback() {
    const { t } = useTranslation();
    return (
        <div className="text-muted-foreground flex h-full min-h-0 flex-col items-center justify-center gap-3 text-sm">
            <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
            >
                {t('nativeShell.tray.rebuildUi')}
            </Button>
        </div>
    );
}

const AppShellLayout = lazy(() =>
    import('@/components/layout/AppShellLayout').then((module) => ({
        default: module.AppShellLayout
    }))
);

function RequireAuth() {
    const sessionPhase = useSessionStore((state) => state.sessionPhase);
    const isSessionReady = sessionPhase === 'ready';
    const isSessionPending =
        sessionPhase === 'authenticating' || sessionPhase === 'bootstrapping';
    const backendRuntimeReady = useRuntimeStore(
        (state) =>
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
    const sessionPhase = useSessionStore((state) => state.sessionPhase);
    const isSessionReady = sessionPhase === 'ready';
    const isSessionPending =
        sessionPhase === 'authenticating' || sessionPhase === 'bootstrapping';
    const backendRuntimeReady = useRuntimeStore(
        (state) =>
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
    const hostPlatform = useRuntimeStore(
        (state) => state.hostCapabilities.platform
    );
    const isMacHost = hostPlatform === 'macos';
    const { pathname } = useLocation();
    useGlobalKeyboardShortcuts();
    useSidebarAutoHide();
    useEffect(() => {
        let disposed = false;
        let unsubscribe: (() => void) | undefined;
        void subscribeSidebarModeToggle()
            .then((dispose) => {
                if (disposed) {
                    dispose();
                    return;
                }
                unsubscribe = dispose;
            })
            .catch((error: unknown) => {
                console.warn('Failed to watch the sidebar mode toggle:', error);
            });
        return () => {
            disposed = true;
            unsubscribe?.();
        };
    }, []);
    useEffect(() => {
        void initializeWindowDisplayMode().catch((error: unknown) => {
            console.warn(
                'Failed to initialize the window display mode:',
                error
            );
        });
    }, []);
    useEffect(() => {
        recordRouteEnter(pathname);
    }, [pathname]);
    useEffect(() => {
        if (pathname === '/login') {
            leaveSidebarWindowModeForLogin();
        } else {
            restoreSidebarWindowModeAfterLogin();
        }
    }, [pathname]);
    useEffect(() => {
        if (!isMacHost) {
            return undefined;
        }

        const handleContextMenu = (event: MouseEvent) => {
            event.preventDefault();
        };

        document.addEventListener('contextmenu', handleContextMenu);
        return () => {
            document.removeEventListener('contextmenu', handleContextMenu);
        };
    }, [isMacHost]);

    const isWindowsHost = hostPlatform === 'windows';
    const hasCustomWindowFrame =
        isWindowsHost && !window.__VRCX_SYSTEM_WINDOW_FRAME__;

    return (
        <>
            <div
                data-vrcx-0-surface="app-root"
                className={cn(
                    'vrcx-0-app-root flex min-h-0 w-full flex-col overflow-hidden',
                    hasCustomWindowFrame
                        ? 'vrcx-0-custom-window-frame h-full'
                        : 'h-screen'
                )}
            >
                <div
                    aria-hidden="true"
                    className="vrcx-0-background-image-transition-layer"
                />
                {isMacHost ? <MacOverlayTitleBar /> : <AppTitleBar />}
                <div
                    data-vrcx-0-surface="route-host"
                    className="vrcx-0-route-host min-h-0 flex-1 overflow-hidden"
                >
                    <RouteErrorBoundary
                        resetKey={pathname}
                        fallback={<RouteErrorFallback />}
                    >
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
                                        element={
                                            <Navigate to="/feed" replace />
                                        }
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
                                        element={
                                            <Navigate to="/feed" replace />
                                        }
                                    />
                                </Route>
                            </Route>
                        </Routes>
                    </RouteErrorBoundary>
                </div>
                <GlobalHosts />
                <MacNativeMenuActionHost />
            </div>
            {hasCustomWindowFrame ? <WindowResizeHandles /> : null}
        </>
    );
}

export function AppRouter() {
    return (
        <HashRouter>
            <AppRouterContent />
        </HashRouter>
    );
}
