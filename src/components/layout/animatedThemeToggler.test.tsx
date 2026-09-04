// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnimatedThemeToggler } from '@/ui/shadcn/animated-theme-toggler';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from '@/ui/shadcn/tooltip';

describe('AnimatedThemeToggler', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            value: 1000
        });
        Object.defineProperty(window, 'innerHeight', {
            configurable: true,
            value: 800
        });
        vi.stubGlobal(
            'matchMedia',
            vi.fn(() => ({
                matches: false,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn()
            }))
        );
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.documentElement.classList.remove('dark');
        delete document.documentElement.dataset.magicuiThemeVt;
    });

    it('reveals the next theme from the button center with component defaults', async () => {
        const onThemeChange = vi.fn();
        let finishTransition: () => void = () => undefined;
        const finished = new Promise<void>((resolve) => {
            finishTransition = resolve;
        });
        const animate = vi.fn(() => ({
            cancel: vi.fn(),
            finished
        }));
        Object.defineProperty(document.documentElement, 'animate', {
            configurable: true,
            value: animate
        });
        document.startViewTransition = vi.fn((update) => {
            update();
            return {
                ready: Promise.resolve(),
                finished,
                updateCallbackDone: finished,
                skipTransition: vi.fn(),
                types: new Set<string>()
            };
        });

        render(
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <span>
                                <AnimatedThemeToggler
                                    theme="light"
                                    onThemeChange={onThemeChange}
                                    aria-label="toggle theme"
                                />
                            </span>
                        }
                    />
                    <TooltipContent>toggle theme</TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
        const button = screen.getByRole('button', { name: 'toggle theme' });
        vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(
            new DOMRect(880, 20, 40, 40)
        );

        fireEvent.click(button);

        expect(onThemeChange).toHaveBeenCalledWith('dark');
        expect(
            document.documentElement.style.getPropertyValue(
                '--magicui-theme-toggle-vt-duration'
            )
        ).toBe('400ms');
        await waitFor(() => expect(animate).toHaveBeenCalledOnce());
        expect(animate).toHaveBeenCalledWith(
            {
                clipPath: [
                    'circle(0% at 90% 5%)',
                    expect.stringContaining('at 90% 5%)')
                ]
            },
            {
                duration: 400,
                easing: 'ease-in-out',
                fill: 'forwards',
                pseudoElement: '::view-transition-new(root)'
            }
        );
        finishTransition();
        await waitFor(() => {
            expect(
                document.documentElement.style.getPropertyValue(
                    '--magicui-theme-toggle-vt-duration'
                )
            ).toBe('');
        });
    });
});
