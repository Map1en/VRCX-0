import { Settings2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { HintTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Slider } from '@/ui/shadcn/slider';
import { Switch } from '@/ui/shadcn/switch';

type InstanceActivitySettingsPopoverProps = {
    barWidth: number;
    isSoloInstanceVisible: boolean;
    isNoFriendInstanceVisible: boolean;
    onBarWidthCommit: (value: number) => void;
    onSoloInstanceVisibleChange: (value: boolean) => void;
    onNoFriendInstanceVisibleChange: (value: boolean) => void;
};

export function InstanceActivitySettingsPopover({
    barWidth,
    isSoloInstanceVisible,
    isNoFriendInstanceVisible,
    onBarWidthCommit,
    onSoloInstanceVisibleChange,
    onNoFriendInstanceVisibleChange
}: InstanceActivitySettingsPopoverProps) {
    const { t } = useTranslation();

    return (
        <Popover>
            <HintTooltip
                label={t('view.charts.instance_activity.settings.header')}
            >
                <PopoverTrigger
                    render={
                        <Button type="button" variant="ghost" size="icon">
                            <Settings2Icon data-icon="inline-start" />
                        </Button>
                    }
                />
            </HintTooltip>
            <PopoverContent
                side="bottom"
                align="end"
                className="flex w-72 flex-col gap-3"
            >
                <div className="flex h-8 items-center justify-between gap-4 text-sm">
                    <span className="shrink-0">
                        {t('view.charts.instance_activity.settings.bar_width')}
                    </span>
                    <Slider
                        min={1}
                        max={50}
                        step={1}
                        value={[barWidth]}
                        onValueChange={(value) =>
                            onBarWidthCommit(
                                Array.isArray(value) ? value[0] : value
                            )
                        }
                        className="w-40"
                    />
                </div>
                <div className="flex h-8 items-center justify-between gap-4 text-sm">
                    <span className="shrink-0">
                        {t(
                            'view.charts.instance_activity.settings.show_solo_instance'
                        )}
                    </span>
                    <Switch
                        checked={isSoloInstanceVisible}
                        onCheckedChange={onSoloInstanceVisibleChange}
                    />
                </div>
                <div className="flex h-8 items-center justify-between gap-4 text-sm">
                    <span className="shrink-0">
                        {t(
                            'view.charts.instance_activity.settings.show_no_friend_instance'
                        )}
                    </span>
                    <Switch
                        checked={isNoFriendInstanceVisible}
                        onCheckedChange={onNoFriendInstanceVisibleChange}
                    />
                </div>
            </PopoverContent>
        </Popover>
    );
}
