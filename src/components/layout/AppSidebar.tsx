import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
    setNavWidthPreference,
    setNavbarCollapsedPreference
} from '@/services/preferencesService';
import { usePreferencesStore } from '@/state/preferencesStore';
import { normalizeNavWidth, useShellStore } from '@/state/shellStore';
import { Sidebar, SidebarInset, SidebarProvider } from '@/ui/shadcn/sidebar';

import { AppNavMenu } from './AppNavMenu';
import {
    scheduleKeyboardSidebarToggleCleanup,
    useDelayedNavMenuCollapsed,
    useSidebarInstantTransition
} from './navMenuCollapse';

export function AppSidebar({
    children,
    sidebarWindowMode = false
}: {
    children: ReactNode;
    sidebarWindowMode?: boolean;
}) {
    const sidebarOpen = useShellStore((state) => state.sidebarOpen);
    const navWidth = useShellStore((state) => state.navWidth);
    const reducedMotionAndBlur = usePreferencesStore(
        (state) => state.reducedMotionAndBlur
    );
    const resizeCleanupRef = useRef<(() => void) | null>(null);
    const keyboardSidebarToggleCleanupRef = useRef<(() => void) | null>(null);
    const [
        keyboardSidebarToggleTargetOpen,
        setKeyboardSidebarToggleTargetOpen
    ] = useState<boolean | null>(null);
    const keyboardSidebarToggleActive =
        keyboardSidebarToggleTargetOpen !== null;
    const instantSidebarTransition = useSidebarInstantTransition(
        keyboardSidebarToggleActive,
        reducedMotionAndBlur
    );
    const navMenuCollapsed = useDelayedNavMenuCollapsed(
        sidebarOpen,
        instantSidebarTransition
    );

    useEffect(() => {
        return () => {
            resizeCleanupRef.current?.();
            keyboardSidebarToggleCleanupRef.current?.();
        };
    }, []);

    useEffect(() => {
        if (!sidebarOpen) {
            resizeCleanupRef.current?.();
        }
    }, [sidebarOpen]);

    useEffect(() => {
        if (keyboardSidebarToggleTargetOpen === null) {
            keyboardSidebarToggleCleanupRef.current?.();
            keyboardSidebarToggleCleanupRef.current = null;
            return;
        }
        if (keyboardSidebarToggleTargetOpen !== sidebarOpen) {
            return;
        }

        const targetOpen = keyboardSidebarToggleTargetOpen;
        keyboardSidebarToggleCleanupRef.current?.();
        keyboardSidebarToggleCleanupRef.current =
            scheduleKeyboardSidebarToggleCleanup(() => {
                keyboardSidebarToggleCleanupRef.current = null;
                setKeyboardSidebarToggleTargetOpen((currentTargetOpen) =>
                    currentTargetOpen === targetOpen ? null : currentTargetOpen
                );
            });
    }, [keyboardSidebarToggleTargetOpen, sidebarOpen]);

    function toggleSidebarFromKeyboard() {
        setKeyboardSidebarToggleTargetOpen(!sidebarOpen);
        void setNavbarCollapsedPreference(sidebarOpen);
    }

    function startNavResize(event: React.PointerEvent<HTMLDivElement>) {
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
                  wrapperElement.querySelectorAll<HTMLElement>(
                      '[data-slot="sidebar-gap"],[data-slot="sidebar-container"]'
                  )
              )
            : [];
        const previousTransitions = transitionTargets.map(
            (element) => element.style.transition
        );
        transitionTargets.forEach((element) => {
            element.style.transition = 'none';
        });

        const applyWidth = (clientX: number) => {
            latestWidth = normalizeNavWidth(clientX);
            wrapperElement?.style.setProperty(
                '--sidebar-width',
                `${latestWidth}px`
            );
        };

        const handleMove = (moveEvent: PointerEvent) => {
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
            transitionTargets.forEach((element, index) => {
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
            open={sidebarWindowMode ? false : sidebarOpen}
            data-vrcx-0-surface="sidebar-layout"
            className="vrcx-0-sidebar-layout relative h-full min-h-0 w-full overflow-hidden"
            style={{ '--sidebar-width': `${navWidth}px` }}
            instantSidebarTransition={instantSidebarTransition}
            onKeyboardShortcutToggle={
                sidebarWindowMode ? undefined : toggleSidebarFromKeyboard
            }
            onOpenChange={(open) => {
                if (sidebarWindowMode) {
                    return;
                }
                setKeyboardSidebarToggleTargetOpen(null);
                void setNavbarCollapsedPreference(!open);
            }}
        >
            {sidebarWindowMode ? null : (
                <Sidebar
                    side="left"
                    variant="sidebar"
                    collapsible="icon"
                    data-vrcx-0-surface="sidebar"
                    className="absolute h-auto"
                >
                    <AppNavMenu isCollapsed={navMenuCollapsed} />
                </Sidebar>
            )}
            {!sidebarWindowMode && sidebarOpen ? (
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
