export const groupQuickModerationLoadingDelayMs = 160;

export interface DelayedVisibleController {
    start: () => void;
    stop: () => void;
    dispose: () => void;
}

export function createDelayedVisibleController(
    setVisible: (visible: boolean) => void,
    delayMs = groupQuickModerationLoadingDelayMs
): DelayedVisibleController {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function clearTimer() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }

    return {
        start() {
            clearTimer();
            setVisible(false);
            timer = setTimeout(() => {
                timer = null;
                setVisible(true);
            }, delayMs);
        },
        stop() {
            clearTimer();
            setVisible(false);
        },
        dispose() {
            clearTimer();
        }
    };
}
