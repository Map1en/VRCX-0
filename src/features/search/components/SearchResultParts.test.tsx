// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorldProfileRecord } from '@/domain/entities/world';
import type { SearchGroupJson } from '@/repositories/vrchatSearchRepository';
import { openGroupDialog } from '@/services/dialogService';

import { GroupRow, WorldCard } from './SearchResultParts';

vi.mock('@/components/media/FadeInImage', () => ({
    FadeInImage: () => null
}));

vi.mock('@/services/dialogService', () => ({
    openAvatarDialog: vi.fn(),
    openGroupDialog: vi.fn(),
    openUserDialog: vi.fn(),
    openWorldDialog: vi.fn()
}));

const world = {
    id: 'wrld_search',
    name: 'Search World',
    description: '',
    authorId: 'usr_author',
    authorName: 'Author',
    capacity: 32,
    createdAt: '',
    favorites: 0,
    heat: 0,
    imageUrl: '',
    isLabs: false,
    occupants: 4,
    platforms: [],
    popularity: 0,
    publicationDate: null,
    recommendedCapacity: 16,
    releaseStatus: 'public',
    tags: [],
    thumbnailImageUrl: '',
    updatedAt: '',
    visits: 0
} satisfies WorldProfileRecord;

const group = {
    bannerId: null,
    description: 'A group from search',
    discriminator: '1234',
    iconUrl: '',
    id: 'grp_search',
    memberCount: 42,
    name: 'Search Group',
    shortCode: 'SEARCH'
} satisfies SearchGroupJson;

beforeEach(() => {
    vi.clearAllMocks();
});

describe('SearchResultParts WorldCard', () => {
    it('uses occupants from the requested world result', () => {
        render(<WorldCard world={world} />);

        expect(screen.getByText('Author')).toBeTruthy();
        expect(screen.getByText('4')).toBeTruthy();
    });
});

describe('SearchResultParts GroupRow', () => {
    it('opens the group dialog from the shared group card', () => {
        render(<GroupRow group={group} />);

        expect(screen.getByText('42')).toBeTruthy();
        expect(screen.getByText('SEARCH.1234')).toBeTruthy();
        fireEvent.click(
            screen.getByRole('button', {
                name: /Search Group/
            })
        );

        expect(openGroupDialog).toHaveBeenCalledWith({
            groupId: group.id,
            title: group.name,
            seedData: group
        });
    });
});
