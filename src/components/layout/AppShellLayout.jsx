import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { SidePanel } from '@/components/sidebar/SidePanel.jsx';

import { AppSidebar } from './AppSidebar.jsx';
import { AppStatusBar } from './AppStatusBar.jsx';

const sidePanelStorageKey = 'vrcx-main-layout-right-sidebar-width';
const sidePanelHiddenPaths = ['/friends-locations', '/social/friend-list', '/charts/instance', '/charts/mutual'];

function clampSidePanelWidth(value) {
    const width = Number.parseInt(value, 10);
    if (!Number.isFinite(width)) {
        return 320;
    }
    return Math.min(700, Math.max(240, width));
}

function loadSidePanelWidth() {
    if (typeof window === 'undefined') {
        return 320;
    }
    return clampSidePanelWidth(window.localStorage.getItem(sidePanelStorageKey));
}

function shouldShowSidePanel(pathname) {
    return !sidePanelHiddenPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function AppShellLayout() {
    const location = useLocation();
    const [sidePanelWidth, setSidePanelWidth] = useState(loadSidePanelWidth);
    const resizeCleanupRef = useRef(null);
    const showSidePanel = shouldShowSidePanel(location.pathname);

    useEffect(() => {
        window.localStorage.setItem(sidePanelStorageKey, String(sidePanelWidth));
    }, [sidePanelWidth]);

    useEffect(() => {
        return () => {
            resizeCleanupRef.current?.();
        };
    }, []);

    useEffect(() => {
        if (!showSidePanel) {
            resizeCleanupRef.current?.();
        }
    }, [showSidePanel]);

    function startSidePanelResize(event) {
        event.preventDefault();
        const target = event.currentTarget;
        const pointerId = event.pointerId;
        try {
            target.setPointerCapture?.(pointerId);
        } catch {
            // Pointer capture can fail if the target is detached during resize.
        }
        const previousUserSelect = document.body.style.userSelect;
        const previousCursor = document.body.style.cursor;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
        let cleanedUp = false;

        const handleMove = (moveEvent) => {
            setSidePanelWidth(clampSidePanelWidth(window.innerWidth - moveEvent.clientX));
        };

        const cleanup = () => {
            if (cleanedUp) {
                return;
            }
            cleanedUp = true;
            document.body.style.userSelect = previousUserSelect;
            document.body.style.cursor = previousCursor;
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', cleanup);
            window.removeEventListener('pointercancel', cleanup);
            window.removeEventListener('blur', cleanup);
            try {
                target.releasePointerCapture?.(pointerId);
            } catch {
                // Releasing capture is best-effort after pointer cancellation.
            }
            resizeCleanupRef.current = null;
        };

        resizeCleanupRef.current?.();
        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', cleanup);
        window.addEventListener('pointercancel', cleanup);
        window.addEventListener('blur', cleanup);
        resizeCleanupRef.current = cleanup;
        handleMove(event);
    }

    return (
        <AppSidebar>
            <div className="flex h-screen min-h-0 min-w-0 flex-col overflow-hidden bg-background">
                <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                        <Outlet />
                    </div>
                    {showSidePanel ? (
                        <>
                            <div
                                className="z-20 w-1 shrink-0 cursor-ew-resize select-none bg-transparent hover:bg-border"
                                onPointerDown={startSidePanelResize}
                            />
                            <SidePanel className="w-full shrink-0" style={{ width: sidePanelWidth }} />
                        </>
                    ) : null}
                </div>
                <AppStatusBar />
            </div>
        </AppSidebar>
    );
}
