import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/platform/tauri/bindings';
import type { FrontendPanicSnapshot } from '@/platform/tauri/bindings';

const mockSnapshot: FrontendPanicSnapshot = {
    appVersion: '2.12.1',
    date: '2026-07-12T07:30:00Z',
    message: 'test panic message',
    location: 'src-tauri/main.rs:123',
    backtrace: 'mock backtrace line 1\nmock backtrace line 2',
    backtraceRaw: 'mock raw backtrace line 1\nmock raw backtrace line 2',
    osVersion: 'Darwin 27'
};

let shouldMockState = false;

vi.mock('react', async (importOriginal) => {
    const original = await importOriginal<typeof import('react')>();
    return {
        ...original,
        useState: (initial: any) => {
            if (shouldMockState && initial === null) {
                return [mockSnapshot, vi.fn()];
            }
            return original.useState(initial);
        }
    };
});

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            values ? `${key}:${JSON.stringify(values)}` : key
    })
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appTakePanicSnapshot: vi.fn(),
        appShowDatedPanicSnapshot: vi.fn()
    }
}));

vi.mock('@/services/shellIntegrationService', () => ({
    openExternalLink: vi.fn()
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

import { PanicDialogHost } from './PanicDialogHost';

describe('PanicDialogHost', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        shouldMockState = false;
    });

    it('renders nothing when there is no panic snapshot', () => {
        vi.mocked(commands.appTakePanicSnapshot).mockResolvedValue(null);

        const html = renderToStaticMarkup(<PanicDialogHost />);
        expect(html).toBe('');
    });

    it('renders the dialog when panic snapshot is found', () => {
        vi.mocked(commands.appTakePanicSnapshot).mockResolvedValue(
            mockSnapshot
        );
        shouldMockState = true;

        const html = renderToStaticMarkup(<PanicDialogHost />);

        expect(html).toContain('dialog.panic.title');
        expect(html).toContain('dialog.panic.os_version');
        expect(html).toContain('Darwin 27');
        expect(html).toContain('2.12.1');
        expect(html).toContain('test panic message');
        expect(html).toContain('src-tauri/main.rs:123');
        expect(html).toContain('mock backtrace line 1');
        expect(html).toContain('dialog.panic.show_snapshot');
        expect(html).toContain('dialog.panic.open_github_issue');
    });
});
