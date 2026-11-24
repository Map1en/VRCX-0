import { commands } from '@/platform/tauri/bindings';
import { useVrOverlayTestStore } from '@/state/vrOverlayTestStore';

export async function setVrOverlayTestMode(testMode: boolean): Promise<void> {
    const store = useVrOverlayTestStore.getState();
    if (store.pending) {
        return;
    }
    store.setPending(true);
    try {
        const snapshot = await commands.appVrOverlayTestModeSet(testMode);
        store.setTestMode(snapshot.testMode);
    } catch (error) {
        console.warn('Failed to set VR overlay test mode:', error);
    } finally {
        store.setPending(false);
    }
}
