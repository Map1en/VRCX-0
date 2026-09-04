// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { lazy, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MountOnFirstOpen } from './MountOnFirstOpen';

afterEach(cleanup);

describe('MountOnFirstOpen', () => {
    it('defers loading until opened and preserves state and closing props afterwards', async () => {
        function Content({ open }: { open: boolean }) {
            const [draft, setDraft] = useState(0);
            return (
                <button
                    onClick={() => setDraft(draft + 1)}
                >{`${open ? 'open' : 'closed'}:${draft}`}</button>
            );
        }
        const load = vi.fn(async () => ({ default: Content }));
        const LazyContent = lazy(load);
        function Host({ open }: { open: boolean }) {
            return (
                <MountOnFirstOpen open={open}>
                    <LazyContent open={open} />
                </MountOnFirstOpen>
            );
        }
        const view = render(<Host open={false} />);
        expect(load).not.toHaveBeenCalled();
        view.rerender(<Host open />);
        fireEvent.click(await screen.findByRole('button', { name: 'open:0' }));
        view.rerender(<Host open={false} />);
        expect(screen.getByRole('button', { name: 'closed:1' })).toBeTruthy();
        view.rerender(<Host open />);
        expect(screen.getByRole('button', { name: 'open:1' })).toBeTruthy();
        expect(load).toHaveBeenCalledTimes(1);
    });
});
