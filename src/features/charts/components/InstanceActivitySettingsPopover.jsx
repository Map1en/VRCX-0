import { Settings2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Slider } from '@/ui/shadcn/slider';
import { Switch } from '@/ui/shadcn/switch';

export function InstanceActivitySettingsPopover({
    barWidth,
    isDetailVisible,
    isSoloInstanceVisible,
    isNoFriendInstanceVisible,
    onBarWidthCommit,
    onDetailVisibleChange,
    onSoloInstanceVisibleChange,
    onNoFriendInstanceVisibleChange
}) {
    const { t } = useTranslation();

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={'Instance activity settings'}
                >
                    <Settings2Icon data-icon="inline-start" />
                </Button>
            </PopoverTrigger>
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
                        onValueChange={([value]) => onBarWidthCommit(value)}
                        className="w-40"
                    />
                </div>
                <div className="flex h-8 items-center justify-between gap-4 text-sm">
                    <span className="shrink-0">
                        {t(
                            'view.charts.instance_activity.settings.show_detail'
                        )}
                    </span>
                    <Switch
                        checked={isDetailVisible}
                        onCheckedChange={onDetailVisibleChange}
                    />
                </div>
                {isDetailVisible ? (
                    <>
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
                                onCheckedChange={
                                    onNoFriendInstanceVisibleChange
                                }
                            />
                        </div>
                    </>
                ) : null}
            </PopoverContent>
        </Popover>
    );
}
