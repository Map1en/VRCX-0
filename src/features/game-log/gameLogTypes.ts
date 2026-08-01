import type {
    ColumnDef,
    PaginationState,
    Table as ReactTable
} from '@tanstack/react-table';
import type { Dispatch, SetStateAction } from 'react';

import type {
    GameLogSessionDto as GeneratedGameLogSession,
    GameLogSessionEventDto as GeneratedGameLogSessionEvent,
    GameLogSessionMemberDto as GeneratedGameLogSessionMember
} from '@/platform/tauri/bindings';

export const GAME_LOG_SESSION_FILTER_TYPES = [
    'OnPlayerJoined',
    'OnPlayerLeft',
    'VideoPlay'
] as const;

export type GameLogViewMode = 'sessions' | 'table';

export type GameLogLoadStatus = 'idle' | 'running' | 'ready' | 'error';

export type GameLogRow = {
    id?: unknown;
    rowId?: unknown;
    type?: unknown;
    created_at?: unknown;
    createdAt?: unknown;
    displayName?: unknown;
    userId?: unknown;
    location?: unknown;
    instanceId?: unknown;
    worldId?: unknown;
    worldName?: unknown;
    groupName?: unknown;
    videoUrl?: unknown;
    data?: unknown;
    message?: unknown;
    resourceUrl?: unknown;
    isFavorite?: boolean | null;
    isFriend?: boolean;
    [key: string]: unknown;
};

export type GameLogSessionMember = GameLogRow &
    Partial<GeneratedGameLogSessionMember>;

export type GameLogSessionEvent = GameLogRow &
    Partial<Omit<GeneratedGameLogSessionEvent, 'members'>> & {
        members?: GameLogSessionMember[] | null;
    };

export type GameLogSession = GameLogRow &
    Partial<Omit<GeneratedGameLogSession, 'events' | 'id'>> & {
        events?: GameLogSessionEvent[];
    };

export type GameLogDetailValue = {
    primary?: unknown;
    secondary?: unknown;
};

export type GameLogPreviousInstanceRow = Record<string, unknown>;

export type GameLogColumns = ColumnDef<GameLogRow>[];

export type GameLogTableInstance = ReactTable<GameLogRow>;

export type GameLogPaginationSetter = Dispatch<SetStateAction<PaginationState>>;

export type GameLogFilterType = string;

export type { PaginationState };
