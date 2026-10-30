// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedRow } from '@/components/feed/feedTypes';

const mocks = vi.hoisted(() => ({
    appFileMetadataGet: vi.fn(),
    openImagePreview: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn() }
}));

vi.mock('@/components/media/FadeInImage', () => ({
    FadeInImage: ({ alt }: { alt: string }) => <span>{alt}</span>
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: { appFileMetadataGet: mocks.appFileMetadataGet }
}));

vi.mock('@/services/dialogService', () => ({
    openAvatarDialog: vi.fn(),
    openUserDialog: vi.fn()
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: <T,>(
        selector: (state: {
            openImagePreview: typeof mocks.openImagePreview;
        }) => T
    ): T => selector({ openImagePreview: mocks.openImagePreview })
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T,>(
        selector: (state: {
            auth: {
                currentUserEndpoint: string;
                currentUserSnapshot: null;
            };
        }) => T
    ): T =>
        selector({
            auth: {
                currentUserEndpoint: 'https://api.example.test',
                currentUserSnapshot: null
            }
        })
}));

vi.mock('@/components/feed/FeedLocationLink', () => ({
    FeedLocationLink: () => null
}));

import { FeedDetailCell } from '@/components/feed/FeedDetailCell';
import { FeedExpandedRow } from '@/features/feed/components/FeedExpandedRow';

const avatarRow: FeedRow = {
    avatarName: '',
    currentAvatarImageUrl: 'https://api.example.test/file/file_avatar/1/file',
    ownerId: '',
    type: 'Avatar',
    userId: 'usr_feed'
};

describe('Feed avatar info loading', () => {
    afterEach(cleanup);

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.appFileMetadataGet.mockResolvedValue({
            id: 'file_avatar',
            name: 'Avatar - Resolved Avatar - Image - 1',
            ownerId: 'usr_owner',
            avatarName: 'Resolved Avatar'
        });
    });

    it('resolves avatar file metadata for the collapsed row', async () => {
        render(<FeedDetailCell row={avatarRow} />);

        await waitFor(() => {
            expect(mocks.appFileMetadataGet).toHaveBeenCalledOnce();
            expect(screen.getByText('Resolved Avatar')).toBeTruthy();
        });
    });

    it('resolves avatar file metadata for the expanded row', async () => {
        render(
            <FeedExpandedRow
                loadingHistoryKey=""
                onNewInstance={vi.fn()}
                onOpenPreviousInstances={vi.fn()}
                row={avatarRow}
            />
        );

        await waitFor(() => {
            expect(mocks.appFileMetadataGet).toHaveBeenCalledOnce();
            expect(screen.getByText('Resolved Avatar')).toBeTruthy();
        });
    });
});

describe('Feed bio display', () => {
    afterEach(cleanup);

    const bioRow: FeedRow = {
        type: 'Bio',
        userId: 'usr_feed',
        previousBio: 'Old˸ text',
        bio: 'Find me ＠ discord˸ maple'
    };

    it('restores the symbols VRChat swaps in bios', () => {
        render(<FeedDetailCell row={bioRow} />);
        expect(screen.getByText('Find me @ discord: maple')).toBeTruthy();

        cleanup();
        const { container } = render(
            <FeedExpandedRow
                loadingHistoryKey=""
                onNewInstance={vi.fn()}
                onOpenPreviousInstances={vi.fn()}
                row={bioRow}
            />
        );
        expect(container.textContent).toContain('discord: maple');
        expect(container.textContent).not.toContain('˸');
    });
});
