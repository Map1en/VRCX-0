// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const renders = vi.hoisted(() => ({ gallery: 0, icons: 0, prints: 0 }));

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('./GalleryFileTab', () => ({
    GalleryFileTab: ({ tab }: { tab: 'gallery' | 'icons' }) => {
        renders[tab] += 1;
        return <span>{tab} panel</span>;
    }
}));

vi.mock('./GalleryPrintsTab', () => ({
    GalleryPrintsTab: () => {
        renders.prints += 1;
        return <span>prints panel</span>;
    }
}));

import { EMPTY_ASSETS } from '../galleryConstants';
import { getGalleryGridDensityConfig } from '../galleryDensity';
import type { GalleryFileTabState } from '../galleryTypes';
import type { GalleryPrintsTabState } from './GalleryPrintsTab';
import { GalleryTabs } from './GalleryTabs';

const noop = () => {};
const gridDensityConfig = getGalleryGridDensityConfig('compact');
const bulkCommands = {
    bulkRunning: false,
    onBulkDelete: noop,
    onBulkSetFavorite: noop
};
const fileTab: GalleryFileTabState = {
    ...bulkCommands,
    activeTab: 'gallery',
    assets: EMPTY_ASSETS,
    clipboardPasting: false,
    currentUserId: 'usr_me',
    gridDensityConfig,
    isVrcPlusSupporter: true,
    loadingByTab: {},
    mutatingKey: '',
    bannerCustomUrl: '',
    mediaProfileLoading: false,
    mediaProfileError: '',
    uploadingTab: '',
    userIcon: '',
    onBeginUpload: noop,
    onPasteUpload: noop,
    onClearProfileField: noop,
    onDeleteFile: noop,
    onPreview: noop,
    onSetProfileField: noop
};
const printsTab: GalleryPrintsTabState = {
    ...bulkCommands,
    activeTab: 'gallery',
    gridDensityConfig,
    isVrcPlusSupporter: true,
    loading: false,
    onBeginUpload: noop,
    onPasteUpload: noop,
    onDeletePrint: noop,
    onPreview: noop,
    onRefresh: noop,
    prints: []
};
const tabCounts = { gallery: '', icons: '', prints: '' };

function renderTabs(activeTab: 'gallery' | 'prints') {
    return (
        <GalleryTabs
            activeTab={activeTab}
            onActiveTabChange={noop}
            tabCounts={tabCounts}
            fileTab={fileTab}
            printsTab={printsTab}
        />
    );
}

describe('GalleryTabs', () => {
    afterEach(() => {
        cleanup();
        renders.gallery = 0;
        renders.icons = 0;
        renders.prints = 0;
    });

    it('keeps visited tabs mounted and skips re-rendering them while hidden', () => {
        const view = render(renderTabs('gallery'));
        view.rerender(renderTabs('prints'));
        screen.getByText('gallery panel');
        screen.getByText('prints panel');
        expect(screen.queryByText('icons panel')).toBeNull();

        const galleryRenders = renders.gallery;
        view.rerender(renderTabs('prints'));
        expect(renders.gallery).toBe(galleryRenders);

        view.rerender(renderTabs('gallery'));
        expect(renders.gallery).toBeGreaterThan(galleryRenders);
    });
});
