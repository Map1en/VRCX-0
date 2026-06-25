import { useEffect, useRef } from 'react';

import {
    setNavWidthPreference,
    setSidebarCollapsedPreference
} from '@/services/preferencesService';
import { normalizeNavWidth, useShellStore } from '@/state/shellStore';
import { Sidebar, SidebarInset, SidebarProvider } from '@/ui/shadcn/sidebar';

import { AppNavMenu } from './AppNavMenu';

export function AppSidebar({ children }: any) {
    const sidebarOpen = useShellStore((state: any) => state.sidebarOpen);
    const navWidth = useShellStore((state: any) => state.navWidth);
    const resizeCleanupRef = useRef<(() => void) | null>(null);

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

    function startNavResize(event: any) {
        if (!sidebarOpen) {
            return;
        }

        event.preventDefault();
        const target = event.currentTarget;
        const wrapperElement = target.parentElement;
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
        let latestWidth = normalizeNavWidth(event.clientX);

        const transitionTargets = wrapperElement
            ? Array.from(
                  wrapperElement.querySelectorAll(
                      '[data-slot="sidebar-gap"],[data-slot="sidebar-container"]'
                  )
              )
            : [];
        const previousTransitions = transitionTargets.map(
            (element: any) => element.style.transition
        );
        transitionTargets.forEach((element: any) => {
            element.style.transition = 'none';
        });

        const applyWidth = (clientX: any) => {
            latestWidth = normalizeNavWidth(clientX);
            wrapperElement?.style.setProperty(
                '--sidebar-width',
                `${latestWidth}px`
            );
        };

        const handleMove = (moveEvent: any) => {
            applyWidth(moveEvent.clientX);
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
            transitionTargets.forEach((element: any, index: number) => {
                element.style.transition = previousTransitions[index];
            });
            try {
                target.releasePointerCapture?.(pointerId);
            } catch {
                // Releasing capture is best-effort after pointer cancellation.
            }
            resizeCleanupRef.current = null;
            setNavWidthPreference(latestWidth);
        };

        resizeCleanupRef.current?.();
        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', cleanup);
        window.addEventListener('pointercancel', cleanup);
        window.addEventListener('blur', cleanup);
        resizeCleanupRef.current = cleanup;
        applyWidth(event.clientX);
    }

    return (
        <SidebarProvider
            open={sidebarOpen}
            data-vrcx-0-surface="sidebar-layout"
            className="vrcx-0-sidebar-layout relative h-full min-h-0 w-full overflow-hidden"
            style={{ '--sidebar-width': `${navWidth}px` }}
            onOpenChange={(open: any) => {
                setSidebarCollapsedPreference(!open);
            }}
        >
            <Sidebar
                side="left"
                variant="sidebar"
                collapsible="icon"
                data-vrcx-0-surface="sidebar"
                style={{ top: '2rem', bottom: 0, height: 'auto' }}
            >
                <AppNavMenu isCollapsed={!sidebarOpen} />
            </Sidebar>
            {sidebarOpen ? (
                <div
                    className="absolute top-0 bottom-0 z-30 w-1 cursor-ew-resize select-none"
                    style={{ left: 'var(--sidebar-width)' }}
                    onPointerDown={startNavResize}
                />
            ) : null}
            <SidebarInset
                data-vrcx-0-surface="sidebar-inset"
                className="min-w-0 overflow-hidden"
            >
                {children}
            </SidebarInset>
        </SidebarProvider>
    );
}
