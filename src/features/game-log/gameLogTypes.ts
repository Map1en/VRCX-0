import type { PaginationState } from '@tanstack/react-table';
import type { Dispatch, SetStateAction } from 'react';

import type { AppColumnDef } from '@/components/data-table/appTable';
import type { LoadStatus } from '@/domain/shared/types';
import type {
    GameLogSessionDto as GeneratedGameLogSession,
    GameLogSessionEventDto as GeneratedGameLogSessionEvent,
    GameLogSessionMemberDto as GeneratedGameLogSessionMember
} from '@/platform/tauri/bindings';
import type {
    GameLogDatabaseRow,
    GameLogFilterType as RepositoryGameLogFilterType,
    GameLogPreviousInstanceWorldRow
} from '@/repositories/gameLogRepository';

export const GAME_LOG_SESSION_FILTER_TYPES = [
    'OnPlayerJoined',
    'OnPlayerLeft',
    'VideoPlay'
] as const;

export const GAME_LOG_LIVE_REFRESH_THROTTLE_MS = 1000;

export type GameLogViewMode = 'sessions' | 'table';

export type GameLogLoadStatus = LoadStatus;

export type GameLogRow = GameLogDatabaseRow & {
    isFavorite?: boolean | null;
    isFriend?: boolean;
};

export type GameLogRowView = Partial<GameLogRow>;

export type GameLogSessionMember = GeneratedGameLogSessionMember & {
    isFriend?: boolean;
};

export type GameLogSessionEvent = GeneratedGameLogSessionEvent;

export type GameLogSession = GeneratedGameLogSession;

export type GameLogDetailValue = {
    primary?: string;
    secondary?: string;
};

export type GameLogPreviousInstanceRow = GameLogPreviousInstanceWorldRow;

export type GameLogColumns = AppColumnDef<GameLogRow>[];

export type GameLogPaginationSetter = Dispatch<SetStateAction<PaginationState>>;

export type GameLogFilterType = RepositoryGameLogFilterType;

export type { PaginationState };
