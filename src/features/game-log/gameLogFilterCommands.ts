import type { TFunction } from 'i18next';
import { createContext, useContext } from 'react';

import type {
    LogFilterCommands,
    LogFilterTarget
} from '@/components/data-table/LogFilterContextMenu';

import { normalizeGameLogId, resolveGameLogWorldId } from './gameLogRows';
import type { GameLogRow } from './gameLogTypes';

export const GameLogFilterCommandsContext =
    createContext<LogFilterCommands | null>(null);

export function useGameLogFilterCommands() {
    return useContext(GameLogFilterCommandsContext);
}

export function resolveGameLogFilterType(type: string) {
    if (type === 'JoinGroup') {
        return 'OnPlayerJoined';
    }
    if (type === 'LeftGroup') {
        return 'OnPlayerLeft';
    }
    return type;
}

export function getGameLogFilterTypeLabel(type: string, t: TFunction) {
    return t(`view.game_log.filters.${resolveGameLogFilterType(type)}`);
}

export function getGameLogRowFilterTarget(
    row: GameLogRow,
    t: TFunction
): LogFilterTarget {
    const type = String(row.type || '');
    const hasWorld = type === 'Location' || type === 'PortalSpawn';
    return {
        userId: normalizeGameLogId(row.userId),
        userName: String(row.displayName || ''),
        type,
        typeLabel: type ? getGameLogFilterTypeLabel(type, t) : '',
        worldId: hasWorld ? resolveGameLogWorldId(row) : '',
        worldName: hasWorld ? String(row.worldName || '') : ''
    };
}
