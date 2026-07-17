import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/shadcn/context-menu', async () => {
    const React = await import('react');

    return {
        ContextMenu: ({ children }: React.PropsWithChildren) =>
            React.createElement('div', null, children),
        ContextMenuContent: ({ children }: React.PropsWithChildren) =>
            React.createElement('div', null, children),
        ContextMenuGroup: ({ children }: React.PropsWithChildren) =>
            React.createElement('div', null, children),
        ContextMenuItem: ({
            children,
            disabled
        }: React.PropsWithChildren<{ disabled?: boolean }>) =>
            React.createElement(
                'div',
                { 'aria-disabled': disabled ? 'true' : undefined },
                children
            ),
        ContextMenuSeparator: () => React.createElement('hr'),
        ContextMenuTrigger: ({ children }: React.PropsWithChildren) =>
            React.createElement('div', null, children)
    };
});

vi.mock('react-i18next', () => {
    const translations: Record<string, string> = {
        'common.actions.view_details': 'View details',
        'dialog.launch.open_ingame': 'Open in-game',
        'dialog.launch.self_invite': 'Self invite',
        'dialog.world.actions.new_instance': 'New instance',
        'dialog.world.actions.new_instance_and_open_ingame':
            'New Instance and Open In-game',
        'dialog.world.actions.new_instance_and_self_invite':
            'New Instance and Self Invite',
        'dialog.world.actions.share': 'Share',
        'dialog.world.actions.show_previous_instances':
            'Show previous instances'
    };

    return {
        useTranslation: () => ({
            t: (key: string) => translations[key] || key
        })
    };
});

import { LocationContextMenu } from './LocationContextMenu';

type ContextMenuTestProps = {
    canOpenInstanceInGame?: boolean;
};

function renderContextMenu(props: ContextMenuTestProps = {}) {
    return renderToStaticMarkup(
        React.createElement(
            LocationContextMenu,
            {
                canOpenWorld: true,
                canOpenInstanceInGame: false,
                canUseCurrentInstance: true,
                isOpenPreviousInstanceInfoDialog: false,
                onCopyShareLink: vi.fn(),
                onLaunchCurrentInstance: vi.fn(),
                onNewInstance: vi.fn(),
                onOpenWorld: vi.fn(),
                onSelfInviteCurrentInstance: vi.fn(),
                onShowExactPreviousInstanceInfo: vi.fn(),
                onShowPreviousInstances: vi.fn(),
                previousInstancesDialog: null,
                previousInstancesDisabled: false,
                previousInstancesLoading: false,
                shareUrl: 'https://vrchat.com/home/world/wrld_test',
                showLaunchActions: true,
                worldId: 'wrld_test',
                ...props
            },
            React.createElement('span', null, 'Location')
        )
    );
}

describe('LocationContextMenu', () => {
    it('labels follow-up new instance as open in-game while VRChat is running', () => {
        const html = renderContextMenu({ canOpenInstanceInGame: true });

        expect(html).toContain('New Instance and Open In-game');
        expect(html).not.toContain('New Instance and Self Invite');
    });

    it('labels follow-up new instance as self invite while VRChat is not running', () => {
        const html = renderContextMenu({ canOpenInstanceInGame: false });

        expect(html).toContain('New Instance and Self Invite');
        expect(html).not.toContain('New Instance and Open In-game');
    });
});
