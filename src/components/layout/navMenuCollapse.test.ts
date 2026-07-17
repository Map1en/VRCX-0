import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    NAV_MENU_COLLAPSE_DELAY_MS,
    PREFERS_REDUCED_MOTION_MEDIA_QUERY,
    resolveDelayedNavMenuCollapsed,
    scheduleKeyboardSidebarToggleCleanup,
    subscribeToReducedMotionChanges,
    type ReducedMotionMediaQuery,
    useSidebarInstantTransition
} from './navMenuCollapse';

function SidebarInstantTransitionProbe({
    keyboardToggleActive,
    reducedMotionAndBlur
}: {
    keyboardToggleActive: boolean;
    reducedMotionAndBlur: boolean;
}) {
    const instantSidebarTransition = useSidebarInstantTransition(
        keyboardToggleActive,
        reducedMotionAndBlur
    );
    return createElement('span', null, instantSidebarTransition ? 'yes' : 'no');
}

function renderSidebarInstantTransition({
    keyboardToggleActive,
    prefersReducedMotion,
    reducedMotionAndBlur
}: {
    keyboardToggleActive: boolean;
    prefersReducedMotion: boolean;
    reducedMotionAndBlur: boolean;
}): string {
    const mediaQuery: ReducedMotionMediaQuery = {
        matches: prefersReducedMotion,
        addEventListener() {},
        removeEventListener() {}
    };
    vi.stubGlobal('window', {
        matchMedia: () => mediaQuery
    });
    return renderToStaticMarkup(
        createElement(SidebarInstantTransitionProbe, {
            keyboardToggleActive,
            reducedMotionAndBlur
        })
    );
}

describe('navMenuCollapse', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps expanded menu content during the sidebar collapse transition', () => {
        expect(resolveDelayedNavMenuCollapsed(false, false, 0)).toBe(false);
        expect(
            resolveDelayedNavMenuCollapsed(
                false,
                false,
                NAV_MENU_COLLAPSE_DELAY_MS - 1
            )
        ).toBe(false);
    });

    it('switches to collapsed menu content after the collapse transition', () => {
        expect(
            resolveDelayedNavMenuCollapsed(
                false,
                false,
                NAV_MENU_COLLAPSE_DELAY_MS
            )
        ).toBe(true);
    });

    it('keeps collapsed menu content during the sidebar expand transition', () => {
        expect(resolveDelayedNavMenuCollapsed(true, true, 0)).toBe(true);
        expect(
            resolveDelayedNavMenuCollapsed(
                true,
                true,
                NAV_MENU_COLLAPSE_DELAY_MS - 1
            )
        ).toBe(true);
    });

    it('switches to expanded menu content after the expand transition', () => {
        expect(
            resolveDelayedNavMenuCollapsed(
                true,
                true,
                NAV_MENU_COLLAPSE_DELAY_MS
            )
        ).toBe(false);
    });

    it('switches immediately for a keyboard collapse', () => {
        expect(resolveDelayedNavMenuCollapsed(false, false, 0, true)).toBe(
            true
        );
    });

    it('switches immediately for a keyboard expand', () => {
        expect(resolveDelayedNavMenuCollapsed(true, true, 0, true)).toBe(false);
    });

    it('uses each source in the production instant-transition hook', () => {
        expect(
            renderSidebarInstantTransition({
                keyboardToggleActive: true,
                prefersReducedMotion: false,
                reducedMotionAndBlur: false
            })
        ).toContain('yes');
        expect(
            renderSidebarInstantTransition({
                keyboardToggleActive: false,
                prefersReducedMotion: false,
                reducedMotionAndBlur: true
            })
        ).toContain('yes');
        expect(
            renderSidebarInstantTransition({
                keyboardToggleActive: false,
                prefersReducedMotion: true,
                reducedMotionAndBlur: false
            })
        ).toContain('yes');
        expect(
            renderSidebarInstantTransition({
                keyboardToggleActive: false,
                prefersReducedMotion: false,
                reducedMotionAndBlur: false
            })
        ).toContain('no');
    });

    it('responds to operating-system reduced-motion changes', () => {
        const listeners = new Set<(event: { matches: boolean }) => void>();
        const mediaQuery: ReducedMotionMediaQuery = {
            matches: false,
            addEventListener(_type, listener) {
                listeners.add(listener);
            },
            removeEventListener(_type, listener) {
                listeners.delete(listener);
            }
        };
        const changes: boolean[] = [];
        const unsubscribe = subscribeToReducedMotionChanges(
            mediaQuery,
            (matches) => changes.push(matches)
        );

        listeners.forEach((listener) => listener({ matches: true }));
        unsubscribe();
        listeners.forEach((listener) => listener({ matches: false }));

        expect(PREFERS_REDUCED_MOTION_MEDIA_QUERY).toBe(
            '(prefers-reduced-motion: reduce)'
        );
        expect(changes).toEqual([true]);
    });

    it('cleans up the scheduled keyboard transition reset', () => {
        let frameCallback: FrameRequestCallback | null = null;
        let cancelledFrameId: number | null = null;
        const scheduler = {
            requestAnimationFrame(callback: FrameRequestCallback) {
                frameCallback = callback;
                return 7;
            },
            cancelAnimationFrame(frameId: number) {
                cancelledFrameId = frameId;
            }
        };
        const cleanup = scheduleKeyboardSidebarToggleCleanup(
            () => {},
            scheduler
        );

        expect(frameCallback).not.toBeNull();
        cleanup();
        expect(cancelledFrameId).toBe(7);
    });

    it('defers the keyboard transition reset until the next animation frame', () => {
        const frameCallbacks: FrameRequestCallback[] = [];
        let reset = false;
        const scheduler = {
            requestAnimationFrame(callback: FrameRequestCallback) {
                frameCallbacks.push(callback);
                return 8;
            },
            cancelAnimationFrame() {}
        };

        scheduleKeyboardSidebarToggleCleanup(() => {
            reset = true;
        }, scheduler);

        expect(reset).toBe(false);
        frameCallbacks[0]?.(0);
        expect(reset).toBe(true);
    });
});
