import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    confirmCroppedUpload: vi.fn(),
    galleryDialogsProps: null as any
}));

vi.mock('@/components/layout/PageScaffold', async () => {
    const React = await import('react');

    return {
        PageScaffold: ({ children, ...props }: any) =>
            React.createElement('main', props, children),
        PageBody: ({ children }: any) =>
            React.createElement('section', null, children)
    };
});

vi.mock('./components/GalleryHeader', async () => {
    const React = await import('react');

    return {
        GalleryHeader: () =>
            React.createElement('header', { 'data-gallery-header': true })
    };
});

vi.mock('./components/GalleryTabsSection', async () => {
    const React = await import('react');

    return {
        GalleryTabsSection: () =>
            React.createElement('div', { 'data-gallery-tabs': true })
    };
});

vi.mock('./components/GalleryDialogs', async () => {
    const React = await import('react');

    return {
        GalleryDialogs: (props: any) => {
            mocks.galleryDialogsProps = props;
            return React.createElement('div', { 'data-gallery-dialogs': true });
        }
    };
});

vi.mock('./useGalleryPageController', () => ({
    useGalleryPageController: () => {
        const uploadAuthTargetRef: { current: unknown } = { current: null };
        const uploadInputRef: { current: HTMLInputElement | null } = {
            current: null
        };
        return {
            activeTab: 'prints',
            assets: {
                gallery: Array<unknown>(),
                icons: Array<unknown>(),
                prints: Array<unknown>()
            },
            beginUpload: vi.fn(),
            changeGridDensity: vi.fn(),
            confirmCroppedUpload: mocks.confirmCroppedUpload,
            cropRequest: {
                tab: 'prints'
            },
            currentUserId: 'usr_self',
            deleteFileAsset: vi.fn(),
            deletePrint: vi.fn(),
            gridDensity: 'comfortable',
            gridDensityConfig: {},
            isVrcPlusSupporter: true,
            loadingByTab: {},
            mutatingKey: '',
            navigate: vi.fn(),
            openImagePreview: vi.fn(),
            profilePicOverride: '',
            refreshAll: vi.fn(),
            refreshTab: vi.fn(),
            setActiveTab: vi.fn(),
            setCropRequest: vi.fn(),
            setProfileField: vi.fn(),
            tabCounts: {
                gallery: '0/64',
                icons: '0/64',
                prints: '0/64'
            },
            uploadAuthTargetRef,
            uploadInputRef,
            uploadingTab: '',
            uploadSelectedFile: vi.fn(),
            userIcon: ''
        };
    }
}));

import { GalleryPage } from './GalleryPage';

describe('GalleryPage', () => {
    beforeEach(() => {
        mocks.confirmCroppedUpload.mockReset();
        mocks.galleryDialogsProps = null;
    });

    it('forwards crop upload options from the dialog to the upload action', async () => {
        renderToStaticMarkup(React.createElement(GalleryPage));

        const blob = new Blob(['image'], { type: 'image/png' });
        const uploadOptions = {
            note: 'print note',
            cropWhiteBorder: false
        };
        await mocks.galleryDialogsProps.onConfirmCrop(blob, uploadOptions);

        expect(mocks.confirmCroppedUpload).toHaveBeenCalledWith(
            blob,
            uploadOptions
        );
    });
});
