import { TriangleAlertIcon, UnplugIcon } from 'lucide-react';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { tauriClient } from '@/platform/tauri/client';
import { setGameIsolationEnabled } from '@/services/gameIsolationService';
import { toast } from '@/services/toastService';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { Popover, PopoverContent, PopoverTitle } from '@/ui/shadcn/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { useGameIsolationCardStore } from './gameIsolationCardStore';
import {
    STATUS_BAR_TOGGLE_ACTIVE,
    STATUS_BAR_TOGGLE_IDLE
} from './statusBarToggle';
import { useGameIsolationAccountPrompt } from './useGameIsolationAccountPrompt';

const EFFECT_KEYS = [
    'game_isolation.effect_game_log',
    'game_isolation.effect_presence',
    'game_isolation.effect_vr',
    'game_isolation.effect_automation'
] as const;

export function GameIsolationToggle(): ReactElement | null {
    const { t } = useTranslation();
    const anchorRef = useRef<HTMLSpanElement>(null);
    const [updating, setUpdating] = useState(false);
    const available = useRuntimeStore(
        (state) => state.hostCapabilities.gameProcessMonitor.available
    );
    const enabled = useRuntimeStore((state) => state.gameIsolation.enabled);
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
    );
    const open = useGameIsolationCardStore((state) => state.open);
    const setOpen = useGameIsolationCardStore((state) => state.setOpen);

    useEffect(() => {
        let disposed = false;
        let unlisten: (() => void) | null = null;
        tauriClient.events
            .subscribe('gameIsolationConfirmRequested', () => {
                useGameIsolationCardStore.getState().setOpen(true);
            })
            .then((unsubscribe: () => void) => {
                if (disposed) {
                    unsubscribe();
                    return;
                }
                unlisten = unsubscribe;
            })
            .catch((error: unknown) => {
                console.warn(
                    'Unable to subscribe game isolation tray event:',
                    error
                );
            });
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);

    async function setEnabled(next: boolean) {
        setUpdating(true);
        try {
            await setGameIsolationEnabled(next);
            setOpen(false);
            let title = t('game_isolation.toast_on');
            if (!next) {
                title = isGameRunning
                    ? t('game_isolation.toast_off_running')
                    : t('game_isolation.toast_off');
            }
            toast.add({ type: 'success', title });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('game_isolation.failed')
            });
        } finally {
            setUpdating(false);
        }
    }

    useGameIsolationAccountPrompt({
        available,
        onTurnOff: () => {
            void setEnabled(false);
        }
    });

    if (!available) {
        return null;
    }
    let hint = t('game_isolation.hint_before_launch');
    if (isGameRunning) {
        hint = enabled
            ? t('game_isolation.hint_running_active')
            : t('game_isolation.hint_running_enable');
    }
    const tooltip = enabled
        ? t('status_bar.game_isolation_active')
        : t('status_bar.game_isolation');

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <span ref={anchorRef} className="inline-flex h-6 shrink-0">
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={tooltip}
                                aria-pressed={enabled}
                                disabled={updating}
                                className={cn(
                                    'size-6 shrink-0 rounded-none',
                                    enabled
                                        ? STATUS_BAR_TOGGLE_ACTIVE
                                        : STATUS_BAR_TOGGLE_IDLE
                                )}
                                onClick={() => {
                                    if (enabled) {
                                        void setEnabled(false);
                                        return;
                                    }
                                    setOpen(!open);
                                }}
                                onContextMenu={(event) => {
                                    event.preventDefault();
                                    setOpen(true);
                                }}
                            >
                                <UnplugIcon data-icon="icon" />
                            </Button>
                        }
                    />
                    <TooltipContent>{tooltip}</TooltipContent>
                </Tooltip>
            </span>
            <PopoverContent
                anchor={anchorRef}
                side="top"
                align="end"
                className="w-80 gap-3"
            >
                <div className="flex gap-2">
                    <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    <div className="flex min-w-0 flex-col gap-1.5">
                        <PopoverTitle>
                            {enabled
                                ? t('game_isolation.active_title')
                                : t('game_isolation.confirm_title')}
                        </PopoverTitle>
                        <p>{t('game_isolation.summary')}</p>
                        <ul className="text-muted-foreground list-disc ps-4 text-xs">
                            {EFFECT_KEYS.map((key) => (
                                <li key={key}>{t(key)}</li>
                            ))}
                        </ul>
                        <p className="text-muted-foreground text-xs">
                            {t('game_isolation.unchanged')}
                        </p>
                        <p
                            className={cn(
                                'text-xs',
                                isGameRunning
                                    ? 'text-amber-500'
                                    : 'text-muted-foreground'
                            )}
                        >
                            {hint}
                        </p>
                    </div>
                </div>
                <div className="flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setOpen(false)}
                    >
                        {enabled
                            ? t('game_isolation.close')
                            : t('game_isolation.cancel')}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        disabled={updating}
                        onClick={() => void setEnabled(!enabled)}
                    >
                        {enabled
                            ? t('game_isolation.turn_off')
                            : t('game_isolation.confirm')}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
