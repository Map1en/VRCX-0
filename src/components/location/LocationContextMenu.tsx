import {
    ExternalLinkIcon,
    FlagIcon,
    HistoryIcon,
    MessageSquareIcon,
    Share2Icon
} from 'lucide-react';
import type { ReactNode, SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { LaunchModeContextMenuGroup } from '@/components/launch/LaunchModeContextMenuGroup';
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
    launchLocation,
    launchShortName,
    onCopyShareLink,
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
}: {
    canOpenWorld: boolean;
    canOpenInstanceInGame: boolean;
    canUseCurrentInstance: boolean;
    children?: ReactNode;
    isOpenPreviousInstanceInfoDialog: boolean;
    launchLocation: string;
    launchShortName: string;
    onCopyShareLink(): void;
    onNewInstance(selfInvite?: boolean): void;
    onOpenWorld(event: SyntheticEvent<HTMLElement>): void;
    onSelfInviteCurrentInstance(): void;
    onShowExactPreviousInstanceInfo(): void;
    onShowPreviousInstances(): void;
    previousInstancesDialog: ReactNode;
    previousInstancesDisabled: boolean;
    previousInstancesLoading: boolean;
    shareUrl: string;
    showLaunchActions: boolean;
    worldId: string;
}) {
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
                            <LaunchModeContextMenuGroup
                                disabled={!canUseCurrentInstance}
                                errorMessage={t(
                                    'host.launch_dialog.toast.launch_action_failed'
                                )}
                                location={launchLocation}
                                shortName={launchShortName}
                            />
                            <ContextMenuSeparator />
                            <ContextMenuGroup>
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
