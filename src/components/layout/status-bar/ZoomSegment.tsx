import { MinusIcon, PlusIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import {
    formatZoomPercentage,
    normalizeZoomLevel
} from '@/services/themeService';
import { toast } from '@/services/toastService';
import {
    queueZoomLevelPreference,
    stepQueuedZoomLevelPreference,
    syncQueuedZoomLevel
} from '@/services/zoomPreferenceService';
import {
    DEFAULT_ZOOM_LEVEL,
    MAX_ZOOM_LEVEL,
    MIN_ZOOM_LEVEL,
    ZOOM_STEP
} from '@/shared/constants/themes';
import { useShellStore } from '@/state/shellStore';
import { Button } from '@/ui/shadcn/button';
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger
} from '@/ui/shadcn/popover';

export function ZoomLevelQueueSync() {
    const zoomLevel = useShellStore((state) =>
        normalizeZoomLevel(state.zoomLevel)
    );

    useEffect(() => {
        syncQueuedZoomLevel(zoomLevel);
    }, [zoomLevel]);

    return null;
}

export function ZoomSegment() {
    const { t } = useTranslation();
    const zoomLevel = useShellStore((state) =>
        normalizeZoomLevel(state.zoomLevel)
    );
    const zoomLabel = formatZoomPercentage(zoomLevel);

    function showZoomError(error: unknown) {
        toast.add({
            type: 'error',
            title:
                error instanceof Error
                    ? error.message
                    : t('app_menu.messages.zoom_failed')
        });
    }

    return (
        <Popover>
            <PopoverTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('status_bar.zoom_tooltip')}
                        className="text-muted-foreground hover:text-muted-foreground h-6 gap-1.5 rounded-none px-2 text-xs font-normal"
                    >
                        <span className="text-muted-foreground">
                            {t('status_bar.zoom')}
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                            {zoomLabel}
                        </span>
                    </Button>
                }
            />
            <PopoverContent side="top" align="end" className="w-72">
                <PopoverHeader>
                    <PopoverTitle>{t('status_bar.zoom')}</PopoverTitle>
                    <PopoverDescription>
                        {t('status_bar.zoom_tooltip')}
                    </PopoverDescription>
                </PopoverHeader>
                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={t('app_menu.zoom_out')}
                        className="size-10 shrink-0"
                        disabled={zoomLevel <= MIN_ZOOM_LEVEL}
                        onClick={() =>
                            stepQueuedZoomLevelPreference(-ZOOM_STEP, {
                                onError: showZoomError
                            })
                        }
                    >
                        <MinusIcon data-icon="icon" />
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        aria-label={t('app_menu.reset_zoom')}
                        className="h-10 min-w-0 flex-1 gap-2 px-3"
                        onClick={() =>
                            queueZoomLevelPreference(DEFAULT_ZOOM_LEVEL, {
                                onError: showZoomError
                            })
                        }
                    >
                        <span className="text-sm font-medium tabular-nums">
                            {zoomLabel}
                        </span>
                        <span className="text-muted-foreground truncate text-xs font-normal">
                            {t('app_menu.reset_zoom')}
                        </span>
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={t('app_menu.zoom_in')}
                        className="size-10 shrink-0"
                        disabled={zoomLevel >= MAX_ZOOM_LEVEL}
                        onClick={() =>
                            stepQueuedZoomLevelPreference(ZOOM_STEP, {
                                onError: showZoomError
                            })
                        }
                    >
                        <PlusIcon data-icon="icon" />
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
