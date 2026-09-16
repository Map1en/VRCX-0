// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
    const translation = { t: (key: string) => key };
    return { useTranslation: () => translation };
});

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getString: vi.fn().mockResolvedValue(''),
        getObject: vi.fn().mockResolvedValue({})
    }
}));

vi.mock('@/repositories/mediaRepository', () => ({ default: {} }));
vi.mock('@/services/screenshotLibraryScanService', () => ({}));
vi.mock('@/services/toastService', () => ({ toast: { add: vi.fn() } }));

import { useScreenshotGalleryController } from './useScreenshotGalleryController';

afterEach(cleanup);

describe('returning to the screenshot gallery', () => {
    it.each(['C:\\VRChat\\2026-09', ''])(
        'keeps the folder path when clicking back from detail (%s)',
        async (routeFolder) => {
            const setSearchParams = vi.fn();
            function Harness() {
                const { openGalleryRoute, selectedGalleryFolder } =
                    useScreenshotGalleryController({
                        isGalleryMode: false,
                        routeFolder,
                        screenshotCacheStatus: {
                            supported: true,
                            enabled: false,
                            available: false
                        },
                        setSearchParams
                    });
                return (
                    <>
                        <button onClick={openGalleryRoute}>Gallery</button>
                        <output data-testid="folder">
                            {selectedGalleryFolder}
                        </output>
                    </>
                );
            }

            render(<Harness />);
            fireEvent.click(screen.getByRole('button', { name: 'Gallery' }));

            await waitFor(() => {
                expect(screen.getByTestId('folder').textContent).toBe(
                    routeFolder
                );
            });
            expect(setSearchParams).toHaveBeenCalledTimes(1);
            const params = setSearchParams.mock.calls[0][0];
            expect(params).toBeInstanceOf(URLSearchParams);
            expect(params.get('folder')).toBe(routeFolder || null);
            expect(params.has('path')).toBe(false);
        }
    );
});
