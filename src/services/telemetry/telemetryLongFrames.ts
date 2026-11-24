import { useDialogStore } from '@/state/dialogStore';

import { recordTelemetryEvent } from './telemetryEvent';
import { currentTelemetryRoute } from './telemetryPageReach';

const LONG_FRAME_MS = 200;
const TELEMETRY_DIALOGS = new Set(['user', 'world', 'group', 'avatar']);

export function recordLongFrames(durations: readonly number[]): void {
    const route = currentTelemetryRoute();
    if (!route || document.visibilityState !== 'visible') {
        return;
    }
    const kind = useDialogStore.getState().activeDialog?.kind;
    const dialog = kind && TELEMETRY_DIALOGS.has(kind) ? kind : null;
    for (const duration of durations) {
        if (duration >= LONG_FRAME_MS) {
            recordTelemetryEvent({
                type: 'longFrame',
                route,
                dialog,
                duration_ms: Math.round(duration)
            });
        }
    }
}

export function installLongFrameTelemetry(): void {
    if (
        !globalThis.PerformanceObserver?.supportedEntryTypes?.includes(
            'long-animation-frame'
        )
    ) {
        return;
    }
    new PerformanceObserver((list) => {
        recordLongFrames(list.getEntries().map((entry) => entry.duration));
    }).observe({ type: 'long-animation-frame' });
}
