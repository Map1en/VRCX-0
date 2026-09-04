// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    BackgroundImageCustomSource,
    BackgroundImageSnapshot
} from '@/platform/tauri/bindings';
import { useBackgroundImageStore } from '@/state/backgroundImageStore';

const mocks = vi.hoisted(() => ({
    openFolderAndSelectItem: vi.fn(),
    toastError: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('sonner', () => ({
    toast: {
        error: mocks.toastError,
        success: vi.fn()
    }
}));

vi.mock('@/services/background-image/backgroundImageService', () => ({
    backgroundImageRemoteProviders: [{ id: 'nasa-epic', name: 'NASA EPIC' }],
    chooseBackgroundImageFiles: vi.fn(),
    chooseBackgroundImageFolder: vi.fn(),
    isBackgroundImageCustomSourceRotating: vi.fn(() => false),
    refreshBackgroundImage: vi.fn(),
    setBackgroundImageCustomRotationIntervalMinutes: vi.fn(),
    setBackgroundImageDecoration: vi.fn(),
    setBackgroundImageMode: vi.fn(),
    setBackgroundImageProvider: vi.fn()
}));

vi.mock('@/services/shellIntegrationService', () => ({
    openFolderAndSelectItem: mocks.openFolderAndSelectItem
}));

import { BackgroundImageSection } from './BackgroundImageSection';

const folderSource: BackgroundImageCustomSource = {
    kind: 'folder',
    paths: [],
    folderPath: 'C:\\Pictures',
    rotationIntervalMinutes: 60
};

const filesSource: BackgroundImageCustomSource = {
    kind: 'files',
    paths: ['C:\\Pictures\\one.png', 'C:\\Pictures\\two.png'],
    folderPath: '',
    rotationIntervalMinutes: 60
};

function customSnapshot(imagePath: string): BackgroundImageSnapshot {
    return {
        mode: 'custom',
        providerId: null,
        sourceKind: 'folder',
        imageUrl: `asset://${imagePath}`,
        imagePath,
        imageCount: 2,
        title: imagePath.split('\\').at(-1) ?? imagePath,
        author: '',
        license: '',
        source: '',
        resolvedAt: '2026-08-26T00:00:00.000Z',
        resolvedForKey: imagePath
    };
}

function setFolderBackground(imagePath: string | null): void {
    useBackgroundImageStore.setState({
        mode: 'custom',
        enabled: true,
        providerId: 'nasa-epic',
        customSource: folderSource,
        decorationImageUrl: '',
        snapshot: imagePath ? customSnapshot(imagePath) : null,
        loading: false,
        error: null
    });
}

beforeEach(() => {
    setFolderBackground('C:\\Pictures\\one.png');
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('BackgroundImageSection current folder image', () => {
    it('shows the current image in its folder without treating it as a folder', async () => {
        const user = userEvent.setup();
        render(<BackgroundImageSection />);

        await user.click(
            screen.getByRole('button', {
                name: 'view.background_image.action.show_in_folder'
            })
        );

        expect(mocks.openFolderAndSelectItem).toHaveBeenCalledWith(
            'C:\\Pictures\\one.png',
            false
        );
    });

    it('uses the latest snapshot path after the background changes', async () => {
        const user = userEvent.setup();
        render(<BackgroundImageSection />);

        act(() => {
            setFolderBackground('C:\\Pictures\\two.png');
        });
        await user.click(
            screen.getByRole('button', {
                name: 'view.background_image.action.show_in_folder'
            })
        );

        expect(mocks.openFolderAndSelectItem).toHaveBeenCalledWith(
            'C:\\Pictures\\two.png',
            false
        );
    });

    it('hides the action outside an enabled folder source with a current path', () => {
        render(<BackgroundImageSection />);
        const queryAction = () =>
            screen.queryByRole('button', {
                name: 'view.background_image.action.show_in_folder'
            });

        act(() => {
            useBackgroundImageStore.setState({ customSource: filesSource });
        });
        expect(queryAction()).toBeNull();

        act(() => {
            useBackgroundImageStore.setState({
                mode: 'daily',
                customSource: null,
                snapshot: {
                    ...customSnapshot('C:\\Pictures\\daily.png'),
                    mode: 'daily',
                    imagePath: null
                }
            });
        });
        expect(queryAction()).toBeNull();

        act(() => {
            setFolderBackground(null);
        });
        expect(queryAction()).toBeNull();

        act(() => {
            setFolderBackground('C:\\Pictures\\one.png');
            useBackgroundImageStore.setState({ enabled: false });
        });
        expect(queryAction()).toBeNull();
    });

    it('reports a localized error when the folder cannot be opened', async () => {
        const user = userEvent.setup();
        mocks.openFolderAndSelectItem.mockRejectedValueOnce(
            new Error('platform failure')
        );
        render(<BackgroundImageSection />);

        await user.click(
            screen.getByRole('button', {
                name: 'view.background_image.action.show_in_folder'
            })
        );

        await waitFor(() => {
            expect(mocks.toastError).toHaveBeenCalledWith(
                'view.background_image.toast.failed_to_open_folder'
            );
        });
    });

    it('shows menu previews while keeping the selected decoration text-only', async () => {
        const user = userEvent.setup();
        useBackgroundImageStore.setState({
            mode: 'off',
            enabled: true,
            customSource: null,
            decorationImageUrl:
                'https://assets.vrchat.com/www/profile_decorations/profile_backgrounds/BG_Grid.png',
            snapshot: null
        });

        const { container } = render(<BackgroundImageSection />);

        const triggers = container.querySelectorAll<HTMLElement>(
            '[data-slot="select-trigger"]'
        );
        const decorationTrigger = triggers[1];
        expect(decorationTrigger.textContent).toContain('Grid');
        expect(decorationTrigger.querySelector('img')).toBeNull();
        await user.click(decorationTrigger);

        expect(screen.getByText('Bit Mountain')).toBeTruthy();
        const gridItem = screen
            .getAllByText('Grid')
            .map((label) => label.closest('[data-slot="select-item"]'))
            .find((item) => item !== null);
        expect(
            gridItem?.querySelector('img[src*="BG_Grid.png"]')
        ).not.toBeNull();
        expect(
            screen.getAllByText('view.background_image.mode.decoration').length
        ).toBeGreaterThan(0);
        expect(
            screen.queryByRole('button', {
                name: 'view.background_image.action.refresh'
            })
        ).toBeNull();
    });
});
