// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import type { ComponentProps, PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorldProfileRecord } from '@/domain/entities/world';
import type { Button } from '@/ui/shadcn/button';

import type { PlayerListContext } from '../playerListTypes';

type ButtonMockProps = PropsWithChildren<
    ComponentProps<'button'> & Pick<ComponentProps<typeof Button>, 'variant'>
>;

const mocks = vi.hoisted(() => ({
    getInstance: vi.fn(),
    getWorldProfile: vi.fn(),
    openImagePreview: vi.fn()
}));

vi.mock('@/repositories/vrchatInstanceRepository', () => ({
    default: {
        getInstance: mocks.getInstance
    }
}));

vi.mock('@/repositories/worldProfileRepository', () => ({
    default: {
        getWorldProfile: mocks.getWorldProfile
    }
}));

vi.mock('@/services/dialogService', () => ({
    openUserDialog: vi.fn(),
    openWorldDialog: vi.fn()
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: <T,>(
        selector: (state: {
            openImagePreview: typeof mocks.openImagePreview;
        }) => T
    ) => selector({ openImagePreview: mocks.openImagePreview })
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T,>(
        selector: (state: {
            auth: {
                currentUserEndpoint: string;
                currentUserSnapshot: null;
            };
        }) => T
    ) =>
        selector({
            auth: {
                currentUserEndpoint: 'https://api.example.test/api/1',
                currentUserSnapshot: null
            }
        })
}));

vi.mock('@/components/LocationWorld', () => ({
    LocationWorld: () => <div />
}));

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({ children, variant: _variant, ...props }: ButtonMockProps) => (
        <button {...props}>{children}</button>
    )
}));

import { PlayerListWorldHeader } from './PlayerListWorldHeader';

const instanceSnapshot: PlayerListContext = {
    createdAt: '2023-11-14T22:00:00.000Z',
    groupName: 'Test Group',
    location: 'wrld_test:12345~group(grp_test)~groupAccessType(plus)',
    playerCount: 99,
    source: 'runtime',
    time: 0,
    worldId: 'wrld_test',
    worldName: 'Test World'
};

function worldProfile(
    overrides: Partial<WorldProfileRecord> = {}
): WorldProfileRecord {
    return {
        id: 'wrld_test',
        name: 'Test World',
        description: '',
        authorId: 'usr_author',
        authorName: 'Test Author',
        capacity: 80,
        createdAt: '',
        favorites: 0,
        heat: 0,
        imageUrl: '',
        isLabs: false,
        occupants: 0,
        platforms: [],
        popularity: 0,
        publicationDate: null,
        recommendedCapacity: 80,
        releaseStatus: 'public',
        tags: [],
        thumbnailImageUrl: '',
        unityPackages: [],
        updatedAt: '',
        visits: 0,
        ...overrides
    };
}

function renderHeader() {
    return render(
        <PlayerListWorldHeader
            clockNow={1_700_000_000_000}
            instanceSnapshot={instanceSnapshot}
            isGameRunning
            playerCount={99}
        />
    );
}

describe('PlayerListWorldHeader', () => {
    beforeEach(() => {
        mocks.getInstance.mockReset();
        mocks.getWorldProfile.mockReset();
        mocks.openImagePreview.mockReset();

        mocks.getInstance.mockResolvedValue({
            json: { capacity: 100 }
        });
        mocks.getWorldProfile.mockResolvedValue(worldProfile());
    });

    afterEach(() => {
        cleanup();
    });

    it('prefers the current instance capacity over the world capacity', async () => {
        renderHeader();

        await waitFor(() => {
            expect(mocks.getInstance).toHaveBeenCalledWith({
                worldId: 'wrld_test',
                instanceId: '12345~group(grp_test)~groupAccessType(plus)'
            });
        });
        const count = await screen.findByText('99/100');
        expect(count.className).not.toContain('text-amber-400');
    });

    it('highlights the player count once the instance is full', async () => {
        mocks.getInstance.mockResolvedValue({
            json: { capacity: 99 }
        });

        renderHeader();

        const count = await screen.findByText('99/99');
        expect(count.className).toContain('text-amber-400');
    });

    it('shows the world release status so the user knows whether they can create an instance', async () => {
        mocks.getWorldProfile.mockResolvedValue(
            worldProfile({ releaseStatus: 'private' })
        );

        renderHeader();

        expect(
            await screen.findByText('dialog.world.tags.private')
        ).toBeTruthy();
    });

    it('collapses the world description to one line and expands it on click', async () => {
        mocks.getWorldProfile.mockResolvedValue(
            worldProfile({ description: 'First line\nSecond line' })
        );

        renderHeader();

        const description = await screen.findByRole('button', {
            name: /First line/
        });
        expect(description.getAttribute('aria-expanded')).toBe('false');
        expect(description.className).toContain('line-clamp-1');

        fireEvent.click(description);

        expect(description.getAttribute('aria-expanded')).toBe('true');
        expect(description.className).not.toContain('line-clamp-1');
    });
});
