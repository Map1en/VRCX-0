import { useEffect, useState } from 'react';

export function useDelayedFlag(
    active: boolean,
    delayMs: number,
    resetKey = ''
): boolean {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        setVisible(false);
        if (!active) {
            return undefined;
        }

        const timer = setTimeout(() => {
            setVisible(true);
        }, delayMs);

        return () => {
            clearTimeout(timer);
        };
    }, [active, delayMs, resetKey]);

    return visible;
}
