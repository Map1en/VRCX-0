export type DimBlinkOptions = {
    opacity: number;
    halfCycles: number;
    halfCycleMs: number;
    direction?: PlaybackDirection;
};

export function dimBlink(
    element: Element,
    {
        opacity,
        halfCycles,
        halfCycleMs,
        direction = 'alternate'
    }: DimBlinkOptions
): Animation {
    return element.animate([{ opacity: 1 }, { opacity }], {
        duration: halfCycleMs,
        iterations: halfCycles,
        direction,
        easing: 'ease-in-out'
    });
}
