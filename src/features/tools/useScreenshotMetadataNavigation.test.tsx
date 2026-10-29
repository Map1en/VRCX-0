// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useScreenshotMetadataNavigation } from './useScreenshotMetadataNavigation';

function createProps() {
    return {
        enabled: true,
        loadScreenshot: vi.fn<
            (path: string, withCarousel: boolean) => Promise<void>
        >(async () => {}),
        metadata: {
            nextFilePath: 'metadata-next.png',
            nextFolderPath: 'next-folder',
            previousFilePath: 'metadata-prev.png',
            previousFolderPath: 'previous-folder'
        },
        browseNavigationPaths: [] as string[],
        crossFolderAtEdges: true,
        onPathChange: undefined as
            | ((path: string, folderPath?: string) => void)
            | undefined,
        reverseMetadataOrder: false,
        searchNavigationPaths: [] as string[],
        selectedPath: '',
        setSelectedPath: vi.fn<(path: string) => void>()
    };
}

describe('useScreenshotMetadataNavigation', () => {
    it('wraps within search results and routes without loading twice', async () => {
        const props = createProps();
        props.searchNavigationPaths = ['a.png', 'b.png', 'c.png'];
        props.selectedPath = 'a.png';
        props.onPathChange = vi.fn();
        const { result, rerender } = renderHook(
            (currentProps) => useScreenshotMetadataNavigation(currentProps),
            { initialProps: props }
        );

        await act(() => result.current.navigatePrev());
        expect(props.setSelectedPath).toHaveBeenCalledWith('c.png');
        expect(props.onPathChange).toHaveBeenCalledWith('c.png');
        expect(props.loadScreenshot).not.toHaveBeenCalled();

        const lastProps = { ...props, selectedPath: 'c.png' };
        rerender(lastProps);
        await act(() => result.current.navigateNext());
        expect(props.setSelectedPath).toHaveBeenLastCalledWith('a.png');
        expect(props.onPathChange).toHaveBeenLastCalledWith('a.png');
    });

    it('falls back to metadata carousel paths outside search context', async () => {
        const props = createProps();
        const { result } = renderHook(() =>
            useScreenshotMetadataNavigation(props)
        );

        await act(() => result.current.navigatePrev());
        await act(() => result.current.navigateNext());

        expect(props.loadScreenshot).toHaveBeenNthCalledWith(
            1,
            'metadata-prev.png',
            true
        );
        expect(props.loadScreenshot).toHaveBeenNthCalledWith(
            2,
            'metadata-next.png',
            true
        );
    });

    it('routes across folders using global metadata neighbors', async () => {
        const props = createProps();
        props.onPathChange = vi.fn();
        const { result } = renderHook(() =>
            useScreenshotMetadataNavigation(props)
        );

        expect(result.current.canNavigatePrev).toBe(true);
        expect(result.current.canNavigateNext).toBe(true);
        await act(() => result.current.navigatePrev());
        await act(() => result.current.navigateNext());

        expect(props.onPathChange).toHaveBeenNthCalledWith(
            1,
            'metadata-prev.png',
            'previous-folder'
        );
        expect(props.onPathChange).toHaveBeenNthCalledWith(
            2,
            'metadata-next.png',
            'next-folder'
        );
    });

    it('disables navigation at the global first and last screenshots', async () => {
        const props = createProps();
        props.metadata.previousFilePath = '';
        props.metadata.previousFolderPath = '';
        props.onPathChange = vi.fn();
        const { result, rerender } = renderHook(
            (currentProps) => useScreenshotMetadataNavigation(currentProps),
            { initialProps: props }
        );

        expect(result.current.canNavigatePrev).toBe(false);
        expect(result.current.canNavigateNext).toBe(true);
        await act(() => result.current.navigatePrev());
        expect(props.onPathChange).not.toHaveBeenCalled();

        rerender({
            ...props,
            metadata: {
                nextFilePath: '',
                nextFolderPath: '',
                previousFilePath: 'metadata-prev.png',
                previousFolderPath: 'previous-folder'
            }
        });
        expect(result.current.canNavigatePrev).toBe(true);
        expect(result.current.canNavigateNext).toBe(false);
        await act(() => result.current.navigateNext());

        expect(props.onPathChange).not.toHaveBeenCalled();
    });

    it('falls back to metadata when the selected search path is stale', async () => {
        const props = createProps();
        props.searchNavigationPaths = ['a.png', 'b.png'];
        props.selectedPath = 'missing.png';
        const { result } = renderHook(() =>
            useScreenshotMetadataNavigation(props)
        );

        await act(() => result.current.navigateNext());

        expect(props.setSelectedPath).not.toHaveBeenCalled();
        expect(props.loadScreenshot).toHaveBeenCalledWith(
            'metadata-next.png',
            true
        );
    });

    it('uses the latest load callback without rebuilding navigation callbacks', async () => {
        const props = createProps();
        const firstLoad = props.loadScreenshot;
        const nextLoad = vi.fn(async () => {});
        const { result, rerender } = renderHook(
            (currentProps) => useScreenshotMetadataNavigation(currentProps),
            { initialProps: props }
        );
        const firstNavigateNext = result.current.navigateNext;

        rerender({ ...props, loadScreenshot: nextLoad });
        expect(result.current.navigateNext).toBe(firstNavigateNext);
        await act(() => result.current.navigateNext());

        expect(firstLoad).not.toHaveBeenCalled();
        expect(nextLoad).toHaveBeenCalledWith('metadata-next.png', true);
    });

    it('handles unmodified Arrow shortcuts and removes listeners on unmount', () => {
        const props = createProps();
        props.onPathChange = vi.fn();
        const { unmount } = renderHook(() =>
            useScreenshotMetadataNavigation(props)
        );
        const left = new KeyboardEvent('keydown', {
            cancelable: true,
            key: 'ArrowLeft'
        });
        const right = new KeyboardEvent('keydown', {
            cancelable: true,
            key: 'ArrowRight'
        });

        act(() => {
            window.dispatchEvent(left);
            window.dispatchEvent(right);
        });
        expect(left.defaultPrevented).toBe(true);
        expect(right.defaultPrevented).toBe(true);
        expect(props.onPathChange).toHaveBeenNthCalledWith(
            1,
            'metadata-prev.png',
            'previous-folder'
        );
        expect(props.onPathChange).toHaveBeenNthCalledWith(
            2,
            'metadata-next.png',
            'next-folder'
        );

        unmount();
        window.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'ArrowRight'
            })
        );
        expect(props.onPathChange).toHaveBeenCalledTimes(2);
    });

    it('ignores shortcuts while disabled, modified, or editing text', () => {
        const props = createProps();
        props.onPathChange = vi.fn();
        const { rerender } = renderHook(
            (currentProps) => useScreenshotMetadataNavigation(currentProps),
            { initialProps: props }
        );

        act(() => {
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    altKey: true,
                    key: 'ArrowRight'
                })
            );
            const input = document.createElement('input');
            document.body.append(input);
            input.dispatchEvent(
                new KeyboardEvent('keydown', {
                    bubbles: true,
                    key: 'ArrowRight'
                })
            );
            input.remove();
        });

        rerender({ ...props, enabled: false });
        act(() => {
            window.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'ArrowRight' })
            );
        });

        expect(props.onPathChange).not.toHaveBeenCalled();
    });

    it('ignores Arrow keys during IME input or on keyboard controls', () => {
        const props = createProps();
        props.onPathChange = vi.fn();
        const { unmount } = renderHook(() =>
            useScreenshotMetadataNavigation(props)
        );
        const combobox = document.createElement('div');
        combobox.setAttribute('role', 'combobox');
        document.body.append(combobox);

        act(() => {
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    isComposing: true,
                    key: 'ArrowRight'
                })
            );
            combobox.dispatchEvent(
                new KeyboardEvent('keydown', {
                    bubbles: true,
                    key: 'ArrowRight'
                })
            );
        });
        combobox.remove();
        unmount();

        expect(props.onPathChange).not.toHaveBeenCalled();
    });

    it('steps through the grid order before leaving the browse list', async () => {
        const props = createProps();
        props.browseNavigationPaths = ['a.png', 'b.png', 'c.png'];
        props.selectedPath = 'b.png';
        props.onPathChange = vi.fn();
        const { result } = renderHook(() =>
            useScreenshotMetadataNavigation(props)
        );

        expect(result.current.prevPath).toBe('a.png');
        expect(result.current.nextPath).toBe('c.png');
        await act(() => result.current.navigatePrev());
        await act(() => result.current.navigateNext());

        expect(props.setSelectedPath).toHaveBeenNthCalledWith(1, 'a.png');
        expect(props.onPathChange).toHaveBeenNthCalledWith(1, 'a.png');
        expect(props.onPathChange).toHaveBeenNthCalledWith(2, 'c.png');
    });

    it('crosses folders through metadata neighbors at the grid edges', async () => {
        const props = createProps();
        props.browseNavigationPaths = ['a.png', 'b.png'];
        props.selectedPath = 'b.png';
        props.onPathChange = vi.fn();
        const { result, rerender } = renderHook(
            (currentProps) => useScreenshotMetadataNavigation(currentProps),
            { initialProps: props }
        );

        await act(() => result.current.navigateNext());
        expect(props.onPathChange).toHaveBeenLastCalledWith(
            'metadata-next.png',
            'next-folder'
        );

        rerender({ ...props, selectedPath: 'a.png' });
        await act(() => result.current.navigatePrev());
        expect(props.onPathChange).toHaveBeenLastCalledWith(
            'metadata-prev.png',
            'previous-folder'
        );
        expect(props.setSelectedPath).not.toHaveBeenCalled();
    });

    it('maps grid direction onto reversed metadata order for newest-first grids', async () => {
        const props = createProps();
        props.browseNavigationPaths = ['new.png', 'old.png'];
        props.reverseMetadataOrder = true;
        props.selectedPath = 'old.png';
        props.onPathChange = vi.fn();
        const { result, rerender } = renderHook(
            (currentProps) => useScreenshotMetadataNavigation(currentProps),
            { initialProps: props }
        );

        expect(result.current.nextPath).toBe('metadata-prev.png');
        await act(() => result.current.navigateNext());
        expect(props.onPathChange).toHaveBeenLastCalledWith(
            'metadata-prev.png',
            'previous-folder'
        );

        rerender({ ...props, selectedPath: 'new.png' });
        expect(result.current.prevPath).toBe('metadata-next.png');
    });

    it('keeps favorites navigation inside the favorites list', async () => {
        const props = createProps();
        props.browseNavigationPaths = ['fav-a.png', 'fav-b.png'];
        props.crossFolderAtEdges = false;
        props.selectedPath = 'fav-a.png';
        props.onPathChange = vi.fn();
        const { result, rerender } = renderHook(
            (currentProps) => useScreenshotMetadataNavigation(currentProps),
            { initialProps: props }
        );

        expect(result.current.canNavigatePrev).toBe(false);
        expect(result.current.prevPath).toBe('');
        await act(() => result.current.navigatePrev());
        expect(props.onPathChange).not.toHaveBeenCalled();

        await act(() => result.current.navigateNext());
        expect(props.onPathChange).toHaveBeenLastCalledWith('fav-b.png');

        rerender({ ...props, selectedPath: 'fav-b.png' });
        expect(result.current.canNavigateNext).toBe(false);
        expect(result.current.nextPath).toBe('');
    });

    it('prefers search navigation over the browse list', async () => {
        const props = createProps();
        props.searchNavigationPaths = ['s1.png', 'b.png', 's2.png'];
        props.browseNavigationPaths = ['a.png', 'b.png', 'c.png'];
        props.selectedPath = 'b.png';
        const { result } = renderHook(() =>
            useScreenshotMetadataNavigation(props)
        );

        expect(result.current.prevPath).toBe('s1.png');
        expect(result.current.nextPath).toBe('s2.png');
    });

    it('ignores a cross-folder fallback that points back into the list', () => {
        const props = createProps();
        props.browseNavigationPaths = ['a.png', 'b.png'];
        props.selectedPath = 'b.png';
        props.metadata = {
            ...props.metadata,
            nextFilePath: 'a.png',
            nextFolderPath: ''
        };
        const { result } = renderHook(() =>
            useScreenshotMetadataNavigation(props)
        );

        expect(result.current.canNavigateNext).toBe(false);
        expect(result.current.canNavigatePrev).toBe(true);
    });

    it('stops inside favorites when the current image leaves the list', () => {
        const props = createProps();
        props.crossFolderAtEdges = false;
        props.browseNavigationPaths = ['a.png'];
        props.selectedPath = 'removed.png';
        const { result } = renderHook(() =>
            useScreenshotMetadataNavigation(props)
        );

        expect(result.current.canNavigatePrev).toBe(false);
        expect(result.current.canNavigateNext).toBe(false);
    });
});
