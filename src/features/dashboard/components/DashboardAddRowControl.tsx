import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

export function DashboardAddRowControl({ onAddRow }: any) {
    const { t } = useTranslation();
    const [showOptions, setShowOptions] = useState(false);

    function addRow(panelCount: any, direction: any = 'horizontal') {
        onAddRow(panelCount, direction);
        setShowOptions(false);
    }

    if (!showOptions) {
        return (
            <Button
                type="button"
                variant="ghost"
                className="border-muted-foreground/20 text-muted-foreground hover:border-primary/40 hover:bg-primary/5 mt-auto flex min-h-[80px] flex-1 items-center justify-center rounded-md border-2 border-dashed transition-colors"
                aria-label={t('view.dashboard.action.add_row')}
                onClick={() => setShowOptions(true)}
            >
                <PlusIcon data-icon="icon" className="opacity-50" />
            </Button>
        );
    }

    return (
        <div className="border-muted-foreground/20 text-muted-foreground hover:border-primary/40 hover:bg-primary/5 mt-auto flex min-h-[80px] flex-1 items-start justify-center rounded-md border-2 border-dashed p-4 transition-colors">
            <div className="flex flex-wrap items-center gap-3">
                <span className="text-muted-foreground text-xs">
                    {t('view.dashboard.action.add_row')}
                </span>
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-10 w-16 border-2 border-dashed"
                                aria-label={t('dashboard.actions.add_full_row')}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    addRow(1);
                                }}
                            >
                                <div className="bg-muted-foreground/20 h-6 w-12 rounded" />
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
                                size="icon"
                                className="h-10 w-16 gap-1 border-2 border-dashed"
                                aria-label={t(
                                    'dashboard.actions.add_split_row'
                                )}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    addRow(2);
                                }}
                            >
                                <div className="bg-muted-foreground/20 h-6 w-5 rounded" />
                                <div className="bg-muted-foreground/20 h-6 w-5 rounded" />
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
                                size="icon"
                                className="h-10 w-16 gap-1 border-2 border-dashed"
                                aria-label={t(
                                    'dashboard.actions.add_vertical_row'
                                )}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    addRow(2, 'vertical');
                                }}
                            >
                                <div className="flex flex-col gap-0.5">
                                    <div className="bg-muted-foreground/20 h-2.5 w-10 rounded" />
                                    <div className="bg-muted-foreground/20 h-2.5 w-10 rounded" />
                                </div>
                            </Button>
                        }
                    />
                    <TooltipContent>
                        {t('dashboard.actions.add_vertical_row')}
                    </TooltipContent>
                </Tooltip>
            </div>
        </div>
    );
}
