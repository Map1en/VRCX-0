import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    canInstallUpdatesOnPlatform: vi.fn(),
    previewStableReleaseCheck: vi.fn(),
    getPreviewStableReleaseUpdateMode: vi.fn(),
    fetchLatestBranchRelease: vi.fn(),
    hasUpdateForBranch: vi.fn(),
    downloadAndInstallUpdate: vi.fn()
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
    downloadAndInstallUpdate: mocks.downloadAndInstallUpdate,
    fetchLatestBranchRelease: mocks.fetchLatestBranchRelease,
    formatReleaseDisplayVersion: (value: unknown) => String(value || ''),
    hasUpdateForBranch: mocks.hasUpdateForBranch
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
        Button: ({ children, ...props }: any) =>
            React.createElement('button', props, children)
    };
});

vi.mock('@/ui/shadcn/dialog', async () => {
    const React = await import('react');

    return {
        Dialog: ({ children }: any) =>
            React.createElement('div', null, children),
        DialogContent: ({ children }: any) =>
            React.createElement('section', null, children),
        DialogDescription: ({ children }: any) =>
            React.createElement('p', null, children),
        DialogFooter: ({ children }: any) =>
            React.createElement('footer', null, children),
        DialogHeader: ({ children }: any) =>
            React.createElement('header', null, children),
        DialogTitle: ({ children }: any) =>
            React.createElement('h1', null, children)
    };
});

vi.mock('@/ui/shadcn/field', async () => {
    const React = await import('react');

    return {
        FieldGroup: ({ children }: any) =>
            React.createElement('div', null, children)
    };
});

import { useRuntimeStore } from '@/state/runtimeStore';

import { UpdaterDialog } from './UpdaterDialog';

describe('UpdaterDialog', () => {
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
});
