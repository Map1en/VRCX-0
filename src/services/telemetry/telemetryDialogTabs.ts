import {
    TELEMETRY_DIALOG_TAB_KEYS,
    type TelemetryDialogKey
} from './telemetryContract';
import { recordTelemetryEvent } from './telemetryEvent';

const seenTabsByDialog = new Map<TelemetryDialogKey, Set<string>>();

function recordDialogTabView(
    dialog: TelemetryDialogKey,
    tab: string,
    landing: boolean
) {
    if (
        (TELEMETRY_DIALOG_TAB_KEYS[dialog] as readonly string[]).includes(tab)
    ) {
        recordTelemetryEvent({ type: 'dialogTabView', dialog, tab, landing });
    }
}

export function recordDialogTabLanding(
    dialog: TelemetryDialogKey,
    tab: string
): void {
    seenTabsByDialog.set(dialog, new Set([tab]));
    recordDialogTabView(dialog, tab, true);
}

export function recordDialogTabSwitch(
    dialog: TelemetryDialogKey,
    tab: string
): void {
    const seenTabs = seenTabsByDialog.get(dialog);
    if (!seenTabs || seenTabs.has(tab)) {
        return;
    }
    seenTabs.add(tab);
    recordDialogTabView(dialog, tab, false);
}
