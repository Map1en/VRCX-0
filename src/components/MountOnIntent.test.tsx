// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MountOnIntent } from './MountOnIntent';

function mountedRender(onMountedContextMenu = vi.fn()) {
    return (child: ReactElement<Record<string, unknown>>) =>
        cloneElement(child, {
            'data-mounted': '',
            onContextMenu: (event: MouseEvent) => {
                event.stopPropagation();
                onMountedContextMenu(event.clientX, event.clientY);
            }
        });
}

function mountedButton() {
    return screen.getByRole('button', { name: 'Target' });
}

describe('MountOnIntent', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('mounts on hover only after the pointer rests on the element', () => {
        render(
            <MountOnIntent trigger="hover" render={mountedRender()}>
                <button type="button">Target</button>
            </MountOnIntent>
        );

        fireEvent.pointerEnter(mountedButton(), { pointerType: 'mouse' });
        act(() => {
            vi.advanceTimersByTime(59);
        });
        expect(mountedButton().hasAttribute('data-mounted')).toBe(false);

        fireEvent.pointerMove(mountedButton(), { pointerType: 'mouse' });
        act(() => {
            vi.advanceTimersByTime(60);
        });
        expect(mountedButton().hasAttribute('data-mounted')).toBe(true);
    });

    it('keeps a click on the original element and waits for the pointer to leave', () => {
        const onClick = vi.fn();
        render(
            <MountOnIntent trigger="hover" render={mountedRender()}>
                <button type="button" onClick={onClick}>
                    Target
                </button>
            </MountOnIntent>
        );
        const button = mountedButton();

        fireEvent.pointerEnter(button, { pointerType: 'mouse' });
        fireEvent.pointerDown(button, { pointerType: 'mouse' });
        fireEvent.focus(button);
        fireEvent.pointerUp(button, { pointerType: 'mouse' });
        fireEvent.click(button);
        fireEvent.pointerMove(button, { pointerType: 'mouse' });
        act(() => {
            vi.advanceTimersByTime(500);
        });

        expect(onClick).toHaveBeenCalledTimes(1);
        expect(mountedButton()).toBe(button);
        expect(button.hasAttribute('data-mounted')).toBe(false);

        fireEvent.pointerLeave(button, { pointerType: 'mouse' });
        fireEvent.pointerEnter(button, { pointerType: 'mouse' });
        act(() => {
            vi.advanceTimersByTime(60);
        });
        expect(mountedButton().hasAttribute('data-mounted')).toBe(true);
    });

    it('ignores touch pointers for hover mounting', () => {
        render(
            <MountOnIntent trigger="hover" render={mountedRender()}>
                <button type="button">Target</button>
            </MountOnIntent>
        );

        fireEvent.pointerEnter(mountedButton(), { pointerType: 'touch' });
        act(() => {
            vi.advanceTimersByTime(500);
        });

        expect(mountedButton().hasAttribute('data-mounted')).toBe(false);
    });

    it('mounts on keyboard focus and keeps focus on the same element', () => {
        render(
            <MountOnIntent trigger="hover" render={mountedRender()}>
                <button type="button">Target</button>
            </MountOnIntent>
        );

        act(() => {
            mountedButton().focus();
        });

        expect(mountedButton().hasAttribute('data-mounted')).toBe(true);
        expect(document.activeElement).toBe(mountedButton());
    });

    it('restores focus to the same descendant when keyboard focus mounts it', () => {
        render(
            <MountOnIntent trigger="hover" render={mountedRender()}>
                <div>
                    <span>Label</span>
                    <button type="button">Target</button>
                </div>
            </MountOnIntent>
        );

        act(() => {
            mountedButton().focus();
        });

        expect(
            mountedButton().parentElement?.hasAttribute('data-mounted')
        ).toBe(true);
        expect(document.activeElement).toBe(mountedButton());
    });

    it('keeps focus on the element when a right click mounts the menu', () => {
        render(
            <MountOnIntent trigger="contextmenu" render={mountedRender()}>
                <button type="button">Target</button>
            </MountOnIntent>
        );
        act(() => {
            mountedButton().focus();
        });

        fireEvent.contextMenu(mountedButton(), { clientX: 5, clientY: 6 });

        expect(mountedButton().hasAttribute('data-mounted')).toBe(true);
        expect(document.activeElement).toBe(mountedButton());
    });

    it('forwards props through a nested context menu trigger', () => {
        const onMountedContextMenu = vi.fn();
        render(
            <MountOnIntent
                trigger="hover"
                render={(child: ReactElement<Record<string, unknown>>) =>
                    cloneElement(child, { title: 'hovered' })
                }
            >
                <MountOnIntent
                    trigger="contextmenu"
                    render={mountedRender(onMountedContextMenu)}
                >
                    <button type="button">Target</button>
                </MountOnIntent>
            </MountOnIntent>
        );

        fireEvent.pointerEnter(mountedButton(), { pointerType: 'mouse' });
        act(() => {
            vi.advanceTimersByTime(60);
        });
        expect(mountedButton().getAttribute('title')).toBe('hovered');

        fireEvent.contextMenu(mountedButton(), { clientX: 7, clientY: 8 });

        expect(mountedButton().getAttribute('title')).toBe('hovered');
        expect(mountedButton().hasAttribute('data-mounted')).toBe(true);
        expect(onMountedContextMenu).toHaveBeenCalledWith(7, 8);
    });

    it('mounts on right click and replays the context menu at the same point', () => {
        const onMountedContextMenu = vi.fn();
        const onOuterContextMenu = vi.fn();
        render(
            <div onContextMenu={onOuterContextMenu}>
                <MountOnIntent
                    trigger="contextmenu"
                    render={mountedRender(onMountedContextMenu)}
                >
                    <button type="button">Target</button>
                </MountOnIntent>
            </div>
        );

        fireEvent.contextMenu(mountedButton(), { clientX: 30, clientY: 40 });

        expect(mountedButton().hasAttribute('data-mounted')).toBe(true);
        expect(onMountedContextMenu).toHaveBeenCalledWith(30, 40);
        expect(onOuterContextMenu).not.toHaveBeenCalled();
    });
});
