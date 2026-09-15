import { BellOffIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import {
    commands,
    type NotificationDoNotDisturbMode
} from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    STATUS_BAR_TOGGLE_ACTIVE,
    STATUS_BAR_TOGGLE_IDLE
} from './statusBarToggle';

export function DoNotDisturbMenu(): ReactElement {
    const { t } = useTranslation();
    const [updating, setUpdating] = useState(false);
    const mode = useRuntimeStore(
        (state) => state.notificationDoNotDisturb.mode
    );
    const endsAt = useRuntimeStore(
        (state) => state.notificationDoNotDisturb.endsAt
    );
    const active = mode !== 'off';
    let tooltip = t('status_bar.do_not_disturb');
    if (active) {
        tooltip = t('status_bar.do_not_disturb_active');
    }
    if (endsAt && mode !== 'untilStopped') {
        tooltip = t('status_bar.do_not_disturb_until', {
            time: new Date(endsAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
            })
        });
    }

    async function setMode(nextMode: NotificationDoNotDisturbMode) {
        setUpdating(true);
        try {
            const snapshot =
                await commands.appNotificationDoNotDisturbModeSet(nextMode);
            useRuntimeStore.getState().setNotificationDoNotDisturb(snapshot);
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('status_bar.do_not_disturb_failed')
            });
        } finally {
            setUpdating(false);
        }
    }

    return (
        <DropdownMenu>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <DropdownMenuTrigger
                            render={
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={tooltip}
                                    aria-pressed={active}
                                    disabled={updating}
                                    className={cn(
                                        'size-6 shrink-0 rounded-none',
                                        active
                                            ? STATUS_BAR_TOGGLE_ACTIVE
                                            : STATUS_BAR_TOGGLE_IDLE
                                    )}
                                >
                                    <BellOffIcon data-icon="icon" />
                                </Button>
                            }
                        />
                    }
                />
                <TooltipContent>{tooltip}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="top" align="end" className="w-44">
                <DropdownMenuCheckboxItem
                    checked={mode === 'oneHour'}
                    onClick={() => void setMode('oneHour')}
                >
                    {t('status_bar.do_not_disturb_one_hour')}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                    checked={mode === 'threeHours'}
                    onClick={() => void setMode('threeHours')}
                >
                    {t('status_bar.do_not_disturb_three_hours')}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                    checked={mode === 'untilStopped'}
                    onClick={() => void setMode('untilStopped')}
                >
                    {t('status_bar.do_not_disturb_until_stopped')}
                </DropdownMenuCheckboxItem>
                {active ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => void setMode('off')}>
                            {t('status_bar.do_not_disturb_turn_off')}
                        </DropdownMenuItem>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
