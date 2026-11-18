// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const renderedInstanceIds = vi.hoisted((): string[] => []);

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/components/language/useLanguageNames', () => ({
    useLanguageNames: () => ({ languageName: (key: string) => key })
}));

vi.mock('@/repositories/vrchatInstanceRepository', () => ({
    default: { getInstanceCreateOptions: () => new Promise(() => {}) }
}));

vi.mock('@/components/instances/InstanceActionBar', () => ({
    InstanceActionBar: ({ instance }: { instance: { id: string } }) => {
        renderedInstanceIds.push(instance.id);
        return null;
    }
}));

vi.mock('@/components/instances/CurrentInstanceBadge', () => ({
    CurrentInstanceBadge: () => null
}));

vi.mock('@/components/instances/InstanceVisitedBadge', () => ({
    InstanceVisitedBadge: () => null
}));

vi.mock('@/components/layout/ToolbarControls', () => ({
    ToolbarFilterMenu: () => null,
    ToolbarRefreshButton: () => null
}));

vi.mock('./WorldInstanceRowTitle', () => ({
    WorldInstanceRowTitle: () => null
}));

vi.mock('./WorldSidebarPinButton', () => ({
    WorldSidebarPinButton: () => null
}));

vi.mock('./WorldDialogViewParts', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./WorldDialogViewParts')>()),
    InstanceUserTiles: () => null
}));

import type { WorldProfileRecord } from '@/domain/entities/world';

import { WorldDialogInstancesPanel } from './WorldDialogInstancesPanel';
import type { WorldDialogInstanceRow } from './WorldDialogViewParts';

const world: WorldProfileRecord = {
    id: 'wrld_test',
    name: 'Test World',
    description: '',
    authorId: 'usr_author',
    authorName: 'Author',
    capacity: 16,
    createdAt: '2026-01-01T00:00:00Z',
    favorites: 0,
    heat: 0,
    imageUrl: '',
    isLabs: false,
    occupants: 0,
    platforms: ['standalonewindows'],
    popularity: 0,
    publicationDate: null,
    recommendedCapacity: 16,
    releaseStatus: 'public',
    tags: [],
    thumbnailImageUrl: '',
    updatedAt: '2026-01-01T00:00:00Z',
    visits: 0
};
const visibleInstanceUserIds = new Set<string>();

function buildRows(secondUserCount: number): WorldDialogInstanceRow[] {
    return [
        ['1', 3],
        ['2', secondUserCount]
    ].map(([id, userCount]) => ({
        id: String(id),
        location: `wrld_test:${id}`,
        n_users: userCount,
        users: [],
        creatorUserId: '',
        creatorUser: null,
        creatorGroupId: '',
        creatorGroup: null
    }));
}

function renderPanel(rows: WorldDialogInstanceRow[]) {
    return (
        <WorldDialogInstancesPanel
            world={world}
            rows={rows}
            currentUserId="usr_me"
            worldDialogShortName=""
            visibleInstanceUserIds={visibleInstanceUserIds}
            isInstanceLocation={false}
            showHistory={false}
            refreshing={false}
            onShowHistory={() => {}}
            onRefresh={() => {}}
        />
    );
}

describe('WorldDialogInstancesPanel', () => {
    afterEach(() => {
        cleanup();
        renderedInstanceIds.length = 0;
    });

    it('re-renders only the instance rows whose data changed when rows are rebuilt', () => {
        const view = render(renderPanel(buildRows(5)));
        expect(renderedInstanceIds).toEqual(['1', '2']);
        renderedInstanceIds.length = 0;

        view.rerender(renderPanel(buildRows(5)));
        expect(renderedInstanceIds).toEqual([]);

        view.rerender(renderPanel(buildRows(6)));
        expect(renderedInstanceIds).toEqual(['2']);
    });
});
