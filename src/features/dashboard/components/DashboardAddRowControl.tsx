import { PlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardDirection } from '@/repositories/dashboardRepository';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

export function DashboardAddRowControl({
    onAddRow
}: {
    onAddRow: (panelCount: number, direction: DashboardDirection) => void;
}) {
    const { t } = useTranslation();
    const [showOptions, setShowOptions] = useState(false);

    function addRow(
        panelCount: number,
        direction: DashboardDirection = 'horizontal'
    ) {
        onAddRow(panelCount, direction);
        setShowOptions(false);
    }

    if (!showOptions) {
        return (
            <div className="group flex h-11 items-center gap-3">
                <div className="bg-border/80 group-hover:bg-primary/40 h-px flex-1 transition-colors duration-150 ease-out" />
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="bg-card text-foreground hover:bg-accent hover:border-primary/50 h-8 rounded-md px-4 shadow-sm transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] motion-reduce:transform-none"
                    aria-label={t('view.dashboard.action.add_row')}
                    onClick={() => setShowOptions(true)}
                >
                    <PlusIcon
                        data-icon="inline-start"
                        className="text-primary"
                    />
                    {t('view.dashboard.action.add_row')}
                </Button>
                <div className="bg-border/80 group-hover:bg-primary/40 h-px flex-1 transition-colors duration-150 ease-out" />
            </div>
        );
    }

    return (
        <div className="flex min-h-12 items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2">
            <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="text-muted-foreground text-xs">
                    {t('view.dashboard.action.add_row')}
                </span>
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                type="button"
                                variant="outline"
                                size="icon-sm"
                                className="h-8 w-12 border-dashed"
                                aria-label={t('dashboard.actions.add_full_row')}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    addRow(1);
                                }}
                            >
                                <div className="bg-muted-foreground/25 h-4 w-7 rounded-[3px]" />
                            </Button>
                        }
                    />
                    <TooltipContent>
                        {t('dashboard.actions.add_full_row')}
                    </TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                type="button"
                                variant="outline"
                                size="icon-sm"
                                className="h-8 w-12 gap-0.5 border-dashed"
                                aria-label={t(
                                    'dashboard.actions.add_split_row'
                                )}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    addRow(2);
                                }}
                            >
                                <div className="bg-muted-foreground/25 h-4 w-3 rounded-[2px]" />
                                <div className="bg-muted-foreground/25 h-4 w-3 rounded-[2px]" />
                            </Button>
                        }
                    />
                    <TooltipContent>
                        {t('dashboard.actions.add_split_row')}
                    </TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                type="button"
                                variant="outline"
                                size="icon-sm"
                                className="h-8 w-12 border-dashed"
                                aria-label={t(
                                    'dashboard.actions.add_vertical_row'
                                )}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    addRow(2, 'vertical');
                                }}
                            >
                                <div className="flex flex-col gap-0.5">
                                    <div className="bg-muted-foreground/25 h-1.5 w-7 rounded-[2px]" />
                                    <div className="bg-muted-foreground/25 h-1.5 w-7 rounded-[2px]" />
                                </div>
                            </Button>
                        }
                    />
                    <TooltipContent>
                        {t('dashboard.actions.add_vertical_row')}
                    </TooltipContent>
                </Tooltip>
                <HintTooltip label={t('common.actions.cancel')}>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground"
                        onClick={() => setShowOptions(false)}
                    >
                        <XIcon data-icon="icon" />
                    </Button>
                </HintTooltip>
            </div>
        </div>
    );
}
