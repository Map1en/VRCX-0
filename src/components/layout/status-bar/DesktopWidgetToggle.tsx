import { PictureInPicture2Icon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import {
    commands,
    type DesktopWidgetSnapshot
} from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import {
    ContextMenu,
    ContextMenuCheckboxItem,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    STATUS_BAR_TOGGLE_ACTIVE,
    STATUS_BAR_TOGGLE_IDLE
} from './statusBarToggle';

export function DesktopWidgetToggle(): ReactElement | null {
    const { t } = useTranslation();
    const [updating, setUpdating] = useState(false);
    const supported = useRuntimeStore((state) => state.desktopWidget.supported);
    const enabled = useRuntimeStore((state) => state.desktopWidget.enabled);
    const pinned = useRuntimeStore((state) => state.desktopWidget.pinned);
    const clickThrough = useRuntimeStore(
        (state) => state.desktopWidget.clickThrough
    );
    if (!supported) {
        return null;
    }
    let tooltip = t('status_bar.desktop_widget_off');
    if (enabled) {
        tooltip = clickThrough
            ? t('status_bar.desktop_widget_click_through')
            : t('status_bar.desktop_widget_on');
    }

    async function update(request: () => Promise<DesktopWidgetSnapshot>) {
        setUpdating(true);
        try {
            useRuntimeStore.getState().setDesktopWidget(await request());
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('status_bar.desktop_widget_failed')
            });
        } finally {
            setUpdating(false);
        }
    }

    function setEnabled(next: boolean) {
        void update(() => commands.appDesktopWidgetEnabledSet(next));
    }

    return (
        <ContextMenu>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <ContextMenuTrigger
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
                                    onClick={() => setEnabled(!enabled)}
                                >
                                    <PictureInPicture2Icon data-icon="icon" />
                                </Button>
                            }
                        />
                    }
                />
                <TooltipContent>
                    <div>{tooltip}</div>
                    {enabled ? (
                        <div className="opacity-70">
                            {t('status_bar.desktop_widget_menu_hint')}
                        </div>
                    ) : null}
                </TooltipContent>
            </Tooltip>
            <ContextMenuContent className="w-48">
                {enabled ? (
                    <>
                        <ContextMenuItem
                            onClick={() => void commands.appDesktopWidgetShow()}
                        >
                            {t('desktop_widget.tray.show')}
                        </ContextMenuItem>
                        <ContextMenuCheckboxItem
                            checked={pinned}
                            disabled={updating}
                            onClick={() =>
                                void update(() =>
                                    commands.appDesktopWidgetPinnedToggle()
                                )
                            }
                        >
                            {t('desktop_widget.menu.pin')}
                        </ContextMenuCheckboxItem>
                        <ContextMenuCheckboxItem
                            checked={clickThrough}
                            disabled={updating}
                            onClick={() =>
                                void update(() =>
                                    commands.appDesktopWidgetClickThroughToggle()
                                )
                            }
                        >
                            {t('desktop_widget.menu.click_through')}
                        </ContextMenuCheckboxItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                            disabled={updating}
                            onClick={() => setEnabled(false)}
                        >
                            {t('desktop_widget.menu.close')}
                        </ContextMenuItem>
                    </>
                ) : (
                    <ContextMenuItem
                        disabled={updating}
                        onClick={() => setEnabled(true)}
                    >
                        {t('desktop_widget.tray.turn_on')}
                    </ContextMenuItem>
                )}
            </ContextMenuContent>
        </ContextMenu>
    );
}
