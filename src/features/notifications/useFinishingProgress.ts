import { useEffect, useState } from 'react';

export const PROGRESS_FINISH_MS = 600;

export function useFinishingProgress(done: number | null, total: number) {
    const isRunning = done !== null;
    const [wasRunning, setWasRunning] = useState(isRunning);
    const [isFinishing, setIsFinishing] = useState(false);
    if (wasRunning !== isRunning) {
        setWasRunning(isRunning);
        setIsFinishing(!isRunning);
    }
    useEffect(() => {
        if (!isFinishing) {
            return;
        }
        const timer = window.setTimeout(
            () => setIsFinishing(false),
            PROGRESS_FINISH_MS
        );
        return () => window.clearTimeout(timer);
    }, [isFinishing]);

    const percent = isFinishing
        ? 100
        : done !== null && total > 0
          ? (done / total) * 100
          : 0;
    return {
        isVisible: isRunning || isFinishing,
        isFinishing,
        percent
    };
}
