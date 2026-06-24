import { commands } from '@/platform/tauri/bindings';
import { i18n } from '@/services/i18nService';
import { useAssistantChatStore } from '@/state/assistantChatStore';

export async function refreshSessions(): Promise<void> {
    const sessions = await commands.appAssistantListSessions();
    useAssistantChatStore.getState().setSessions(sessions);
}

export async function openSession(sessionId: string): Promise<void> {
    const store = useAssistantChatStore.getState();
    store.setActiveSession(sessionId);
    // A session already loaded this run is kept current by the live event
    // stream. Re-fetching would overwrite it with the DB snapshot, which lacks
    // the still-streaming (not-yet-persisted) assistant message — wiping text
    // already shown. Only hydrate on first open (incl. after a restart).
    if (store.messagesBySession[sessionId]) {
        return;
    }
    const session = await commands.appAssistantGetSession(sessionId);
    if (session) {
        store.hydrateSession(session);
        store.markBusy(sessionId, session.activeTurn?.status === 'running');
    }
}

export async function startNewSession(): Promise<void> {
    const session = await commands.appAssistantNewSession();
    const store = useAssistantChatStore.getState();
    store.setActiveSession(session.id);
    store.hydrateSession(session);
    await refreshSessions();
}

export async function deleteSession(sessionId: string): Promise<void> {
    await commands.appAssistantDeleteSession(sessionId);
    const store = useAssistantChatStore.getState();
    if (store.activeSessionId === sessionId) {
        store.setActiveSession(null);
    }
    await refreshSessions();
}

export async function sendMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
        return;
    }
    const store = useAssistantChatStore.getState();
    const sessionId = store.activeSessionId;
    if (sessionId) {
        // Record the prompt before the backend can stream so deltas/errors never
        // render ahead of the user's message.
        store.appendUserMessage(sessionId, trimmed);
        store.markBusy(sessionId, true);
    }
    let result;
    try {
        result = await commands.appAssistantSendMessage(
            sessionId,
            trimmed,
            i18n.language || null
        );
    } catch (error) {
        if (sessionId) {
            store.markBusy(sessionId, false);
        }
        throw error;
    }
    if (result.sessionId !== sessionId) {
        store.appendUserMessage(result.sessionId, trimmed);
        store.markBusy(result.sessionId, true);
    }
    if (store.activeSessionId !== result.sessionId) {
        store.setActiveSession(result.sessionId);
    }
    await refreshSessions();
}

export async function cancelActiveTurn(): Promise<void> {
    const sessionId = useAssistantChatStore.getState().activeSessionId;
    if (sessionId) {
        await commands.appAssistantCancel(sessionId);
    }
}

export function setEntityPanelOpen(open: boolean): void {
    const store = useAssistantChatStore.getState();
    const sessionId = store.activeSessionId;
    store.setEntityPanelOpen(open);
    if (sessionId) {
        // Persist so the panel state survives an app restart.
        void commands
            .appAssistantSetPanelOpen(sessionId, open)
            .catch((error) => {
                console.warn(
                    '[assistant] failed to persist panel state',
                    error
                );
            });
    }
}
