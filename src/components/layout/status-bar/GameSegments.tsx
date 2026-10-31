import { useTranslation } from 'react-i18next';

import { useRuntimeStore } from '@/state/runtimeStore';

import { DurationValue } from './StatusBarFooterParts';
import { formatDuration, formatStatusDate } from './statusBarFormat';
import { StatusSegment } from './StatusBarParts';
import type { StatusBarInstanceQueue } from './statusBarTypes';

function formatInstanceQueueValue(
    instanceQueue: StatusBarInstanceQueue,
    t: ReturnType<typeof useTranslation>['t']
) {
    const { position, queueSize } = instanceQueue;
    if (position > 0 && queueSize > 0) {
        return `${position}/${queueSize}`;
    }
    if (position > 0) {
        return t('status_bar.instance_queue_position', {
            position
        });
    }
    return t('status_bar.instance_queue_waiting');
}

export function VrchatSegment() {
    const { t } = useTranslation();
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
    );
    const lastGameStartedAt = useRuntimeStore(
        (state) => state.gameState.lastGameStartedAt
    );
    const currentLocationStartedAt = useRuntimeStore(
        (state) => state.gameState.currentLocationStartedAt
    );
    const currentWorldName = useRuntimeStore(
        (state) => state.gameState.currentWorldName
    );
    const currentWorldId = useRuntimeStore(
        (state) => state.gameState.currentWorldId
    );
    const lastGameLogAt = useRuntimeStore(
        (state) => state.gameState.lastGameLogAt
    );
    const lastGameLogType = useRuntimeStore(
        (state) => state.gameState.lastGameLogType
    );
    const gameStartedAt = Date.parse(lastGameStartedAt || '');
    const currentLocationStartedTimestamp = Date.parse(
        currentLocationStartedAt || ''
    );
    const currentWorld = currentWorldName || currentWorldId || '';

    return (
        <StatusSegment
            active={Boolean(isGameRunning)}
            dimWhenInactive
            label="VRChat"
            tooltip={
                <div className="flex flex-col gap-1 text-xs">
                    {isGameRunning ? (
                        <>
                            <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">
                                    {t('app_menu.label.started_at')}
                                </span>
                                <span>
                                    {formatStatusDate(lastGameStartedAt)}
                                </span>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">
                                    {t('app_menu.label.session_duration')}
                                </span>
                                <span>
                                    <DurationValue
                                        active={isGameRunning}
                                        formatter={formatDuration}
                                        startAtMs={gameStartedAt}
                                    />
                                </span>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">
                                    {t('app_menu.label.instance_duration')}
                                </span>
                                <span>
                                    <DurationValue
                                        active={isGameRunning}
                                        formatter={formatDuration}
                                        startAtMs={
                                            currentLocationStartedTimestamp
                                        }
                                    />
                                </span>
                            </div>
                            {currentWorld ? (
                                <div className="text-muted-foreground max-w-64 truncate">
                                    {currentWorld}
                                </div>
                            ) : null}
                        </>
                    ) : (
                        <>
                            <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">
                                    {t('app_menu.label.last_game_event')}
                                </span>
                                <span>{formatStatusDate(lastGameLogAt)}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">
                                    {t('app_menu.label.last_event_type')}
                                </span>
                                <span>{lastGameLogType || '-'}</span>
                            </div>
                        </>
                    )}
                </div>
            }
        />
    );
}

export function SteamVrSegment() {
    const isSteamVRRunning = useRuntimeStore(
        (state) => state.gameState.isSteamVRRunning
    );

    return (
        <StatusSegment
            active={Boolean(isSteamVRRunning)}
            dimWhenInactive
            label="SteamVR"
        />
    );
}

export function InstanceQueueSegment() {
    const { t } = useTranslation();
    const instanceQueue = useRuntimeStore((state) => state.instanceQueue);

    return (
        <StatusSegment
            visible={
                instanceQueue.active && Boolean(instanceQueue.instanceLocation)
            }
            active
            warn
            label={t('status_bar.instance_queue')}
            value={formatInstanceQueueValue(instanceQueue, t)}
            tooltip={
                <div className="flex flex-col gap-1 text-xs">
                    {instanceQueue.label ? (
                        <div className="text-muted-foreground max-w-64 truncate">
                            {instanceQueue.label}
                        </div>
                    ) : null}
                    <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">
                            {t('status_bar.instance_queue_position_label')}
                        </span>
                        <span>
                            {formatInstanceQueueValue(instanceQueue, t)}
                        </span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">
                            {t('app_menu.label.last_game_event')}
                        </span>
                        <span>{formatStatusDate(instanceQueue.updatedAt)}</span>
                    </div>
                </div>
            }
        />
    );
}
