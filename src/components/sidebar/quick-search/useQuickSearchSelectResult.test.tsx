// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    QuickSearchEntityType,
    QuickSearchResult
} from '../quickSearchCatalog';

const mocks = vi.hoisted(() => ({
    openAvatarDialog: vi.fn(),
    openGroupDialog: vi.fn(),
    openUserDialog: vi.fn(),
    openWorldDialog: vi.fn()
}));

vi.mock('@/services/dialogService', () => mocks);

import { useQuickSearchSelectResult } from './useQuickSearchSelectResult';

describe('useQuickSearchSelectResult', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each([
        ['friend', mocks.openUserDialog, 'userId'],
        ['avatar', mocks.openAvatarDialog, 'avatarId'],
        ['world', mocks.openWorldDialog, 'worldId'],
        ['group', mocks.openGroupDialog, 'groupId']
    ] as const)(
        'closes and clears before opening the selected %s',
        (type, openDialog, idField) => {
            const onOpenChange = vi.fn();
            const setQuery = vi.fn();
            const item: QuickSearchResult = {
                id: `${type}_1`,
                type: type satisfies QuickSearchEntityType,
                source: 'test',
                name: `${type} name`,
                seedData: { id: `${type}_1` }
            };
            const { result } = renderHook(() =>
                useQuickSearchSelectResult({ onOpenChange, setQuery })
            );

            act(() => result.current(item));

            expect(onOpenChange).toHaveBeenCalledWith(false);
            expect(setQuery).toHaveBeenCalledWith('');
            expect(openDialog).toHaveBeenCalledWith({
                [idField]: item.id,
                title: item.name,
                seedData: item.seedData
            });
            expect(onOpenChange.mock.invocationCallOrder[0]).toBeLessThan(
                openDialog.mock.invocationCallOrder[0]
            );
            expect(setQuery.mock.invocationCallOrder[0]).toBeLessThan(
                openDialog.mock.invocationCallOrder[0]
            );
        }
    );
});
