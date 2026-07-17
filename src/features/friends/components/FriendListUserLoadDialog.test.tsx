import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type CapturedButton = {
    label: string;
    disabled: boolean;
    onClick?: () => void;
};

const controls = vi.hoisted(() => ({
    onOpenChange: null as ((open: boolean) => void) | null,
    buttons: [] as CapturedButton[]
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key
    })
}));

vi.mock('@/ui/shadcn/button', async () => {
    const React = await import('react');

    return {
        Button: ({
            children,
            disabled = false,
            onClick
        }: {
            children?: ReactNode;
            disabled?: boolean;
            onClick?: () => void;
        }) => {
            controls.buttons.push({
                label: typeof children === 'string' ? children : '',
                disabled,
                onClick
            });
            return React.createElement(
                'button',
                { disabled, onClick },
                children
            );
        }
    };
});

vi.mock('@/ui/shadcn/dialog', async () => {
    const React = await import('react');
    const Container = ({ children }: { children?: ReactNode }) =>
        React.createElement('div', null, children);

    return {
        Dialog: ({
            children,
            onOpenChange
        }: {
            children?: ReactNode;
            onOpenChange?: (open: boolean) => void;
        }) => {
            controls.onOpenChange = onOpenChange ?? null;
            return React.createElement('div', null, children);
        },
        DialogContent: Container,
        DialogFooter: Container,
        DialogHeader: Container,
        DialogTitle: Container
    };
});

import { FriendListUserLoadDialog } from './FriendListUserLoadDialog';

function renderDialog({
    cancelled = false,
    onCancel = vi.fn(),
    onMinimize = vi.fn()
}: {
    cancelled?: boolean;
    onCancel?: () => void;
    onMinimize?: () => void;
} = {}) {
    const html = renderToStaticMarkup(
        <FriendListUserLoadDialog
            open
            progress={{ current: 2, total: 5, cancelled }}
            percent={40}
            onCancel={onCancel}
            onMinimize={onMinimize}
        />
    );
    return { html, onCancel, onMinimize };
}

function findButton(label: string): CapturedButton {
    const button = controls.buttons.find(
        (candidate) => candidate.label === label
    );
    expect(button).toBeDefined();
    return button!;
}

describe('FriendListUserLoadDialog', () => {
    beforeEach(() => {
        controls.onOpenChange = null;
        controls.buttons.length = 0;
    });

    it('minimizes on dialog close requests and the minimize button without cancelling', () => {
        const { onCancel, onMinimize } = renderDialog();

        controls.onOpenChange?.(false);
        findButton('nativeShell.menu.window.minimize').onClick?.();

        expect(onMinimize).toHaveBeenCalledTimes(2);
        expect(onCancel).not.toHaveBeenCalled();

        controls.onOpenChange?.(true);
        expect(onMinimize).toHaveBeenCalledTimes(2);
    });

    it('uses the explicit cancel button as the only cancellation path', () => {
        const { onCancel, onMinimize } = renderDialog();

        findButton('view.friend_list.load_cancel').onClick?.();

        expect(onCancel).toHaveBeenCalledOnce();
        expect(onMinimize).not.toHaveBeenCalled();
    });

    it('disables cancellation while cancelling and exposes determinate progress', () => {
        const { html } = renderDialog({ cancelled: true });

        expect(
            findButton('view.friend_list.description.cancelling').disabled
        ).toBe(true);
        expect(html).toContain('role="progressbar"');
        expect(html).toContain('aria-valuemin="0"');
        expect(html).toContain('aria-valuemax="5"');
        expect(html).toContain('aria-valuenow="2"');
        expect(html).toContain('aria-valuetext="2 / 5"');
        expect(html).toContain('width:40%');
    });
});
