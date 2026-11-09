import {
    FlipHorizontal2,
    FlipVertical2,
    Maximize2,
    Minimize2,
    RefreshCcw,
    RotateCcw,
    RotateCw,
    ZoomIn,
    ZoomOut
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import { Separator } from '@/ui/shadcn/separator';
import { Slider } from '@/ui/shadcn/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

export interface ImageCropToolbarModel {
    disabled: boolean;
    fitLabel: string;
    fitWhole: boolean;
    flipH: boolean;
    flipV: boolean;
    zoomPercent: number;
    zoomSliderValue: number;
}

export interface ImageCropToolbarActions {
    flipHorizontal: () => void;
    flipVertical: () => void;
    reset: () => void;
    rotateLeft: () => void;
    rotateRight: () => void;
    toggleFit: () => void;
    zoomIn: () => void;
    zoomOut: () => void;
    setZoom: (value: number | readonly number[]) => void;
}

export function ImageCropToolbar({
    model,
    actions
}: {
    model: ImageCropToolbarModel;
    actions: ImageCropToolbarActions;
}) {
    const { t } = useTranslation();

    function tool(
        onClick: () => void,
        label: string,
        icon: ReactNode,
        active?: boolean
    ) {
        return (
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={onClick}
                            disabled={model.disabled}
                            aria-label={label}
                            aria-pressed={active}
                            className={cn(
                                'text-muted-foreground hover:text-foreground',
                                active && 'bg-muted text-foreground'
                            )}
                        >
                            {icon}
                        </Button>
                    }
                />
                <TooltipContent>{label}</TooltipContent>
            </Tooltip>
        );
    }

    return (
        <div
            className="bg-muted/40 flex flex-wrap items-center justify-center gap-2 rounded-xl border p-1.5"
            role="toolbar"
            aria-label={t('dialog.image_crop.toolbar_label')}
        >
            <div className="bg-background/50 flex items-center gap-0.5 rounded-lg border p-1">
                {tool(
                    actions.rotateLeft,
                    t('dialog.image_crop.rotate_left'),
                    <RotateCcw />
                )}
                {tool(
                    actions.rotateRight,
                    t('dialog.image_crop.rotate_right'),
                    <RotateCw />
                )}
                <Separator orientation="vertical" className="mx-0.5 !h-5" />
                {tool(
                    actions.flipHorizontal,
                    t('dialog.image_crop.flip_h'),
                    <FlipHorizontal2 />,
                    model.flipH
                )}
                {tool(
                    actions.flipVertical,
                    t('dialog.image_crop.flip_v'),
                    <FlipVertical2 />,
                    model.flipV
                )}
            </div>

            <div className="bg-background/50 flex items-center gap-1 rounded-lg border py-1 pr-1 pl-1.5">
                {tool(
                    actions.zoomOut,
                    t('dialog.image_crop.zoom_out'),
                    <ZoomOut />
                )}
                <div className="w-24 sm:w-36">
                    <Slider
                        min={0}
                        max={100}
                        step={1}
                        value={[model.zoomSliderValue]}
                        disabled={model.disabled}
                        onValueChange={actions.setZoom}
                        aria-label={t('dialog.image_crop.zoom_level')}
                    />
                </div>
                <span className="text-muted-foreground w-10 text-right font-mono text-xs tabular-nums">
                    {model.zoomPercent}%
                </span>
                {tool(
                    actions.zoomIn,
                    t('dialog.image_crop.zoom_in'),
                    <ZoomIn />
                )}
            </div>

            <div className="bg-background/50 flex items-center gap-0.5 rounded-lg border p-1">
                {tool(
                    actions.toggleFit,
                    model.fitLabel,
                    model.fitWhole ? <Minimize2 /> : <Maximize2 />,
                    model.fitWhole
                )}
                {tool(
                    actions.reset,
                    t('dialog.image_crop.reset'),
                    <RefreshCcw />
                )}
            </div>
        </div>
    );
}
