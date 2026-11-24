import { useEffect, useState } from 'react';

const PALETTE_VARS = [
    'act-track',
    'act-edge',
    'act-mark',
    'act-mark-soft',
    'act-axis',
    'act-heat-min',
    'act-heat-0',
    'act-heat-1',
    'act-heat-2',
    'act-heat-3',
    'act-heat-4',
    'act-heat-empty'
] as const;

export type ActivityPalette = Record<(typeof PALETTE_VARS)[number], string>;

export function useActivityPalette(
    element: HTMLElement | null,
    isDarkMode: boolean
): ActivityPalette | null {
    const [palette, setPalette] = useState<ActivityPalette | null>(null);

    useEffect(() => {
        if (!element) {
            return;
        }
        const probe = document.createElement('span');
        probe.style.display = 'none';
        element.append(probe);
        const next = {} as ActivityPalette;
        for (const name of PALETTE_VARS) {
            probe.style.color = `var(--${name})`;
            next[name] = window.getComputedStyle(probe).color;
        }
        probe.remove();
        setPalette(next);
    }, [element, isDarkMode]);

    return palette;
}

export function heatmapScaleColors(palette: ActivityPalette): string[] {
    return [
        palette['act-heat-0'],
        palette['act-heat-1'],
        palette['act-heat-2'],
        palette['act-heat-3'],
        palette['act-heat-4']
    ];
}
