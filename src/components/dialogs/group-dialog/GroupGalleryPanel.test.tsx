// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GroupProfileRecord } from '@/domain/entities/group';

const mocks = vi.hoisted(() => ({
    appVrchatGroupGalleryCreate: vi.fn(),
    appVrchatGroupGalleryImageDelete: vi.fn(),
    confirm: vi.fn(),
    toastAdd: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appVrchatGroupGalleryCreate: mocks.appVrchatGroupGalleryCreate,
        appVrchatGroupGalleryImageDelete: mocks.appVrchatGroupGalleryImageDelete
    }
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toastAdd }
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: <T,>(
        selector: (state: { confirm: typeof mocks.confirm }) => T
    ): T => selector({ confirm: mocks.confirm })
}));

vi.mock('@/repositories/vrchatMediaRepository', () => ({
    default: { getFileList: vi.fn().mockResolvedValue({ json: [] }) }
}));

import { GroupGalleryPanel } from './GroupGalleryPanel';

const galleries = [
    {
        id: 'ggal_events',
        name: 'Events',
        roleIdsToSubmit: ['grol_artist']
    },
    { id: 'ggal_empty', name: 'Empty', membersOnly: true }
];

function renderPanel(
    patch: Partial<GroupProfileRecord>,
    currentUserId: string,
    handlers = { onGalleriesChanged: vi.fn(), onImagesChanged: vi.fn() }
) {
    render(
        <GroupGalleryPanel
            group={
                {
                    id: 'grp_1',
                    name: 'Club',
                    ownerId: 'usr_owner',
                    galleries,
                    ...patch
                } as GroupProfileRecord
            }
            rows={[
                {
                    id: 'ggim_mine',
                    galleryId: 'ggal_events',
                    $galleryId: 'ggal_events',
                    imageUrl: 'https://img.test/mine.png',
                    submittedByUserId: 'usr_artist'
                },
                {
                    id: 'ggim_other',
                    galleryId: 'ggal_events',
                    $galleryId: 'ggal_events',
                    imageUrl: 'https://img.test/other.png',
                    submittedByUserId: 'usr_other'
                }
            ]}
            loading={false}
            error=""
            currentUserId={currentUserId}
            onPreviewImage={vi.fn()}
            {...handlers}
        />
    );
    return handlers;
}

describe('GroupGalleryPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it('lists empty galleries and lets the owner create one', async () => {
        mocks.appVrchatGroupGalleryCreate.mockResolvedValue({
            status: 200,
            data: '{"id":"ggal_new"}'
        });
        const handlers = renderPanel({}, 'usr_owner');

        expect(screen.getByRole('tab', { name: /Empty/ })).toBeTruthy();
        fireEvent.click(
            screen.getByRole('button', { name: /dialog.group.gallery.create/ })
        );
        fireEvent.change(screen.getByLabelText('dialog.group.gallery.name'), {
            target: { value: ' Screenshots ' }
        });
        fireEvent.click(
            screen.getByRole('checkbox', {
                name: 'dialog.group.gallery.members_only'
            })
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.save' })
        );

        await waitFor(() =>
            expect(handlers.onGalleriesChanged).toHaveBeenCalled()
        );
        expect(mocks.appVrchatGroupGalleryCreate).toHaveBeenCalledWith({
            groupId: 'grp_1',
            params: {
                name: 'Screenshots',
                description: '',
                membersOnly: true
            }
        });
    });

    it('lets a submitter add images and delete only their own', async () => {
        mocks.confirm.mockResolvedValue({ ok: true });
        mocks.appVrchatGroupGalleryImageDelete.mockResolvedValue({
            status: 200,
            data: '{}'
        });
        const handlers = renderPanel(
            { myMember: { roleIds: ['grol_artist'] } },
            'usr_artist'
        );

        expect(
            screen.getByRole('button', {
                name: /dialog.group.gallery.add_image/
            })
        ).toBeTruthy();
        expect(
            screen.queryByRole('button', { name: /dialog.group.gallery.edit/ })
        ).toBeNull();
        expect(
            screen.queryByRole('button', {
                name: /dialog.group.gallery.create/
            })
        ).toBeNull();
        const deleteButtons = screen.getAllByRole('button', {
            name: 'dialog.group.gallery.delete_image'
        });
        expect(deleteButtons).toHaveLength(1);

        fireEvent.click(deleteButtons[0]);
        await waitFor(() =>
            expect(handlers.onImagesChanged).toHaveBeenCalled()
        );
        expect(mocks.appVrchatGroupGalleryImageDelete).toHaveBeenCalledWith({
            groupId: 'grp_1',
            galleryId: 'ggal_events',
            imageId: 'ggim_mine'
        });
    });
});
