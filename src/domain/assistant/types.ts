export type AssistantDeltaEvent = {
    ownerUserId: string;
    sessionId: string;
    turnId: string;
    text: string;
    replace: boolean;
};

export type AssistantDoneEvent = {
    ownerUserId: string;
    sessionId: string;
    turnId: string;
};

export type AssistantErrorEvent = {
    ownerUserId: string;
    sessionId: string;
    turnId: string;
    code: string;
    message: string;
};

export type AssistantChart = {
    kind:
        | 'myPlaytime'
        | 'bestTimes'
        | 'friendPattern'
        | 'topCompanions'
        | 'topWorlds'
        | 'sharedWorlds';
    axis: 'hourOfDay' | 'dayOfWeek' | 'label';
    subject?: string | null;
    points: { key: string; value: number }[];
};

export type AssistantScreenshots = {
    total: number;
    ids: string[];
    filter: {
        people?: string[];
        peopleMatch?: 'all' | 'any';
        worldIds?: string[];
        fromMs?: number | null;
        toMs?: number | null;
        text?: string;
    };
};

export type Entity = {
    kind: string;
    id: string;
    displayName: string;
};

export type MentionTarget = {
    kind: 'user' | 'world';
    id: string;
    name: string;
};

export type AssistantDraft = {
    topic: 'profile' | 'screenshots';
    target: MentionTarget | null;
};

export type AssistantToolCallEvent = {
    ownerUserId: string;
    sessionId: string;
    turnId: string;
    toolCallId: string;
    name: string;
    args: string;
};

export type AssistantToolResultEvent = {
    ownerUserId: string;
    sessionId: string;
    turnId: string;
    toolCallId: string;
    ok: boolean;
    summary: string;
    entities: Entity[];
    charts: AssistantChart[];
    screenshots?: AssistantScreenshots | null;
};

export type AssistantChoiceCandidate = {
    userId: string;
    displayName: string;
    isFriend: boolean;
    encounterCount: number;
    lastSeen: string;
};

export type AssistantChoiceRequestEvent = {
    ownerUserId: string;
    sessionId: string;
    turnId: string;
    toolCallId: string;
    choiceId: string;
    query: string;
    candidates: AssistantChoiceCandidate[];
};

export type AssistantTurnEntitiesEvent = {
    ownerUserId: string;
    sessionId: string;
    turnId: string;
    entities: Entity[];
};

export type SessionSummary = {
    id: string;
    title: string;
    pinned: boolean;
    busy: boolean;
    updatedAt: string;
};

export type ToolCallStatus = 'pending' | 'done' | 'error';

export interface UIToolCall {
    id: string;
    name: string;
    args: string;
    status: ToolCallStatus;
    summary: string;
    entities: Entity[];
    charts: AssistantChart[];
    screenshots?: AssistantScreenshots | null;
}

export type UserChoiceStatus = 'pending' | 'picked' | 'skipped';

export interface UIUserChoice {
    id: string;
    sessionId: string;
    query: string;
    candidates: AssistantChoiceCandidate[];
    status: UserChoiceStatus;
    pickedUserId?: string;
}

export interface UIMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    turnId?: string;
    streaming: boolean;
    toolCalls: UIToolCall[];
    choices?: UIUserChoice[];
    error?: string;
}
