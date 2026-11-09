// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            values ? `${key}:${JSON.stringify(values)}` : key
    })
}));

import { PlayerListMutualScan } from './PlayerListMutualScan';

type Scan = Parameters<typeof PlayerListMutualScan>[0]['scan'];

function scan(overrides: Partial<Scan> = {}): Scan {
    return {
        canStart: true,
        completed: false,
        hasPending: true,
        hide: vi.fn(),
        isGraphFetching: false,
        needsGraphBuild: false,
        progress: null,
        show: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        summary: null,
        visible: false,
        ...overrides
    };
}

function renderScan(model: Scan) {
    render(
        <MemoryRouter>
            <PlayerListMutualScan scan={model} />
        </MemoryRouter>
    );
    return screen
        .queryAllByRole('button')
        .map(
            (button) => button.getAttribute('aria-label') ?? button.textContent
        );
}

afterEach(cleanup);

describe('PlayerListMutualScan', () => {
    it('offers the first query as a quiet icon before anything was checked', () => {
        const model = scan();

        expect(renderScan(model)).toEqual([
            'view.player_list.mutual_friends.query'
        ]);
        expect(screen.getByRole('button').textContent).toBe('');
        fireEvent.click(screen.getByRole('button'));
        expect(model.start).toHaveBeenCalledOnce();
    });

    it('shows progress that can be stopped while checking', () => {
        const model = scan({ progress: { done: 2, total: 5 }, visible: true });

        expect(renderScan(model)).toEqual([
            'view.charts.mutual_friend.actions.stop'
        ]);
        expect(screen.getByRole('button').textContent).toBe('2/5');
        fireEvent.click(screen.getByRole('button'));
        expect(model.stop).toHaveBeenCalledOnce();
    });

    it('lets shown results be hidden, and offers a re-query next to it when someone new joins', () => {
        expect(
            renderScan(
                scan({ completed: true, hasPending: false, visible: true })
            )
        ).toEqual(['view.player_list.mutual_friends.hide']);
        cleanup();

        expect(
            renderScan(
                scan({ completed: true, hasPending: true, visible: true })
            )
        ).toEqual([
            'view.player_list.mutual_friends.requery',
            'view.player_list.mutual_friends.hide'
        ]);
    });

    it('collapses hidden results back to an icon that restores them, or re-queries when someone new joined meanwhile', () => {
        const hidden = scan({ completed: true, hasPending: false });
        expect(renderScan(hidden)).toEqual([
            'view.player_list.mutual_friends.show'
        ]);
        expect(screen.getByRole('button').textContent).toBe('');
        fireEvent.click(screen.getByRole('button'));
        expect(hidden.show).toHaveBeenCalledOnce();
        cleanup();

        expect(renderScan(scan({ completed: true, hasPending: true }))).toEqual(
            ['view.player_list.mutual_friends.requery']
        );
    });

    it('summarizes the circles found in the room and offers to build the friend graph', () => {
        renderScan(
            scan({
                completed: true,
                hasPending: false,
                needsGraphBuild: true,
                visible: true,
                summary: {
                    matchedCount: 3,
                    circles: [
                        {
                            index: 0,
                            size: 5,
                            color: '#123456',
                            label: 'Anchor',
                            isNamed: true
                        }
                    ]
                }
            })
        );

        expect(
            screen.getByText(
                'view.player_list.mutual_friends.summary:{"count":3}'
            )
        ).toBeTruthy();
        expect(screen.getByText('Anchor')).toBeTruthy();
        expect(
            screen.getByRole('button', { name: 'mutual_graph_hint.build' })
        ).toBeTruthy();
    });

    it('keeps the query disabled while the friend graph is being fetched', () => {
        renderScan(scan({ canStart: false, isGraphFetching: true }));

        expect(
            screen
                .getByRole('button', {
                    name: 'view.player_list.mutual_friends.query'
                })
                .hasAttribute('disabled')
        ).toBe(true);
    });
});
