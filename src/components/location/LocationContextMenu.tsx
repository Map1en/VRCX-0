import {
    ExternalLinkIcon,
    FlagIcon,
    HistoryIcon,
    MessageSquareIcon,
    Share2Icon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';

export function LocationContextMenu({
    canOpenWorld,
    canOpenInstanceInGame,
    canUseCurrentInstance,
    children,
    isOpenPreviousInstanceInfoDialog,
    onCopyShareLink,
    onLaunchCurrentInstance,
    onNewInstance,
    onOpenWorld,
    onSelfInviteCurrentInstance,
    onShowExactPreviousInstanceInfo,
    onShowPreviousInstances,
    previousInstancesDialog,
    previousInstancesDisabled,
    previousInstancesLoading,
    shareUrl,
    showLaunchActions,
    worldId
}: any) {
    const { t } = useTranslation();
    const newInstanceFollowUpLabelKey = canOpenInstanceInGame
        ? 'dialog.world.actions.new_instance_and_open_ingame'
        : 'dialog.world.actions.new_instance_and_self_invite';

    return (
        <>
            <ContextMenu>
                <ContextMenuTrigger
                    render={
                        <span className="inline-flex max-w-full min-w-0">
                            {children}
                        </span>
                    }
                />
                <ContextMenuContent className="w-56">
                    <ContextMenuGroup>
                        <ContextMenuItem
                            disabled={!canOpenWorld}
                            onClick={onOpenWorld}
                        >
                            <ExternalLinkIcon />
                            {t('common.actions.view_details')}
                        </ContextMenuItem>
                        <ContextMenuItem
                            disabled={!shareUrl}
                            onClick={onCopyShareLink}
                        >
                            <Share2Icon />
                            {t('dialog.world.actions.share')}
                        </ContextMenuItem>
                    </ContextMenuGroup>
                    <ContextMenuSeparator />
                    <ContextMenuGroup>
                        <ContextMenuItem
                            disabled={!worldId}
                            onClick={() => onNewInstance(false)}
                        >
                            <FlagIcon />
                            {t('dialog.world.actions.new_instance')}
                        </ContextMenuItem>
                        <ContextMenuItem
                            disabled={!worldId}
                            onClick={() => onNewInstance(true)}
                        >
                            <MessageSquareIcon />
                            {t(newInstanceFollowUpLabelKey)}
                        </ContextMenuItem>
                    </ContextMenuGroup>
                    <ContextMenuSeparator />
                    <ContextMenuGroup>
                        <ContextMenuItem
                            disabled={
                                previousInstancesDisabled ||
                                previousInstancesLoading ||
                                (!worldId && !isOpenPreviousInstanceInfoDialog)
                            }
                            onClick={() => {
                                if (isOpenPreviousInstanceInfoDialog) {
                                    onShowExactPreviousInstanceInfo();
                                    return;
                                }
                                onShowPreviousInstances();
                            }}
                        >
                            <HistoryIcon />
                            {t('dialog.world.actions.show_previous_instances')}
                        </ContextMenuItem>
                    </ContextMenuGroup>
                    {showLaunchActions ? (
                        <>
                            <ContextMenuSeparator />
                            <ContextMenuGroup>
                                <ContextMenuItem
                                    disabled={!canUseCurrentInstance}
                                    onClick={onLaunchCurrentInstance}
                                >
                                    <ExternalLinkIcon />
                                    {t('dialog.launch.open_ingame')}
                                </ContextMenuItem>
                                <ContextMenuItem
                                    disabled={!canUseCurrentInstance}
                                    onClick={() => {
                                        onSelfInviteCurrentInstance();
                                    }}
                                >
                                    <MessageSquareIcon />
                                    {t('dialog.launch.self_invite')}
                                </ContextMenuItem>
                            </ContextMenuGroup>
                        </>
                    ) : null}
                </ContextMenuContent>
            </ContextMenu>
            {previousInstancesDialog}
        </>
    );
}
