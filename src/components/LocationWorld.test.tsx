import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    metadata: {
        currentEndpoint: 'https://api.example.test/api/1',
        region: 'eu',
        instanceName: '98765',
        isClosed: false,
        groupName: 'Group Beta',
        worldName: 'World Beta',
        worldNameHint: ''
    },
    showLaunchDialog: vi.fn(),
    openGroupDialog: vi.fn(),
    openWorldDialog: vi.fn()
}));

vi.mock('@/components/location/useLocationMetadata', async () => {
    const actual = await vi.importActual(
        '@/components/location/useLocationMetadata'
    );

    return {
        ...actual,
        useLocationMetadata: () => mocks.metadata
    };
});

vi.mock('@/services/dialogService', () => ({
    openGroupDialog: mocks.openGroupDialog,
    openWorldDialog: mocks.openWorldDialog
}));

vi.mock('@/state/launchStore', () => ({
    useLaunchStore: (selector: any) =>
        selector({
            showLaunchDialog: mocks.showLaunchDialog
        })
}));

vi.mock('react-i18next', () => {
    const translations: any = {
        'component.region_code_badge.dynamic.region_value': 'Region',
        'dialog.new_instance.access_type_friend_plus': 'Friends+',
        'dialog.new_instance.access_type_group': 'Group',
        'dialog.new_instance.access_type_group_plus': 'Group Plus',
        'dialog.new_instance.group_access_type_plus': 'Group Plus',
        'dialog.new_instance.access_type_public': 'Public',
        'dialog.user.info.instance_closed': 'Instance closed',
        'dialog.world.instances.instance_creator': 'Creator',
        'location.offline': 'Offline',
        'location.private': 'Private',
        'location.traveling': 'Traveling'
    };

    return {
        useTranslation: () => ({
            t: (key: any) => translations[key] || key
        })
    };
});

vi.mock('@/ui/shadcn/button', async () => {
    const React = await import('react');

    return {
        Button: ({ children, variant: _variant, ...props }: any) =>
            React.createElement('button', props, children)
    };
});

vi.mock('@/ui/shadcn/tooltip', async () => {
    const React = await import('react');

    return {
        Tooltip: ({ children }: any) =>
            React.createElement(React.Fragment, null, children),
        TooltipTrigger: ({ children }: any) =>
            React.createElement(React.Fragment, null, children),
        TooltipContent: ({ children }: any) =>
            React.createElement(
                'span',
                { 'data-tooltip-content': true },
                children
            )
    };
});

import { LocationWorld } from './LocationWorld';

function renderLocationWorld(props: any = {}) {
    return renderToStaticMarkup(React.createElement(LocationWorld, props));
}

describe('LocationWorld', () => {
    beforeEach(() => {
        mocks.metadata.currentEndpoint = 'https://api.example.test/api/1';
        mocks.metadata.region = 'eu';
        mocks.metadata.instanceName = '98765';
        mocks.metadata.isClosed = false;
        mocks.metadata.groupName = 'Group Beta';
        mocks.metadata.worldName = 'World Beta';
        mocks.metadata.worldNameHint = '';
        mocks.showLaunchDialog.mockReset();
        mocks.openGroupDialog.mockReset();
        mocks.openWorldDialog.mockReset();
    });

    it('renders object locations with world, access type, group, creator, and player summary', () => {
        const html = renderLocationWorld({
            locationObject: {
                tag: 'wrld_beta:98765~group(grp_beta)~groupAccessType(plus)~region(eu)',
                worldId: 'wrld_beta',
                instanceId: '98765',
                playerCount: 7,
                world: {
                    capacity: 24
                }
            },
            instanceOwnerName: 'Maple',
            currentUserId: 'usr_other'
        });

        expect(html).toContain('EU');
        expect(html).toContain('World Beta · Group Plus #98765');
        expect(html).toContain('(Group Beta)');
        expect(html).toContain('Creator: Maple');
        expect(html).toContain('7/24');
    });

    it('marks an instance as unlocked when the short name matches', () => {
        const html = renderLocationWorld({
            locationObject: {
                tag: 'wrld_beta:98765~hidden(usr_owner)',
                shortName: 'abc12345'
            },
            worldDialogShortName: 'abc12345'
        });

        expect(html).toContain('data-icon="inline-start"');
    });

    it('renders non-interactive output without action buttons', () => {
        const html = renderLocationWorld({
            locationObject: 'wrld_beta:98765~region(eu)',
            interactive: false
        });

        expect(html).toContain('World Beta · Public #98765');
        expect(html).not.toContain('<button');
    });

    it('renders sentinel status labels without instance details', () => {
        expect(
            renderLocationWorld({ locationObject: { isOffline: true } })
        ).toContain('Offline');
        expect(
            renderLocationWorld({ locationObject: { isPrivate: true } })
        ).toContain('Private');
        expect(
            renderLocationWorld({
                locationObject: { isTraveling: true, worldId: '' }
            })
        ).toContain('Traveling');
    });
});
