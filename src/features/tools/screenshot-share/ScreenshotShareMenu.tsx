import { ChevronUpIcon, SendIcon, Settings2Icon, StarIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useScreenshotShareStore } from '@/state/screenshotShareStore';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { ScreenshotShareDialog } from './ScreenshotShareDialog';
import { shareScreenshots } from './screenshotShareService';
import { ScreenshotShareTargetsDialog } from './ScreenshotShareTargetsDialog';

export function ScreenshotShareMenu({
    paths,
    disabled
}: {
    paths: string[];
    disabled: boolean;
}) {
    const { t } = useTranslation();
    const targets = useScreenshotShareStore((state) => state.targets);
    const loaded = useScreenshotShareStore((state) => state.loaded);
    const load = useScreenshotShareStore((state) => state.load);
    const sending = useScreenshotShareStore((state) => state.sending);
    const [manageOpen, setManageOpen] = useState(false);
    const [dialog, setDialog] = useState<{
        paths: string[];
        targetId: string | null;
    } | null>(null);
    const quickTargets = targets.filter(
        (target) => target.quick && !target.invalid
    );

    useEffect(() => {
        if (!loaded) {
            load().catch((error: unknown) => {
                console.warn('Screenshot share targets unavailable:', error);
            });
        }
    }, [loaded, load]);

    async function sendQuick() {
        if (!targets.length) {
            setManageOpen(true);
            return;
        }
        if (!quickTargets.length) {
            setDialog({ paths, targetId: null });
            return;
        }
        await shareScreenshots({ paths, targets: quickTargets });
    }

    return (
        <>
            <div className="flex items-center">
                <Tooltip disabled={!quickTargets.length}>
                    <TooltipTrigger
                        render={
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="rounded-r-none"
                                disabled={disabled || sending}
                                onClick={() => void sendQuick()}
                            />
                        }
                    >
                        <SendIcon data-icon="inline-start" />
                        {t('view.tools.screenshot_share.send')}
                    </TooltipTrigger>
                    <TooltipContent>
                        {t('view.tools.screenshot_share.quick_tooltip', {
                            targets: quickTargets
                                .map((target) => target.name)
                                .join(', ')
                        })}
                    </TooltipContent>
                </Tooltip>
                <DropdownMenu>
                    <HintTooltip label={t('view.tools.screenshot_share.more')}>
                        <DropdownMenuTrigger
                            render={
                                <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    className="rounded-l-none"
                                    disabled={disabled || sending}
                                >
                                    <ChevronUpIcon />
                                </Button>
                            }
                        />
                    </HintTooltip>
                    <DropdownMenuContent
                        side="top"
                        align="end"
                        className="w-auto min-w-48"
                    >
                        {targets.length ? (
                            <DropdownMenuGroup>
                                <DropdownMenuLabel>
                                    {t(
                                        'view.tools.screenshot_share.choose_target'
                                    )}
                                </DropdownMenuLabel>
                                {targets.map((target) => (
                                    <DropdownMenuItem
                                        key={target.id}
                                        disabled={target.invalid}
                                        onClick={() =>
                                            setDialog({
                                                paths,
                                                targetId: target.id
                                            })
                                        }
                                    >
                                        {target.quick ? (
                                            <StarIcon
                                                data-icon="inline-start"
                                                className="fill-current text-amber-400"
                                            />
                                        ) : (
                                            <SendIcon data-icon="inline-start" />
                                        )}
                                        {target.name}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuGroup>
                        ) : null}
                        {targets.length ? <DropdownMenuSeparator /> : null}
                        <DropdownMenuItem onClick={() => setManageOpen(true)}>
                            <Settings2Icon data-icon="inline-start" />
                            {t('view.tools.screenshot_share.manage')}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <ScreenshotShareTargetsDialog
                open={manageOpen}
                onOpenChange={setManageOpen}
            />
            {dialog ? (
                <ScreenshotShareDialog
                    open
                    paths={dialog.paths}
                    initialTargetId={dialog.targetId}
                    onOpenChange={(open) => {
                        if (!open) {
                            setDialog(null);
                        }
                    }}
                />
            ) : null}
        </>
    );
}
