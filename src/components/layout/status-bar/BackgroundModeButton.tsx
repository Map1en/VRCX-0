import { Minimize2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { startBackgroundModeForCurrentSession } from '@/services/backgroundModeService';
import { toast } from '@/services/toastService';
import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { STATUS_BAR_TOGGLE_IDLE } from './statusBarToggle';

export function BackgroundModeButton() {
    const { t } = useTranslation();

    function startBackgroundMode() {
        startBackgroundModeForCurrentSession().catch((error: unknown) => {
            console.warn('Failed to start background mode:', error);
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.app_status_bar.toast.failed_to_start_background_mode'
                          )
            });
        });
    }

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('status_bar.start_background_mode')}
                        className={cn(
                            'size-6 shrink-0 rounded-none',
                            STATUS_BAR_TOGGLE_IDLE
                        )}
                        onClick={startBackgroundMode}
                    >
                        <Minimize2Icon data-icon="icon" />
                    </Button>
                }
            />
            <TooltipContent>
                {t('status_bar.start_background_mode_tooltip')}
            </TooltipContent>
        </Tooltip>
    );
}
