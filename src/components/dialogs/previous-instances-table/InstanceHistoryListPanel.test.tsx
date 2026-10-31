// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/components/instances/InstanceActionBar', () => ({
    InstanceActionBar: () => null
}));

vi.mock('@/components/location/StaticLocation', () => ({
    StaticLocation: ({ hint }: { hint: string }) => <span>{hint}</span>
}));

vi.mock('./PreviousInstancesViewParts', () => ({
    DialogEmptyState: () => null,
    PreviousInstanceDetailsPanel: () => null,
    PreviousInstanceWorldLocation: () => null,
    InstanceCreatorCell: ({ row }: { row: { location: string } }) => (
        <span>owner:{row.location}</span>
    )
}));

import { InstanceHistoryListPanel } from './InstanceHistoryListPanel';

const instances = [
    {
        created_at: '2025-03-04T05:06:07.000Z',
        location: 'wrld_1:123~private(usr_owner)',
        worldName: 'World One',
        time: 60000
    }
];

describe('InstanceHistoryListPanel', () => {
    afterEach(() => cleanup());

    it('shows the year and the instance owner for user history rows', () => {
        render(
            <InstanceHistoryListPanel instances={instances} variant="user" />
        );

        expect(screen.getByText(/2025/)).toBeTruthy();
        expect(
            screen.getByText('owner:wrld_1:123~private(usr_owner)')
        ).toBeTruthy();
    });

    it('leaves the owner to the location summary for world history rows', () => {
        render(
            <InstanceHistoryListPanel instances={instances} variant="world" />
        );

        expect(screen.queryByText(/^owner:/)).toBeNull();
    });
});
