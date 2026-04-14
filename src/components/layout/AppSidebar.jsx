import { useEffect, useRef } from 'react';

import {
    Sidebar,
    SidebarInset,
    SidebarProvider
} from '@/ui/shadcn/sidebar.jsx';
import { setNavWidthPreference, setSidebarCollapsedPreference } from '@/services/preferencesService.js';
import { useShellStore } from '@/state/shellStore.js';

import { AppNavMenu } from './AppNavMenu.jsx';

export function AppSidebar({ children }) {
    const sidebarOpen = useShellStore((state) => state.sidebarOpen);
    const navWidth = useShellStore((state) => state.navWidth);
    const resizeCleanupRef = useRef(null);

    useEffect(() => {
        return () => {
            resizeCleanupRef.current?.();
        };
    }, []);

    useEffect(() => {
        if (!sidebarOpen) {
            resizeCleanupRef.current?.();
        }
    }, [sidebarOpen]);

    function startNavResize(event) {
        if (!sidebarOpen) {
            return;
        }

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
            useShellStore.getState().setNavWidth(moveEvent.clientX);
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
            void setNavWidthPreference(useShellStore.getState().navWidth);
        };

        resizeCleanupRef.current?.();
        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', cleanup);
        window.addEventListener('pointercancel', cleanup);
        window.addEventListener('blur', cleanup);
        resizeCleanupRef.current = cleanup;
        useShellStore.getState().setNavWidth(event.clientX);
    }

    return (
        <SidebarProvider
            open={sidebarOpen}
            className="relative h-screen min-h-0 w-full overflow-hidden"
            style={{ '--sidebar-width': `${navWidth}px` }}
            onOpenChange={(open) => {
                void setSidebarCollapsedPreference(!open);
            }}>
            <Sidebar side="left" variant="sidebar" collapsible="icon">
                <AppNavMenu isCollapsed={!sidebarOpen} />
            </Sidebar>
            {sidebarOpen ? (
                <div
                    className="absolute top-0 bottom-0 z-30 w-1 cursor-ew-resize select-none"
                    style={{ left: 'var(--sidebar-width)' }}
                    onPointerDown={startNavResize}
                />
            ) : null}
            <SidebarInset className="min-w-0 overflow-hidden bg-background">{children}</SidebarInset>
        </SidebarProvider>
    );
}
