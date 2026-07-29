// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) =>
            ({
                'dialog.alertdialog.cancel': '取消',
                'dialog.alertdialog.confirm': '确认',
                'dialog.alertdialog.ok': '确定',
                'dialog.tools.label.prompt_value': '请输入内容'
            })[key] ?? key
    })
}));

vi.mock('@/components/dialogs/BoopEmojiDialog', () => ({
    BoopEmojiDialog: () => null
}));

vi.mock('@/components/media/FullscreenImageViewer', () => ({
    FullscreenImageViewer: () => null
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: (
        selector: (state: { auth: { currentUserSnapshot: null } }) => unknown
    ) => selector({ auth: { currentUserSnapshot: null } })
}));

vi.mock('@/ui/shadcn/alert-dialog', () => ({
    AlertDialog: ({ children, open }: PropsWithChildren<{ open: boolean }>) =>
        open ? <div>{children}</div> : null,
    AlertDialogContent: ({ children }: PropsWithChildren) => (
        <section>{children}</section>
    ),
    AlertDialogDescription: ({ children }: PropsWithChildren) => (
        <p>{children}</p>
    ),
    AlertDialogFooter: ({ children }: PropsWithChildren) => (
        <footer>{children}</footer>
    ),
    AlertDialogHeader: ({ children }: PropsWithChildren) => (
        <header>{children}</header>
    ),
    AlertDialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}));

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({ children, ...props }: ComponentProps<'button'>) => (
        <button {...props}>{children}</button>
    )
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({
        children,
        open,
        disablePointerDismissal = false,
        onOpenChange
    }: PropsWithChildren<{
        open: boolean;
        disablePointerDismissal?: boolean;
        onOpenChange?(open: boolean): void;
    }>) =>
        open ? (
            <div
                data-testid="dialog-root"
                data-disable-pointer-dismissal={disablePointerDismissal}
            >
                <button type="button" onClick={() => onOpenChange?.(false)}>
                    dismiss dialog
                </button>
                {children}
            </div>
        ) : null,
    DialogContent: ({
        children,
        showCloseButton: _showCloseButton,
        ...props
    }: PropsWithChildren<
        ComponentProps<'section'> & { showCloseButton?: boolean }
    >) => <section {...props}>{children}</section>,
    DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
    DialogFooter: ({ children }: PropsWithChildren) => (
        <footer>{children}</footer>
    ),
    DialogHeader: ({ children }: PropsWithChildren) => (
        <header>{children}</header>
    ),
    DialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}));

vi.mock('@/ui/shadcn/input', () => ({
    Input: (props: ComponentProps<'input'>) => <input {...props} />
}));

vi.mock('@/ui/shadcn/input-otp', () => ({
    InputOTP: ({ children }: PropsWithChildren) => <div>{children}</div>,
    InputOTPGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
    InputOTPSeparator: () => null,
    InputOTPSlot: () => null
}));

vi.mock('@/ui/shadcn/textarea', () => ({
    Textarea: (props: ComponentProps<'textarea'>) => <textarea {...props} />
}));

import { useModalStore } from '@/state/modalStore';

import { ModalHost } from './ModalHost';

describe('ModalHost', () => {
    beforeEach(() => {
        useModalStore.getState().resetModalState();
    });

    afterEach(() => {
        cleanup();
        useModalStore.getState().resetModalState();
    });

    it('localizes default prompt actions while preserving custom labels', () => {
        void useModalStore.getState().prompt({
            title: '延迟时间',
            description: '输入延迟时间'
        });

        const view = render(<ModalHost />);

        expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '确认' })).toBeTruthy();

        void useModalStore.getState().prompt({
            title: '自定义操作',
            confirmText: '保存',
            cancelText: '返回'
        });
        view.rerender(<ModalHost />);

        expect(screen.getByRole('button', { name: '返回' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '保存' })).toBeTruthy();
    });

    it('dismisses confirmations through the standard dialog close path', async () => {
        const result = useModalStore.getState().confirm({
            title: '关闭房间',
            description: 'wrld_test:1'
        });

        render(<ModalHost />);

        expect(screen.getByRole('alertdialog')).toBeTruthy();
        expect(
            screen
                .getByTestId('dialog-root')
                .getAttribute('data-disable-pointer-dismissal')
        ).toBe('false');

        fireEvent.click(screen.getByRole('button', { name: 'dismiss dialog' }));

        await expect(result).resolves.toMatchObject({
            ok: false,
            reason: 'dismiss'
        });
        expect(screen.queryByRole('alertdialog')).toBeNull();
    });
});
