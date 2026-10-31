// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSearchPagination } from './useSearchPagination';

type SearchRequest = {
    option?: string;
    params: {
        n: number;
        offset: number;
        [key: string]: unknown;
    };
};
type AvatarRequest = {
    offset: number;
    provider: string;
    query: string;
};
type TestProps = {
    activeTab: string;
    avatarPageSize: number;
    avatarRequest: AvatarRequest | null;
    avatarResults: Array<{ id: string }>;
    groupRequest: SearchRequest | null;
    groupResults: Array<{ id: string }>;
    isAvatarLoading: boolean;
    isGroupLoading: boolean;
    isUserLoading: boolean;
    isWorldLoading: boolean;
    runGroupSearch: ReturnType<typeof vi.fn<(request: SearchRequest) => void>>;
    runUserSearch: ReturnType<typeof vi.fn<(request: SearchRequest) => void>>;
    runWorldSearch: ReturnType<typeof vi.fn<(request: SearchRequest) => void>>;
    setAvatarRequest: ReturnType<
        typeof vi.fn<(request: AvatarRequest) => void>
    >;
    userRequest: SearchRequest | null;
    userResults: Array<{ id: string }>;
    worldRequest: SearchRequest | null;
    worldResults: Array<{ id: string }>;
};

function results(length: number) {
    return Array.from({ length }, (_, index) => ({ id: String(index) }));
}

function createProps(): TestProps {
    return {
        activeTab: 'user',
        avatarPageSize: 10,
        avatarRequest: null,
        avatarResults: results(0),
        groupRequest: null,
        groupResults: results(0),
        isAvatarLoading: false,
        isGroupLoading: false,
        isUserLoading: false,
        isWorldLoading: false,
        runGroupSearch: vi.fn<(request: SearchRequest) => void>(),
        runUserSearch: vi.fn<(request: SearchRequest) => void>(),
        runWorldSearch: vi.fn<(request: SearchRequest) => void>(),
        setAvatarRequest: vi.fn<(request: AvatarRequest) => void>(),
        userRequest: null,
        userResults: results(0),
        worldRequest: null,
        worldResults: results(0)
    };
}

describe('useSearchPagination', () => {
    it('pages user searches without mutating the active request', () => {
        const props = createProps();
        const request = {
            params: { n: 10, offset: 20, search: 'maple' }
        };
        props.userRequest = request;
        props.userResults = results(10);
        const { result } = renderHook(() => useSearchPagination(props));

        expect(result.current).toMatchObject({
            nextDisabled: false,
            prevDisabled: false,
            show: true
        });
        act(() => result.current.onPrev());
        act(() => result.current.onNext());

        expect(props.runUserSearch).toHaveBeenNthCalledWith(1, {
            params: { n: 10, offset: 10, search: 'maple' }
        });
        expect(props.runUserSearch).toHaveBeenNthCalledWith(2, {
            params: { n: 10, offset: 30, search: 'maple' }
        });
        expect(request.params.offset).toBe(20);
    });

    it('uses request page sizes for world and group searches', () => {
        const props = createProps();
        props.activeTab = 'world';
        props.worldRequest = {
            option: 'active',
            params: { n: 25, offset: 25 }
        };
        props.worldResults = results(24);
        const { result, rerender } = renderHook(
            (currentProps) => useSearchPagination(currentProps),
            { initialProps: props }
        );

        expect(result.current.nextDisabled).toBe(true);
        act(() => result.current.onPrev());
        expect(props.runWorldSearch).toHaveBeenCalledWith({
            option: 'active',
            params: { n: 25, offset: 0 }
        });

        const groupProps = {
            ...props,
            activeTab: 'group',
            groupRequest: { params: { n: 25, offset: 5, query: 'vr' } },
            groupResults: results(25)
        };
        rerender(groupProps);
        expect(result.current.nextDisabled).toBe(false);
        act(() => result.current.onPrev());
        expect(props.runGroupSearch).toHaveBeenCalledWith({
            params: { n: 25, offset: 0, query: 'vr' }
        });
    });

    it('pages the already-fetched avatar result set locally', () => {
        const props = createProps();
        props.activeTab = 'avatar';
        props.avatarPageSize = 20;
        props.avatarRequest = {
            offset: 20,
            provider: 'provider-a',
            query: 'avatar'
        };
        props.avatarResults = results(41);
        const { result } = renderHook(() => useSearchPagination(props));

        expect(result.current).toMatchObject({
            nextDisabled: false,
            prevDisabled: false,
            show: true
        });
        act(() => result.current.onPrev());
        act(() => result.current.onNext());
        expect(props.setAvatarRequest).toHaveBeenNthCalledWith(1, {
            offset: 0,
            provider: 'provider-a',
            query: 'avatar'
        });
        expect(props.setAvatarRequest).toHaveBeenNthCalledWith(2, {
            offset: 40,
            provider: 'provider-a',
            query: 'avatar'
        });
    });

    it('hides pagination while loading and no-ops without a request', () => {
        const props = createProps();
        props.isUserLoading = true;
        props.userResults = results(10);
        const { result } = renderHook(() => useSearchPagination(props));

        expect(result.current.show).toBe(false);
        act(() => result.current.onPrev());
        act(() => result.current.onNext());
        expect(props.runUserSearch).not.toHaveBeenCalled();
    });

    it('returns disabled no-op pagination for an unknown tab', () => {
        const props = createProps();
        props.activeTab = 'unsupported';
        const { result } = renderHook(() => useSearchPagination(props));

        expect(result.current).toMatchObject({
            nextDisabled: true,
            prevDisabled: true,
            show: false
        });
        act(() => result.current.onPrev());
        act(() => result.current.onNext());
        expect(props.runUserSearch).not.toHaveBeenCalled();
        expect(props.runWorldSearch).not.toHaveBeenCalled();
        expect(props.runGroupSearch).not.toHaveBeenCalled();
        expect(props.setAvatarRequest).not.toHaveBeenCalled();
    });
});
