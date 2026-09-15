import { tauriEvents } from './events';
import { webview } from './webview';

type TauriEvents = typeof tauriEvents;
type TauriWebview = typeof webview;

export interface TauriClient {
    events: TauriEvents;
    webview: TauriWebview;
}

export const tauriClient: TauriClient = Object.freeze({
    events: tauriEvents,
    webview
});
