import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { SidePanel } from '@/components/sidebar/SidePanel';

import { AppSidebar } from './AppSidebar';
import { AppStatusBar } from './AppStatusBar';
import { useRightSidePanelVisibility } from './useRightSidePanelVisibility';

const sidePanelStorageKey = 'vrcx-main-layout-right-sidebar-width';

function clampSidePanelWidth(value: any) {
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
    try {
        return clampSidePanelWidth(
            window.localStorage.getItem(sidePanelStorageKey)
        );
    } catch {
        return 320;
    }
}

export function AppShellLayout() {
    const location = useLocation();
    const { sidePanelOpen } = useRightSidePanelVisibility(location.pathname);
    const [sidePanelWidth, setSidePanelWidth] = useState(loadSidePanelWidth);
    const sidePanelWidthRef = useRef(sidePanelWidth);
    const sidePanelElementRef = useRef<HTMLDivElement | null>(null);
    const resizeCleanupRef = useRef<((commit?: boolean) => void) | null>(null);
    const sidePanelVisible = sidePanelOpen;

    useEffect(() => {
        sidePanelWidthRef.current = sidePanelWidth;
    }, [sidePanelWidth]);

    useEffect(() => {
        try {
            window.localStorage.setItem(
                sidePanelStorageKey,
                String(sidePanelWidth)
            );
        } catch {
            // no-op
        }
    }, [sidePanelWidth]);

    useEffect(() => {
        return () => {
            resizeCleanupRef.current?.(false);
        };
    }, []);

    useEffect(() => {
        if (!sidePanelVisible) {
            resizeCleanupRef.current?.(false);
        }
    }, [sidePanelVisible]);

    function applySidePanelWidth(width: any) {
        const nextWidth = clampSidePanelWidth(width);
        sidePanelWidthRef.current = nextWidth;
        if (sidePanelElementRef.current) {
            sidePanelElementRef.current.style.width = `${nextWidth}px`;
        }
        return nextWidth;
    }

    function startSidePanelResize(event: any) {
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

        const handleMove = (moveEvent: any) => {
            applySidePanelWidth(window.innerWidth - moveEvent.clientX);
        };

        const cleanup = (commit: any = true) => {
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
            if (commit) {
                const nextWidth = sidePanelWidthRef.current;
                setSidePanelWidth((currentWidth: any) =>
                    currentWidth === nextWidth ? currentWidth : nextWidth
                );
            }
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
            <div
                data-vrcx-0-surface="main-shell"
                className="vrcx-0-main-shell flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
            >
                <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                    <div
                        data-vrcx-0-surface="main-content"
                        className="vrcx-0-main-content flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                    >
                        <Outlet />
                    </div>
                    {sidePanelVisible ? (
                        <>
                            <div
                                className="hover:bg-border z-20 w-1 shrink-0 cursor-ew-resize bg-transparent select-none"
                                onPointerDown={startSidePanelResize}
                            />
                            <SidePanel
                                ref={sidePanelElementRef}
                                className="w-full shrink-0"
                                style={{ width: sidePanelWidth }}
                            />
                        </>
                    ) : null}
                </div>
                <AppStatusBar />
            </div>
        </AppSidebar>
    );
}
