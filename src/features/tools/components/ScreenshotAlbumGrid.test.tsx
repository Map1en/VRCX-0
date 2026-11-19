// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/components/media/useScreenshotThumbnailUrl', () => ({
    useScreenshotThumbnailUrl: () => ({ thumbnailUrl: '', loadState: 'idle' })
}));

import type { ScreenshotFacet } from '@/platform/tauri/bindings';

import { ScreenshotAlbumGrid } from './ScreenshotAlbumGrid';

const facets: ScreenshotFacet[] = Array.from({ length: 500 }, (_, index) => ({
    id: `wrld_${index}`,
    name: `World ${index}`,
    count: 1,
    lastCapturedAtMs: 0,
    coverPath: `C:/shots/${index}.png`
}));

describe('ScreenshotAlbumGrid', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('mounts only the album cards near the viewport', () => {
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(
            800
        );
        vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(
            400
        );

        const view = render(
            <ScreenshotAlbumGrid
                sections={[{ key: 'worlds', label: '', items: facets }]}
                resetKey="world"
                onOpen={() => {}}
            />
        );

        const cards = screen.getAllByRole('button');
        expect(cards.length).toBeGreaterThan(0);
        expect(cards.length).toBeLessThan(100);
        screen.getByText('World 0');
        const rows = view.container.querySelectorAll<HTMLElement>(
            '.absolute.inset-x-0'
        );
        expect(rows[1]?.style.top).toBe('179px');
    });

    it('renders a header above each people section', () => {
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(
            800
        );
        vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(
            800
        );
        const person = (id: string): ScreenshotFacet => ({
            id,
            name: id,
            count: 1,
            lastCapturedAtMs: 0,
            coverPath: ''
        });

        render(
            <ScreenshotAlbumGrid
                sections={[
                    {
                        key: 'friends',
                        label: 'Friends',
                        items: [person('usr_a')]
                    },
                    { key: 'others', label: 'Others', items: [person('usr_b')] }
                ]}
                resetKey="person"
                onOpen={() => {}}
            />
        );

        const text = document.body.textContent ?? '';
        expect(text.indexOf('Friends')).toBeLessThan(text.indexOf('usr_a'));
        expect(text.indexOf('usr_a')).toBeLessThan(text.indexOf('Others'));
        expect(text.indexOf('Others')).toBeLessThan(text.indexOf('usr_b'));
    });
});
