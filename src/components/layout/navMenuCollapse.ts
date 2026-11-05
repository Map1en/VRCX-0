import { useEffect, useState } from 'react';

export const NAV_MENU_COLLAPSE_DELAY_MS = 200;
export const PREFERS_REDUCED_MOTION_MEDIA_QUERY =
    '(prefers-reduced-motion: reduce)';

export type AnimationFrameScheduler = Pick<
    Window,
    'cancelAnimationFrame' | 'requestAnimationFrame'
>;

export type ReducedMotionMediaQuery = {
    matches: boolean;
    addEventListener(
        type: 'change',
        listener: (event: { matches: boolean }) => void
    ): void;
    removeEventListener(
        type: 'change',
        listener: (event: { matches: boolean }) => void
    ): void;
};

export function subscribeToReducedMotionChanges(
    mediaQuery: ReducedMotionMediaQuery,
    onChange: (matches: boolean) => void
): () => void {
    const handleChange = (event: { matches: boolean }) => {
        onChange(event.matches);
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
}

function usePrefersReducedMotion(): boolean {
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
        typeof window !== 'undefined' && window.matchMedia
            ? window.matchMedia(PREFERS_REDUCED_MOTION_MEDIA_QUERY).matches
            : false
    );

    useEffect(() => {
        if (!window.matchMedia) {
            return;
        }

        const mediaQuery = window.matchMedia(
            PREFERS_REDUCED_MOTION_MEDIA_QUERY
        );
        setPrefersReducedMotion(mediaQuery.matches);
        return subscribeToReducedMotionChanges(
            mediaQuery,
            setPrefersReducedMotion
        );
    }, []);

    return prefersReducedMotion;
}

export function useSidebarInstantTransition(
    keyboardToggleActive: boolean,
    reducedMotionAndBlur: boolean
): boolean {
    const prefersReducedMotion = usePrefersReducedMotion();
    return keyboardToggleActive || reducedMotionAndBlur || prefersReducedMotion;
}

export function scheduleKeyboardSidebarToggleCleanup(
    onFrame: () => void,
    scheduler: AnimationFrameScheduler = window
): () => void {
    const frameId = scheduler.requestAnimationFrame(onFrame);
    return () => {
        scheduler.cancelAnimationFrame(frameId);
    };
}

export function useDelayedNavMenuCollapsed(
    sidebarOpen: boolean,
    immediate = false
): boolean {
    const [navMenuCollapsed, setNavMenuCollapsed] = useState(
        () => !sidebarOpen
    );

    useEffect(() => {
        if (immediate) {
            setNavMenuCollapsed(!sidebarOpen);
            return;
        }

        const timeoutId = window.setTimeout(() => {
            setNavMenuCollapsed(!sidebarOpen);
        }, NAV_MENU_COLLAPSE_DELAY_MS);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [immediate, sidebarOpen]);

    return immediate ? !sidebarOpen : navMenuCollapsed;
}
