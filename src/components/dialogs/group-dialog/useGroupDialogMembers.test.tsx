// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GroupMemberRow } from '@/domain/entities/group';

const mocks = vi.hoisted(() => ({
    getGroupMembers: vi.fn(),
    getGroupMembersSearch: vi.fn(),
    getAllGroupMembers: vi.fn()
}));

vi.mock('@/repositories/groupProfileRepository', () => ({
    default: {
        getGroupMembers: mocks.getGroupMembers,
        getGroupMembersSearch: mocks.getGroupMembersSearch,
        getAllGroupMembers: mocks.getAllGroupMembers
    }
}));

import { useGroupDialogMembers } from './useGroupDialogMembers';

function member(index: number): GroupMemberRow {
    return {
        id: `gmem_${index}`,
        userId: `usr_${index}`,
        groupId: 'grp_1',
        joinedAt: '2026-01-01T00:00:00.000Z'
    } as GroupMemberRow;
}

function page(from: number, count: number) {
    return Array.from({ length: count }, (_, offset) => member(from + offset));
}

describe('useGroupDialogMembers', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        mocks.getGroupMembers.mockReset();
        mocks.getGroupMembersSearch.mockReset();
        mocks.getAllGroupMembers.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('loads the first page on activation and appends the next page on load more', async () => {
        mocks.getGroupMembers
            .mockResolvedValueOnce(page(0, 100))
            .mockResolvedValueOnce(page(100, 3));

        const { result } = renderHook(() =>
            useGroupDialogMembers({
                endpoint: 'api',
                groupId: 'grp_1',
                active: true,
                totalCount: 103,
                staffRoleIds: [],
                seedRows: []
            })
        );

        await waitFor(() => expect(result.current.model.status).toBe('ready'));
        expect(result.current.model.loadedCount).toBe(100);
        expect(result.current.model.hasMore).toBe(true);
        expect(mocks.getGroupMembers).toHaveBeenLastCalledWith(
            expect.objectContaining({ offset: 0 })
        );

        await act(async () => {
            await result.current.loadMore();
        });

        expect(mocks.getGroupMembers).toHaveBeenLastCalledWith(
            expect.objectContaining({ offset: 100 })
        );
        expect(result.current.model.loadedCount).toBe(103);
        expect(result.current.model.hasMore).toBe(false);
    });

    it('searches on the server after a debounce and shows results instead of the paged list', async () => {
        mocks.getGroupMembers.mockResolvedValue(page(0, 100));
        mocks.getGroupMembersSearch.mockResolvedValue([member(4242)]);

        const { result } = renderHook(() =>
            useGroupDialogMembers({
                endpoint: 'api',
                groupId: 'grp_1',
                active: true,
                totalCount: 5000,
                staffRoleIds: [],
                seedRows: []
            })
        );
        await waitFor(() => expect(result.current.model.status).toBe('ready'));

        act(() => {
            result.current.setQuery('Map1en');
        });
        expect(mocks.getGroupMembersSearch).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });

        expect(mocks.getGroupMembersSearch).toHaveBeenCalledWith(
            expect.objectContaining({ groupId: 'grp_1', query: 'Map1en' })
        );
        expect(result.current.model.isSearching).toBe(true);
        expect(result.current.model.rows.map((row) => row.userId)).toEqual([
            'usr_4242'
        ]);
        expect(result.current.model.hasMore).toBe(false);

        act(() => {
            result.current.setQuery('');
        });
        expect(result.current.model.isSearching).toBe(false);
        expect(result.current.model.rows).toHaveLength(100);
    });

    it('loads staff by management role alongside the first page and dedupes across roles', async () => {
        mocks.getGroupMembers.mockImplementation(
            async ({ roleId, offset }: { roleId?: string; offset: number }) => {
                if (roleId === 'grol_owner') {
                    return [member(1)];
                }
                if (roleId === 'grol_mod') {
                    return [member(1), member(2)];
                }
                return offset === 0 ? page(0, 3) : [];
            }
        );

        const { result } = renderHook(() =>
            useGroupDialogMembers({
                endpoint: 'api',
                groupId: 'grp_1',
                active: true,
                totalCount: 3,
                staffRoleIds: ['grol_owner', 'grol_mod'],
                seedRows: []
            })
        );

        await waitFor(() => expect(result.current.model.status).toBe('ready'));
        await waitFor(() =>
            expect(
                result.current.model.staffRows.map((row) => row.userId)
            ).toEqual(['usr_1', 'usr_2'])
        );
        expect(result.current.model.loadedCount).toBe(3);
        expect(result.current.model.hasMore).toBe(false);
    });
});
