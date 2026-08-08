// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openExternalLink } from '@/services/entityMediaService';

import { SessionEventGroups } from './GameLogSessionEventRow';

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string) => key
        })
    };
});

vi.mock('@/services/entityMediaService', () => ({
    openExternalLink: vi.fn()
}));

vi.mock('@/services/clipboardService', () => ({
    copyTextToClipboard: vi.fn()
}));

afterEach(() => {
    cleanup();
    vi.mocked(openExternalLink).mockReset();
});

describe('SessionEventGroups resource loads', () => {
    it('renders ImageLoad and opens its resource URL', () => {
        render(
            <SessionEventGroups
                events={[
                    {
                        type: 'ImageLoad',
                        created_at: '2026-01-01T10:00:01.000Z',
                        resourceUrl: 'https://resource.test/image.png'
                    }
                ]}
            />
        );

        expect(
            screen.getByText('view.game_log.sessions.resources')
        ).toBeTruthy();
        expect(
            screen.getByText('view.game_log.filters.ImageLoad')
        ).toBeTruthy();
        fireEvent.click(screen.getByText('https://resource.test/image.png'));
        expect(openExternalLink).toHaveBeenCalledWith(
            'https://resource.test/image.png'
        );
    });

    it('renders StringLoad alongside image events', () => {
        render(
            <SessionEventGroups
                events={[
                    {
                        type: 'StringLoad',
                        created_at: '2026-01-01T10:00:02.000Z',
                        resourceUrl: 'https://resource.test/config.json'
                    },
                    {
                        type: 'ImageLoad',
                        created_at: '2026-01-01T10:00:03.000Z',
                        resourceUrl: 'https://resource.test/image.png'
                    }
                ]}
            />
        );

        expect(
            screen.getByText('https://resource.test/config.json')
        ).toBeTruthy();
        expect(
            screen.getByText('https://resource.test/image.png')
        ).toBeTruthy();
    });
});
