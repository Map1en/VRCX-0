import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    metadata: {
        currentEndpoint: 'https://api.example.test/api/1',
        region: 'jp',
        instanceName: '12345',
        isClosed: false,
        groupName: '',
        worldName: 'Test World',
        worldNameHint: ''
    },
    preferencesState: {
        preferencesHydrated: true,
        isAgeGatedInstancesVisible: false,
        showInstanceIdInLocation: false
    },
    showLaunchDialog: vi.fn(),
    copyTextToClipboard: vi.fn(),
    openGroupDialog: vi.fn(),
    openWorldDialog: vi.fn(),
    directAccessParse: vi.fn(),
    selfInviteToInstance: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn()
}));

vi.mock('sonner', () => ({
    toast: {
        success: mocks.toastSuccess,
        error: mocks.toastError
    }
}));

vi.mock('@/components/location/LocationContextMenu', async () => {
    const React = await import('react');

    return {
        LocationContextMenu: ({ children }: any) =>
            React.createElement(React.Fragment, null, children)
    };
});

vi.mock('@/components/location/useLocationMetadata', async () => {
    const actual = await vi.importActual(
        '@/components/location/useLocationMetadata'
    );

    return {
        ...actual,
        useLocationMetadata: () => mocks.metadata
    };
});

vi.mock('@/components/location/useLocationPreviousInstancesDialog', () => ({
    useLocationPreviousInstancesDialog: () => ({
        previousInstancesDialog: null as React.ReactNode,
        previousInstancesLoading: false,
        showExactPreviousInstanceInfo: vi.fn(),
        showPreviousInstances: vi.fn()
    })
}));

vi.mock('@/services/entityMediaService', () => ({
    copyTextToClipboard: mocks.copyTextToClipboard
}));

vi.mock('@/services/dialogService', () => ({
    openGroupDialog: mocks.openGroupDialog,
    openWorldDialog: mocks.openWorldDialog
}));

vi.mock('@/services/directAccessService', () => ({
    directAccessParse: mocks.directAccessParse
}));

vi.mock('@/services/launchService', () => ({
    selfInviteToInstance: mocks.selfInviteToInstance
}));

vi.mock('@/state/launchStore', () => ({
    useLaunchStore: (selector: any) =>
        selector({
            showLaunchDialog: mocks.showLaunchDialog
        })
}));

vi.mock('@/state/preferencesStore', () => ({
    usePreferencesStore: (selector: any) => selector(mocks.preferencesState)
}));

vi.mock('react-i18next', () => {
    const translations: any = {
        'component.location.toast.failed_to_send_self_invite':
            'Failed to send self invite',
        'component.region_code_badge.dynamic.region_value': 'Region',
        'dialog.new_instance.access_type_group': 'Group',
        'dialog.new_instance.access_type_public': 'Public',
        'dialog.new_instance.instance_id': 'Instance ID',
        'dialog.user.info.instance_age_restricted': 'Age Restricted',
        'dialog.user.info.instance_age_restricted_tooltip':
            'This instance is age restricted',
        'dialog.user.info.instance_closed': 'Instance closed',
        'location.offline': 'Offline',
        'location.private': 'Private',
        'location.traveling': 'Traveling',
        'message.invite.self_sent': 'Self invite sent',
        'message.world.url_copied': 'World URL copied'
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

vi.mock('@/ui/shadcn/spinner', async () => {
    const React = await import('react');

    return {
        Spinner: (props: any) => React.createElement('span', props, 'loading')
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

import { Location } from './Location';

function renderLocation(props: any = {}) {
    return renderToStaticMarkup(React.createElement(Location, props));
}

describe('Location', () => {
    beforeEach(() => {
        mocks.metadata.currentEndpoint = 'https://api.example.test/api/1';
        mocks.metadata.region = 'jp';
        mocks.metadata.instanceName = '12345';
        mocks.metadata.isClosed = false;
        mocks.metadata.groupName = '';
        mocks.metadata.worldName = 'Test World';
        mocks.metadata.worldNameHint = '';
        mocks.preferencesState.preferencesHydrated = true;
        mocks.preferencesState.isAgeGatedInstancesVisible = false;
        mocks.preferencesState.showInstanceIdInLocation = false;
        mocks.showLaunchDialog.mockReset();
        mocks.copyTextToClipboard.mockReset();
        mocks.openGroupDialog.mockReset();
        mocks.openWorldDialog.mockReset();
        mocks.directAccessParse.mockReset();
        mocks.selfInviteToInstance.mockReset();
        mocks.toastSuccess.mockReset();
        mocks.toastError.mockReset();
    });

    it('renders a world instance with region, access type, group, and instance id', () => {
        mocks.metadata.groupName = 'Group Alpha';
        mocks.preferencesState.showInstanceIdInLocation = true;

        const html = renderLocation({
            location: 'wrld_test:12345~region(jp)~group(grp_test)',
            showGroupLink: true
        });

        expect(html).toContain('JP');
        expect(html).toContain('Test World · Group');
        expect(html).toContain('· #12345');
        expect(html).toContain('(Group Alpha)');
    });

    it('hides age gated instance details until the preference allows them', () => {
        const html = renderLocation({
            location: 'wrld_test:12345~ageGate'
        });

        expect(html).toContain('Age Restricted');
        expect(html).not.toContain('Test World · Public');
    });

    it('uses the traveling target while preserving the traveling indicator', () => {
        const html = renderLocation({
            location: 'traveling',
            traveling: 'wrld_test:12345~region(jp)'
        });

        expect(html).toContain('loading');
        expect(html).toContain('Test World · Public');
    });

    it('renders sentinel location labels without world metadata', () => {
        expect(renderLocation({ location: 'offline' })).toContain('Offline');
        expect(renderLocation({ location: 'private' })).toContain('Private');
    });
});
