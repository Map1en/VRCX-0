import { commands, type Session } from '@/platform/tauri/bindings';
import i18n from '@/services/i18nService';
import { useAssistantChatStore } from '@/state/assistantChatStore';

export async function refreshSessions(): Promise<void> {
    const authScopeVersion = useAssistantChatStore.getState().authScopeVersion;
    const sessions = await commands.appAssistantListSessions();
    const current = useAssistantChatStore.getState();
    if (current.authScopeVersion === authScopeVersion) {
        current.setSessions(sessions);
    }
}

export async function openSession(sessionId: string): Promise<void> {
    const store = useAssistantChatStore.getState();
    const authScopeVersion = store.authScopeVersion;
    const previousSessionId = store.activeSessionId;
    store.setActiveSession(sessionId);
    if (previousSessionId && previousSessionId !== sessionId) {
        store.evictSessionData(previousSessionId);
    }
    // A session already loaded this run is kept current by the live event
    // stream. Re-fetching would overwrite it with the DB snapshot, which lacks
    // the still-streaming (not-yet-persisted) assistant message — wiping text
    // already shown. Only hydrate on first open (incl. after a restart).
    if (store.messagesBySession[sessionId]) {
        return;
    }
    const session = await commands.appAssistantGetSession(sessionId);
    const current = useAssistantChatStore.getState();
    if (
        session &&
        current.authScopeVersion === authScopeVersion &&
        current.open &&
        current.activeSessionId === sessionId &&
        !current.messagesBySession[sessionId]
    ) {
        current.hydrateSession(session);
        current.markBusy(sessionId, session.activeTurn?.status === 'running');
    }
}

export async function startNewSession(): Promise<Session> {
    const authScopeVersion = useAssistantChatStore.getState().authScopeVersion;
    const session = await commands.appAssistantNewSession();
    const store = useAssistantChatStore.getState();
    if (store.authScopeVersion !== authScopeVersion) {
        return session;
    }
    const previousSessionId = store.activeSessionId;
    store.setActiveSession(session.id);
    if (previousSessionId && previousSessionId !== session.id) {
        store.evictSessionData(previousSessionId);
    }
    store.hydrateSession(session);
    await refreshSessions();
    return session;
}

export async function deleteSession(sessionId: string): Promise<void> {
    const authScopeVersion = useAssistantChatStore.getState().authScopeVersion;
    await commands.appAssistantDeleteSession(sessionId);
    const store = useAssistantChatStore.getState();
    if (store.authScopeVersion !== authScopeVersion) {
        return;
    }
    store.removeSession(sessionId);
    await refreshSessions();
}

export async function sendMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
        return;
    }
    const store = useAssistantChatStore.getState();
    const authScopeVersion = store.authScopeVersion;
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
        const current = useAssistantChatStore.getState();
        if (sessionId && current.authScopeVersion === authScopeVersion) {
            current.dropTrailingUserMessage(sessionId);
            current.markBusy(sessionId, false);
        }
        throw error;
    }
    const current = useAssistantChatStore.getState();
    if (current.authScopeVersion !== authScopeVersion) {
        return;
    }
    if (result.sessionId !== sessionId) {
        current.appendUserMessage(result.sessionId, trimmed);
        current.markBusy(result.sessionId, true);
    }
    if (current.activeSessionId !== result.sessionId) {
        current.setActiveSession(result.sessionId);
    }
    await refreshSessions();
}

export async function cancelActiveTurn(): Promise<void> {
    const sessionId = useAssistantChatStore.getState().activeSessionId;
    if (sessionId) {
        await commands.appAssistantCancel(sessionId);
    }
}

export async function answerChoice(
    sessionId: string,
    choiceId: string,
    userId: string | null
): Promise<void> {
    useAssistantChatStore.getState().resolveChoice(sessionId, choiceId, userId);
    await commands.appAssistantAnswerChoice(sessionId, choiceId, userId);
}

export function setEntityPanelOpen(open: boolean): void {
    const store = useAssistantChatStore.getState();
    const sessionId = store.activeSessionId;
    store.setEntityPanelOpen(open);
    if (sessionId) {
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
