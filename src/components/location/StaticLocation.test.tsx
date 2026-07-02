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
    openGroupDialog: vi.fn(),
    locationDisplayProps: null as any
}));

vi.mock('@/components/location/LocationDisplay', async () => {
    const React = await import('react');

    return {
        LocationDisplay: (props: any) => {
            mocks.locationDisplayProps = props;
            return React.createElement('span', null, props.text);
        }
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

vi.mock('@/services/dialogService', () => ({
    openGroupDialog: mocks.openGroupDialog
}));

vi.mock('@/state/preferencesStore', () => ({
    usePreferencesStore: (selector: any) => selector(mocks.preferencesState)
}));

vi.mock('react-i18next', () => {
    const translations: any = {
        'dialog.new_instance.access_type_public': 'Public',
        'dialog.new_instance.instance_id': 'Instance ID'
    };

    return {
        useTranslation: () => ({
            t: (key: any) => translations[key] || key
        })
    };
});

import { StaticLocation } from './StaticLocation';

function renderStaticLocation(props: any = {}) {
    return renderToStaticMarkup(React.createElement(StaticLocation, props));
}

describe('StaticLocation', () => {
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
        mocks.openGroupDialog.mockReset();
        mocks.locationDisplayProps = null;
    });

    it('renders resolved facts as a static, non-interactive location', () => {
        renderStaticLocation({
            location: 'wrld_test:12345~region(jp)'
        });

        const props = mocks.locationDisplayProps;
        expect(props.asButton).toBe(false);
        expect(props.isLocationLink).toBe(false);
        expect(props.region).toBe('jp');
        expect(props.worldName).toBe('Test World');
        expect(props.instanceName).toBe('12345');
        expect(props.text).toContain('Test World');
    });

    it('wires the group click to openGroupDialog instead of a dead button', () => {
        mocks.metadata.groupName = 'Group Alpha';

        renderStaticLocation({
            location: 'wrld_test:12345~region(jp)~group(grp_test)'
        });

        const props = mocks.locationDisplayProps;
        expect(props.showGroupLink).toBe(true);
        expect(typeof props.onOpenGroup).toBe('function');

        props.onOpenGroup();
        expect(mocks.openGroupDialog).toHaveBeenCalledWith({
            groupId: 'grp_test',
            title: 'Group Alpha'
        });
    });

    it('does not open a group dialog when the location has no group', () => {
        renderStaticLocation({
            location: 'wrld_test:12345~region(jp)'
        });

        mocks.locationDisplayProps.onOpenGroup();
        expect(mocks.openGroupDialog).not.toHaveBeenCalled();
    });

    it('forwards showGroupLink and disableTooltip overrides', () => {
        renderStaticLocation({
            location: 'wrld_test:12345~region(jp)',
            showGroupLink: false,
            disableTooltip: true
        });

        const props = mocks.locationDisplayProps;
        expect(props.showGroupLink).toBe(false);
        expect(props.disableTooltip).toBe(true);
    });
});
