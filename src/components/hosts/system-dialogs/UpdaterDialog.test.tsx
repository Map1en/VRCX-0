// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    canInstallUpdatesOnPlatform: vi.fn(),
    previewStableReleaseCheck: vi.fn(),
    getPreviewStableReleaseUpdateMode: vi.fn(),
    appAppUpdateCheckRun: vi.fn(),
    toNormalizedReleaseFromSnapshot: vi.fn(),
    confirmInstall: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            values ? `${key}:${JSON.stringify(values)}` : key
    })
}));

vi.mock('@/services/updateService', () => ({
    canInstallUpdatesOnPlatform: mocks.canInstallUpdatesOnPlatform,
    getPreviewStableReleaseUpdateMode: mocks.getPreviewStableReleaseUpdateMode,
    confirmInstall: mocks.confirmInstall,
    formatReleaseDisplayVersion: (value: unknown) => String(value || ''),
    toNormalizedReleaseFromSnapshot: mocks.toNormalizedReleaseFromSnapshot
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appAppUpdateCheckRun: mocks.appAppUpdateCheckRun
    }
}));

vi.mock('@/services/entityMediaService', () => ({
    openExternalLink: vi.fn()
}));

vi.mock('@/services/shellIntegrationService', () => ({
    restartApplication: vi.fn()
}));

vi.mock('@/ui/shadcn/button', async () => {
    const React = await import('react');

    return {
        Button: ({ children, ...props }: React.ComponentProps<'button'>) =>
            React.createElement('button', props, children)
    };
});

vi.mock('@/ui/shadcn/dialog', async () => {
    const React = await import('react');

    return {
        Dialog: ({ children }: React.PropsWithChildren) =>
            React.createElement('div', null, children),
        DialogContent: ({ children }: React.PropsWithChildren) =>
            React.createElement('section', null, children),
        DialogDescription: ({ children }: React.PropsWithChildren) =>
            React.createElement('p', null, children),
        DialogFooter: ({ children }: React.PropsWithChildren) =>
            React.createElement('footer', null, children),
        DialogHeader: ({ children }: React.PropsWithChildren) =>
            React.createElement('header', null, children),
        DialogTitle: ({ children }: React.PropsWithChildren) =>
            React.createElement('h1', null, children)
    };
});

vi.mock('@/ui/shadcn/field', async () => {
    const React = await import('react');

    return {
        FieldGroup: ({ children }: React.PropsWithChildren) =>
            React.createElement('div', null, children)
    };
});

import { useRuntimeStore } from '@/state/runtimeStore';

import { UpdaterDialog } from './UpdaterDialog';

describe('UpdaterDialog', () => {
    afterEach(() => {
        cleanup();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('VERSION', '2.6.0');
        useRuntimeStore.getState().resetRuntimeState();
        useRuntimeStore.getState().setHostCapabilities({
            platform: 'windows',
            arch: 'x86_64',
            linuxPackageKind: ''
        });
        mocks.canInstallUpdatesOnPlatform.mockReturnValue(true);
        mocks.getPreviewStableReleaseUpdateMode.mockReturnValue({
            enabled: false,
            check: mocks.previewStableReleaseCheck
        });
        mocks.appAppUpdateCheckRun.mockResolvedValue({
            hasAvailableUpdate: false,
            checkedAt: '',
            detail: '',
            error: null,
            release: null,
            shouldNotify: false
        });
        mocks.toNormalizedReleaseFromSnapshot.mockReturnValue(null);
    });

    it('uses the GitHub update action for preview checks even on installable platforms', () => {
        mocks.getPreviewStableReleaseUpdateMode.mockReturnValue({
            enabled: true,
            check: mocks.previewStableReleaseCheck
        });

        const html = renderToStaticMarkup(
            React.createElement(UpdaterDialog, {
                open: true,
                onOpenChange: vi.fn()
            })
        );

        expect(html).toContain('nav_menu.update');
        expect(html).not.toContain('dialog.system.action.install_and_restart');
    });

    it('keeps the install action for stable installable updates', () => {
        const html = renderToStaticMarkup(
            React.createElement(UpdaterDialog, {
                open: true,
                onOpenChange: vi.fn()
            })
        );

        expect(html).toContain('dialog.system.action.install_and_restart');
    });

    it('shows matching background download progress when opened mid-download', async () => {
        const release = {
            displayName: 'VRCX-0 2.7.0',
            tagName: 'v2.7.0',
            htmlUrl: 'https://example.test/releases/v2.7.0',
            publishedAt: '2026-07-18T00:00:00Z',
            body: '',
            canonicalVersion: '2.7.0',
            displayVersion: '2.7.0',
            manifestUrl: 'https://example.test/latest.json',
            target: 'windows-x86_64-stable',
            updaterType: 'tauri'
        };
        mocks.toNormalizedReleaseFromSnapshot.mockReturnValue(release);
        mocks.appAppUpdateCheckRun.mockResolvedValue({
            hasAvailableUpdate: true,
            checkedAt: '2026-07-18T00:00:00.000Z',
            detail: 'Update available.',
            error: null,
            release,
            shouldNotify: false
        });
        useRuntimeStore.getState().setUpdateLoopState({
            autoDownloadState: 'downloading',
            downloadedVersion: '2.7.0',
            downloadProgress: 42
        });

        render(<UpdaterDialog open onOpenChange={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByText('42%')).toBeTruthy();
        });

        act(() => {
            useRuntimeStore.getState().setUpdateLoopState({
                downloadedVersion: '2.8.0'
            });
        });
        expect(screen.queryByText('42%')).toBeNull();
    });
});
