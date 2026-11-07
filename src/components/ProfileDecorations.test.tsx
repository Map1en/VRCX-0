// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePreferencesStore } from '@/state/preferencesStore';

import { ProfileAvatarFrame, useDecorationHover } from './ProfileDecorations';

const decorationItem = {
    metadata: {
        assets: [
            { type: 'base', url: 'https://example.test/frame.png' },
            { type: 'mainAnimation', url: 'https://example.test/frame.webp' }
        ]
    }
};

vi.mock('@/repositories/vrchatMediaRepository', () => ({
    default: {
        getProfileDecorationTemplate: async () => decorationItem
    }
}));

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    usePreferencesStore.getState().patchPreferences({
        reducedMotionAndBlur: false
    });
});

function HoverProbe() {
    const { active, hoverProps } = useDecorationHover();
    return (
        <div data-testid="row" data-active={String(active)} {...hoverProps}>
            <span data-testid="inner" />
        </div>
    );
}

function movePointerTo(target: Element) {
    act(() => {
        target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    });
}

describe('useDecorationHover', () => {
    it('stays active while the pointer moves inside the hovered element', () => {
        render(<HoverProbe />);
        const row = screen.getByTestId('row');

        fireEvent.pointerEnter(row);
        movePointerTo(screen.getByTestId('inner'));

        expect(row.dataset.active).toBe('true');
    });

    it('deactivates when the pointer moves elsewhere without a pointerleave, such as after a context menu closes', () => {
        render(<HoverProbe />);
        const row = screen.getByTestId('row');

        fireEvent.pointerEnter(row);
        movePointerTo(document.body);

        expect(row.dataset.active).toBe('false');
    });
});

describe('ProfileAvatarFrame', () => {
    function renderFrame(active: boolean) {
        const queryClient = new QueryClient();
        queryClient.setQueryData(
            ['profileDecoration', 'iconFrame', 'tmpl'],
            decorationItem
        );
        const wrap = (node: ReactNode) => (
            <QueryClientProvider client={queryClient}>
                {node}
            </QueryClientProvider>
        );
        const view = render(
            wrap(<ProfileAvatarFrame templateId="tmpl" active={active} />)
        );
        return {
            ...view,
            setActive: (next: boolean) =>
                view.rerender(
                    wrap(<ProfileAvatarFrame templateId="tmpl" active={next} />)
                ),
            animationState: () =>
                view.container
                    .querySelector('[data-decoration-animation]')
                    ?.getAttribute('data-decoration-animation') ?? null
        };
    }

    it('fades the animation out before removing it when the frame deactivates', () => {
        vi.useFakeTimers();
        const frame = renderFrame(true);
        expect(frame.animationState()).toBe('on');

        frame.setActive(false);
        expect(frame.animationState()).toBe('fading');

        act(() => {
            vi.advanceTimersByTime(499);
        });
        expect(frame.animationState()).toBe('fading');

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(frame.animationState()).toBeNull();
    });

    it('resumes the animation when reactivated while fading out', () => {
        vi.useFakeTimers();
        const frame = renderFrame(true);
        frame.setActive(false);
        frame.setActive(true);

        act(() => {
            vi.advanceTimersByTime(500);
        });
        expect(frame.animationState()).toBe('on');
    });

    it('does not show the animation while inactive', () => {
        expect(renderFrame(false).animationState()).toBeNull();
    });

    it('skips the animation and its fade-out when the app reduces effects', () => {
        usePreferencesStore.getState().patchPreferences({
            reducedMotionAndBlur: true
        });
        const frame = renderFrame(true);
        expect(frame.animationState()).toBeNull();

        frame.setActive(false);
        expect(frame.animationState()).toBeNull();
    });

    it('skips the animation when the system prefers reduced motion', () => {
        vi.stubGlobal('matchMedia', (query: string) => ({
            matches: query === '(prefers-reduced-motion: reduce)'
        }));
        expect(renderFrame(true).animationState()).toBeNull();
    });
});
