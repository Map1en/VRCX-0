import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    settingsGet: vi.fn(),
    connectionTest: vi.fn(),
    remoteStatus: vi.fn(),
    upload: vi.fn(),
    restoreProbe: vi.fn(),
    restorePrepare: vi.fn(),
    restoreCommit: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        i18n: { language: 'en' }
    })
}));

vi.mock('sonner', () => ({
    toast: {
        error: vi.fn(),
        success: vi.fn(),
        warning: vi.fn()
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appCloudBackupSettingsGet: commandMocks.settingsGet,
        appCloudBackupConnectionTest: commandMocks.connectionTest,
        appCloudBackupRemoteStatus: commandMocks.remoteStatus,
        appCloudBackupUpload: commandMocks.upload,
        appCloudBackupRestoreProbe: commandMocks.restoreProbe,
        appCloudBackupRestorePrepare: commandMocks.restorePrepare,
        appCloudBackupRestoreCommit: commandMocks.restoreCommit
    }
}));

vi.mock('@/platform/tauri/events', () => ({
    subscribeTauriEvent: vi.fn()
}));

type ChildrenProps = { children?: ReactNode };
type ElementProps = ChildrenProps & Record<string, unknown>;

vi.mock('@/ui/shadcn/alert', () => ({
    Alert: ({ children }: ChildrenProps) => <div>{children}</div>,
    AlertDescription: ({ children }: ChildrenProps) => <div>{children}</div>,
    AlertTitle: ({ children }: ChildrenProps) => <strong>{children}</strong>
}));
vi.mock('@/ui/shadcn/badge', () => ({
    Badge: ({ children }: ChildrenProps) => <span>{children}</span>
}));
vi.mock('@/ui/shadcn/button', () => ({
    Button: ({ children, ...props }: ElementProps) => (
        <button {...props}>{children}</button>
    )
}));
vi.mock('@/ui/shadcn/checkbox', () => ({
    Checkbox: (props: ElementProps) => <input type="checkbox" {...props} />
}));
vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({ children }: ChildrenProps) => <div>{children}</div>,
    DialogContent: ({ children }: ChildrenProps) => (
        <section>{children}</section>
    ),
    DialogDescription: ({ children }: ChildrenProps) => <p>{children}</p>,
    DialogFooter: ({ children }: ChildrenProps) => <footer>{children}</footer>,
    DialogHeader: ({ children }: ChildrenProps) => <header>{children}</header>,
    DialogTitle: ({ children }: ChildrenProps) => <h3>{children}</h3>
}));
vi.mock('@/ui/shadcn/input', () => ({
    Input: (props: ElementProps) => <input {...props} />
}));
vi.mock('@/ui/shadcn/progress', () => ({
    Progress: () => <div />
}));
vi.mock('@/ui/shadcn/switch', () => ({
    Switch: ({ checked }: { checked?: boolean }) => (
        <input type="checkbox" checked={checked} readOnly />
    )
}));
vi.mock('../SettingsField', () => ({
    Field: ({ children }: ChildrenProps) => <div>{children}</div>,
    SettingsGroup: ({ children }: ChildrenProps) => (
        <section>{children}</section>
    )
}));

import { SettingsCloudBackup } from './SettingsCloudBackup';

describe('SettingsCloudBackup', () => {
    it('defaults to encrypted password inputs and performs no WebDAV request while rendering', () => {
        const html = renderToStaticMarkup(<SettingsCloudBackup />);

        expect(html.match(/type="password"/g)?.length).toBeGreaterThanOrEqual(
            3
        );
        expect(html).not.toContain('value="password"');
        expect(commandMocks.connectionTest).not.toHaveBeenCalled();
        expect(commandMocks.remoteStatus).not.toHaveBeenCalled();
        expect(commandMocks.upload).not.toHaveBeenCalled();
        expect(commandMocks.restoreProbe).not.toHaveBeenCalled();
        expect(commandMocks.restorePrepare).not.toHaveBeenCalled();
        expect(commandMocks.restoreCommit).not.toHaveBeenCalled();
    });
});
