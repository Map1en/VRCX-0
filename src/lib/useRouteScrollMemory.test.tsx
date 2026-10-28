// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRouteScrollMemory } from './useRouteScrollMemory';

let scrollHeight = 1000;

function ScrollPage({ scrollKey }: { scrollKey: string }) {
    const ref = useRef<HTMLDivElement | null>(null);
    useRouteScrollMemory(ref, scrollKey);
    return <div ref={ref} data-testid="scroller" />;
}

function scrollTo(top: number) {
    const scroller = screen.getByTestId('scroller');
    scroller.scrollTop = top;
    fireEvent.scroll(scroller);
}

describe('useRouteScrollMemory', () => {
    beforeEach(() => {
        scrollHeight = 1000;
        vi.spyOn(
            HTMLElement.prototype,
            'scrollHeight',
            'get'
        ).mockImplementation(() => scrollHeight);
        vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(
            200
        );
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('restores the last scroll position when the page mounts again', () => {
        render(<ScrollPage scrollKey="tools" />);
        scrollTo(320);
        cleanup();

        render(<ScrollPage scrollKey="tools" />);

        expect(screen.getByTestId('scroller').scrollTop).toBe(320);
    });

    it('keeps positions separate per key', () => {
        render(<ScrollPage scrollKey="themes" />);
        scrollTo(150);
        cleanup();

        render(<ScrollPage scrollKey="settings" />);

        expect(screen.getByTestId('scroller').scrollTop).toBe(0);
    });

    it('skips restoring when the content is too short to reach the saved position', () => {
        render(<ScrollPage scrollKey="short" />);
        scrollTo(700);
        cleanup();
        scrollHeight = 500;

        render(<ScrollPage scrollKey="short" />);

        expect(screen.getByTestId('scroller').scrollTop).toBe(0);
    });
});
