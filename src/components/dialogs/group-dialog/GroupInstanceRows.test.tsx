import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    initReactI18next: {
        type: '3rdParty',
        init: () => {}
    },
    useTranslation: () => ({
        t: (key: string) => key
    })
}));

vi.mock('@/components/LocationWorld', async () => {
    const React = await import('react');

    return {
        LocationWorld: ({
            instanceClickAction
        }: {
            instanceClickAction?: string;
        }) =>
            React.createElement('span', {
                'data-instance-click-action': instanceClickAction
            })
    };
});

vi.mock('@/components/instances/InstanceActionBar', () => ({
    InstanceActionBar: () => null
}));

vi.mock('../world-dialog/WorldDialogViewParts', () => ({
    InstanceUserTiles: () => null
}));

import { GroupInstanceRows } from './GroupInstanceRows';

describe('GroupInstanceRows', () => {
    it('opens the instance details instead of the launch dialog from the instance name', () => {
        const html = renderToStaticMarkup(
            React.createElement(GroupInstanceRows, {
                currentUserId: 'usr_current',
                instances: [
                    {
                        friendCount: 0,
                        id: '12345',
                        instanceId: '12345',
                        location: 'wrld_test:12345~group(grp_test)',
                        ref: {},
                        tag: 'wrld_test:12345~group(grp_test)',
                        users: [],
                        worldId: 'wrld_test',
                        worldName: 'Test World'
                    }
                ]
            })
        );

        expect(html).toContain('data-instance-click-action="world"');
    });
});
