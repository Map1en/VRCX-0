import {
    BellIcon,
    CompassIcon,
    FoldHorizontalIcon,
    HistoryIcon,
    KeyboardIcon,
    PanelRightIcon,
    PanelRightOpenIcon,
    PinIcon,
    SearchIcon,
    ShuffleIcon,
    SparklesIcon,
    UnfoldHorizontalIcon
} from 'lucide-react';
import {
    type ComponentProps,
    useCallback,
    useRef,
    useState,
    type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';

import { KeyboardShortcut } from '@/components/keyboard/KeyboardShortcut';
import { useShortcutHandler } from '@/components/keyboard/shortcutDispatcher';
import { ShortcutHintPanel } from '@/components/keyboard/ShortcutHintPanel';
import { cn } from '@/lib/utils';
import {
    isBackgroundImageCustomSourceRotating,
    refreshBackgroundImage
} from '@/services/background-image/backgroundImageService';
import { markAllNotificationsSeenWithFeedback } from '@/services/notificationMarkAllSeenService';
import { setThemeModePreference } from '@/services/preferencesService';
import { removeShellMenuNotify } from '@/services/shellNotificationDotService';
import { useResolvedThemeMode } from '@/services/themeService';
import { toast } from '@/services/toastService';
import {
    openOrInstallLatestAvailableUpdate,
    shouldShowUpdateUi
} from '@/services/updateInstallService';
import {
    openVrcNotificationCenter,
    setVrcNotificationCenterOpen
} from '@/services/vrcNotificationService';
import {
    enterSidebarWindowMode,
    restoreNormalWindowMode,
    runAfterRestoringNormalWindow,
    setWindowAlwaysOnTop
} from '@/services/windowModeService';
import { getBuildBadgeLabel } from '@/shared/buildLabel';
import { useAssistantChatStore } from '@/state/assistantChatStore';
import { useBackgroundImageStore } from '@/state/backgroundImageStore';
import {
    communityThemeControlsAppearance,
    useCommunityThemeStore
} from '@/state/communityThemeStore';
import { useCriticalTaskStore } from '@/state/criticalTaskStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useShellStore } from '@/state/shellStore';
import {
    selectCanMarkAllSeen,
    useVrcNotificationStore
} from '@/state/vrcNotificationStore';
import { AnimatedThemeToggler } from '@/ui/shadcn/animated-theme-toggler';
import { Badge } from '@/ui/shadcn/badge';
import { Button, buttonVariants } from '@/ui/shadcn/button';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import { Separator } from '@/ui/shadcn/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { StatusBarHoverCard } from './status-bar/StatusBarHoverCard';
import { STATUS_BAR_TOGGLE_ACTIVE } from './status-bar/statusBarToggle';
import { TitleBarUpdateButton } from './TitleBarUpdateButton';
import { useQuickSearchActions } from './useQuickSearchActions';
import { useRightSidePanelVisibility } from './useRightSidePanelVisibility';

const TITLE_BAR_ICON_BUTTON_CLASS =
    'text-muted-foreground hover:text-foreground size-7 min-w-7 rounded-md px-0 hover:bg-(--state-hover-surface)';

function TitleBarGroupSeparator() {
    return (
        <Separator
            orientation="vertical"
            className="mx-0.5 h-4 data-vertical:self-center"
        />
    );
}

export function TitleBarButton({
    label,
    className,
    children,
    onClick,
    size = 'icon-sm',
    ...props
}: Omit<ComponentProps<typeof Button>, 'aria-label' | 'type' | 'variant'> & {
    label: string;
}) {
    const shortcutHintsVisible = useShellStore(
        (state) => state.shortcutHintsVisible
    );
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size={size}
                        aria-label={label}
                        className={cn(
                            'text-muted-foreground hover:text-foreground hover:bg-(--state-hover-surface)',
                            className
                        )}
                        onClick={onClick}
                        {...props}
                    >
                        {children}
                    </Button>
                }
            />
            <TooltipContent hidden={shortcutHintsVisible}>
                {label}
            </TooltipContent>
        </Tooltip>
    );
}

export function TitleBarBuildBadge() {
    const { t } = useTranslation();
    const buildBadgeLabel = getBuildBadgeLabel(t);
    if (!buildBadgeLabel) {
        return null;
    }
    return (
        <Badge
            data-tauri-drag-region
            variant="secondary"
            className="h-5 shrink-0 rounded-md px-1.5 text-[10px] leading-none shadow-none"
        >
            {buildBadgeLabel}
        </Badge>
    );
}

const SHORTCUT_KBD_CLASS =
    'bg-background/45 h-3.5 min-w-3.5 rounded-[3px] px-1 text-[9px] leading-3.5 shadow-none';

function getTitleBarShortcutLabel(isMacHost: boolean, actionKey: string) {
    const modifierKey = isMacHost ? '⌘' : 'Ctrl';
    return isMacHost
        ? `${modifierKey}${actionKey}`
        : `${modifierKey}+${actionKey}`;
}

function formatTitleBarShortcutLabel(value: string, shortcutLabel: string) {
    return `${value} ${shortcutLabel}`;
}

interface TitleBarActionsResult {
    isSessionReady: boolean;
    actions: ReactNode;
    alwaysOnTopButton: ReactNode;
    sidebarWindowModeButton: ReactNode;
    notificationAction: ReactNode;
    appearanceAction: ReactNode;
    openQuickSearch: () => void;
    openDirectAccessFromClipboard: () => void;
    openNotificationCenter: () => void;
    toggleRightSidebar: () => void;
    rightSidebarOpen: boolean;
}

export function useTitleBarActions(
    actionsClassName?: string
): TitleBarActionsResult {
    const { t } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();
    const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
    const isSessionReady = useSessionStore(
        (state) => state.sessionPhase === 'ready'
    );
    const { openQuickSearch, openDirectAccessFromClipboard } =
        useQuickSearchActions();
    const notificationLayout = usePreferencesStore(
        (state) => state.notificationLayout
    );
    const vrcUnseenNotificationCount = useVrcNotificationStore(
        (state) => state.unseenCount
    );
    const canMarkAllVrcNotificationsSeen =
        useVrcNotificationStore(selectCanMarkAllSeen);
    const isVrcNotificationCenterOpen = useVrcNotificationStore(
        (state) => state.isCenterOpen
    );
    const isMarkingAllVrcNotificationsSeen = useVrcNotificationStore(
        (state) => state.markAllSeenProgress !== null
    );
    const hostPlatform = useRuntimeStore(
        (state) => state.hostCapabilities.platform
    );
    const showUpdateUi = useRuntimeStore((state) =>
        shouldShowUpdateUi(state.updateLoop)
    );
    const sidebarWindowMode = useShellStore(
        (state) => state.windowDisplayMode === 'sidebar'
    );
    const criticalTaskActive = useCriticalTaskStore(
        (state) => state.activeTasks.length > 0
    );
    const shortcutHintsVisible = useShellStore(
        (state) => state.shortcutHintsVisible
    );
    const actionsRef = useRef<HTMLDivElement>(null);
    const placeShortcutHintPanel = useCallback(
        (panel: HTMLDivElement | null) => {
            const anchor = actionsRef.current?.getBoundingClientRect();
            if (!panel || !anchor) {
                return;
            }
            panel.style.top = `${anchor.bottom}px`;
            panel.style.right = `${document.documentElement.clientWidth - anchor.right}px`;
        },
        []
    );
    const resolvedThemeMode = useResolvedThemeMode();
    const communityThemeEnabled = useCommunityThemeStore(
        (state) => state.enabled
    );
    const installedCommunityTheme = useCommunityThemeStore(
        (state) => state.installedTheme
    );
    const localCommunityThemePreview = useCommunityThemeStore(
        (state) => state.localPreview
    );
    const backgroundImageEnabled = useBackgroundImageStore(
        (state) => state.enabled
    );
    const backgroundImageRotating = useBackgroundImageStore(
        (state) =>
            state.enabled &&
            state.mode === 'custom' &&
            isBackgroundImageCustomSourceRotating(
                state.customSource,
                state.snapshot?.imageCount
            )
    );
    const backgroundImageLoading = useBackgroundImageStore(
        (state) => state.loading
    );
    const {
        sidePanelOpen: rightSidebarOpen,
        toggleSidePanelOpen: toggleRightSidebar
    } = useRightSidePanelVisibility(location.pathname);
    const alwaysOnTop = useShellStore((state) => state.windowAlwaysOnTop);

    const isMacHost = hostPlatform === 'macos';
    const alwaysOnTopSupported =
        hostPlatform === 'windows' || hostPlatform === 'macos';
    const notificationCenterEnabled = notificationLayout !== 'table';
    const notificationActionVisible =
        isSessionReady && (sidebarWindowMode || notificationCenterEnabled);
    const themeToggleVisible =
        !backgroundImageEnabled &&
        !communityThemeControlsAppearance(
            communityThemeEnabled,
            installedCommunityTheme,
            localCommunityThemePreview
        );
    const themeToggleLabel = t('nav_tooltip.toggle_theme');
    const rightSidebarLabel = rightSidebarOpen
        ? t('app_menu.hide_friends_sidebar')
        : t('app_menu.show_friends_sidebar');
    const quickSearchShortcutLabel = getTitleBarShortcutLabel(isMacHost, 'K');
    const quickSearchLabel = t('app_menu.quick_search');
    const directAccessLabel = t('prompt.direct_access_omni.header');
    const sidebarWindowModeBlocked = !sidebarWindowMode && criticalTaskActive;
    const sidebarWindowModeLabel = sidebarWindowMode
        ? t('app_menu.restore_full_window')
        : t('app_menu.enter_sidebar_mode');

    const toggleSidebarWindowMode = useCallback(() => {
        if (sidebarWindowModeBlocked) {
            return;
        }
        const transition = sidebarWindowMode
            ? restoreNormalWindowMode()
            : enterSidebarWindowMode();
        void transition.catch((error: unknown) => {
            console.warn('Failed to change the window display mode:', error);
        });
    }, [sidebarWindowMode, sidebarWindowModeBlocked]);

    const toggleAlwaysOnTop = useCallback(() => {
        void setWindowAlwaysOnTop(!alwaysOnTop).catch((error: unknown) => {
            console.warn(
                'Failed to change the always-on-top window state:',
                error
            );
        });
    }, [alwaysOnTop]);

    const alwaysOnTopButton = alwaysOnTopSupported ? (
        <StatusBarHoverCard
            icon={<PinIcon />}
            title={t('app_menu.always_on_top')}
            state={
                alwaysOnTop ? t('status_bar.card.on') : t('status_bar.card.off')
            }
            description={t('app_menu.title_bar_card.always_on_top')}
            actions={{
                click: alwaysOnTop
                    ? t('status_bar.card.turn_off')
                    : t('status_bar.card.turn_on')
            }}
            suppressed={shortcutHintsVisible}
            side="bottom"
            trigger={
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('app_menu.always_on_top')}
                    aria-pressed={alwaysOnTop}
                    className={cn(
                        TITLE_BAR_ICON_BUTTON_CLASS,
                        alwaysOnTop && STATUS_BAR_TOGGLE_ACTIVE
                    )}
                    onClick={toggleAlwaysOnTop}
                >
                    <PinIcon data-icon="icon" />
                </Button>
            }
        />
    ) : null;

    const SidebarWindowModeIcon = sidebarWindowMode
        ? UnfoldHorizontalIcon
        : FoldHorizontalIcon;
    const sidebarWindowModeButton = (
        <StatusBarHoverCard
            icon={<SidebarWindowModeIcon />}
            title={t('app_menu.enter_sidebar_mode')}
            state={
                sidebarWindowMode
                    ? t('status_bar.card.on')
                    : t('status_bar.card.off')
            }
            description={t('app_menu.title_bar_card.sidebar_mode')}
            actions={{ click: sidebarWindowModeLabel }}
            suppressed={shortcutHintsVisible}
            side="bottom"
            trigger={
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={sidebarWindowModeLabel}
                    aria-pressed={sidebarWindowMode}
                    aria-disabled={sidebarWindowModeBlocked}
                    className={cn(
                        TITLE_BAR_ICON_BUTTON_CLASS,
                        'aria-disabled:opacity-50'
                    )}
                    onClick={toggleSidebarWindowMode}
                >
                    <SidebarWindowModeIcon data-icon="icon" />
                </Button>
            }
        >
            {sidebarWindowModeBlocked ? (
                <p className="text-muted-foreground">
                    {t('app_menu.title_bar_card.sidebar_mode_blocked')}
                </p>
            ) : null}
        </StatusBarHoverCard>
    );

    useShortcutHandler('quick-search', openQuickSearch, isSessionReady);
    useShortcutHandler(
        'direct-access',
        openDirectAccessFromClipboard,
        isSessionReady
    );

    async function markAllNotificationsRead() {
        await markAllNotificationsSeenWithFeedback(
            t(
                'component.app_title_bar.toast.failed_to_mark_notifications_as_seen'
            )
        );
        removeShellMenuNotify('notification');
    }

    function openNotifications() {
        if (notificationCenterEnabled) {
            setVrcNotificationCenterOpen(!isVrcNotificationCenterOpen);
            return;
        }
        runAfterRestoringNormalWindow(() => {
            void navigate('/notification');
        });
    }

    const notificationButton = (
        <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={
                vrcUnseenNotificationCount > 0
                    ? t('side_panel.notification_center.title_with_count', {
                          count: vrcUnseenNotificationCount
                      })
                    : t('side_panel.notification_center.title')
            }
            className={cn(TITLE_BAR_ICON_BUTTON_CLASS, 'relative')}
            onClick={openNotifications}
            onContextMenu={
                vrcUnseenNotificationCount > 0
                    ? undefined
                    : (event: React.MouseEvent) => {
                          event.preventDefault();
                          toast.add({
                              type: 'info',
                              title: t(
                                  'side_panel.notification_center.no_unseen_notifications'
                              )
                          });
                      }
            }
        >
            <BellIcon
                data-icon="icon"
                className={cn(vrcUnseenNotificationCount > 0 && '-rotate-12')}
            />
            {vrcUnseenNotificationCount > 0 ? (
                <Badge className="absolute top-0.5 right-1 h-3 min-w-3 rounded-full px-0.5 py-0 text-[7px] leading-none">
                    {vrcUnseenNotificationCount > 99
                        ? '99+'
                        : vrcUnseenNotificationCount}
                </Badge>
            ) : null}
        </Button>
    );

    const notificationMenuAvailable =
        canMarkAllVrcNotificationsSeen || isMarkingAllVrcNotificationsSeen;
    const notificationCard = (
        <StatusBarHoverCard
            icon={<BellIcon />}
            title={t('side_panel.notification_center.title')}
            state={
                vrcUnseenNotificationCount > 0
                    ? t('app_menu.title_bar_card.unseen', {
                          count: vrcUnseenNotificationCount
                      })
                    : t(
                          'side_panel.notification_center.no_unseen_notifications'
                      )
            }
            description={t(
                notificationCenterEnabled
                    ? 'app_menu.title_bar_card.notification'
                    : 'app_menu.title_bar_card.notification_page'
            )}
            actions={{
                click: notificationCenterEnabled
                    ? t('app_menu.title_bar_card.open_notification_center')
                    : t('app_menu.title_bar_card.open_notification_history'),
                rightClick: notificationMenuAvailable
                    ? t('nav_menu.mark_all_read')
                    : undefined
            }}
            suppressed={shortcutHintsVisible || notificationMenuOpen}
            side="bottom"
            trigger={
                notificationMenuAvailable ? (
                    <ContextMenuTrigger render={notificationButton} />
                ) : (
                    notificationButton
                )
            }
        >
            {notificationCenterEnabled ? (
                <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="self-start"
                    onClick={() =>
                        runAfterRestoringNormalWindow(() => {
                            void navigate('/notification');
                        })
                    }
                >
                    <HistoryIcon data-icon="inline-start" />
                    {t('app_menu.title_bar_card.open_notification_history')}
                </Button>
            ) : null}
        </StatusBarHoverCard>
    );

    const notificationAction = notificationActionVisible ? (
        notificationMenuAvailable ? (
            <ContextMenu onOpenChange={setNotificationMenuOpen}>
                {notificationCard}
                <ContextMenuContent className="w-48">
                    <ContextMenuGroup>
                        <ContextMenuItem
                            disabled={isMarkingAllVrcNotificationsSeen}
                            onClick={() => {
                                markAllNotificationsRead();
                            }}
                        >
                            {t('nav_menu.mark_all_read')}
                        </ContextMenuItem>
                    </ContextMenuGroup>
                </ContextMenuContent>
            </ContextMenu>
        ) : (
            notificationCard
        )
    ) : null;

    function changeBackgroundImage() {
        refreshBackgroundImage().catch((error: unknown) => {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.background_image.toast.failed')
            });
        });
    }

    const appearanceAction = themeToggleVisible ? (
        <Tooltip>
            <TooltipTrigger
                render={
                    <span className="inline-flex">
                        <AnimatedThemeToggler
                            theme={resolvedThemeMode}
                            onThemeChange={(nextThemeMode) => {
                                void setThemeModePreference(
                                    nextThemeMode
                                ).catch((error: unknown) => {
                                    console.warn(
                                        'Theme mode change failed:',
                                        error
                                    );
                                });
                            }}
                            aria-label={themeToggleLabel}
                            className={cn(
                                buttonVariants({
                                    variant: 'ghost',
                                    size: 'icon-sm'
                                }),
                                'text-muted-foreground hover:text-foreground size-7 min-w-7 rounded-md px-0 hover:bg-(--state-hover-surface)'
                            )}
                        />
                    </span>
                }
            />
            <TooltipContent hidden={shortcutHintsVisible}>
                {themeToggleLabel}
            </TooltipContent>
        </Tooltip>
    ) : backgroundImageRotating ? (
        <TitleBarButton
            label={t('view.background_image.action.change_image')}
            className="size-7 min-w-7 rounded-md px-0"
            disabled={backgroundImageLoading}
            onClick={changeBackgroundImage}
        >
            <ShuffleIcon data-icon="icon" />
        </TitleBarButton>
    ) : null;

    const actions = isSessionReady ? (
        <div
            ref={actionsRef}
            className={cn(
                'relative flex h-full min-w-0 shrink-0 items-center gap-1',
                actionsClassName
            )}
        >
            {showUpdateUi ? (
                <TitleBarUpdateButton
                    onClick={() => {
                        if (
                            useRuntimeStore.getState().updateLoop
                                .autoDownloadState === 'downloading'
                        ) {
                            useRuntimeStore
                                .getState()
                                .setSystemHostOpen('updaterOpen', true);
                            return;
                        }
                        void openOrInstallLatestAvailableUpdate();
                    }}
                />
            ) : null}
            <div className="flex min-w-0 shrink items-center gap-1">
                <StatusBarHoverCard
                    icon={<SearchIcon />}
                    title={quickSearchLabel}
                    description={t('app_menu.title_bar_card.quick_search')}
                    actions={{
                        click: t('app_menu.title_bar_card.open_quick_search')
                    }}
                    suppressed={shortcutHintsVisible}
                    side="bottom"
                    trigger={
                        <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            aria-label={formatTitleBarShortcutLabel(
                                quickSearchLabel,
                                quickSearchShortcutLabel
                            )}
                            data-vrcx-0-control="toolbar"
                            className="vrcx-0-toolbar-control text-muted-foreground hover:text-foreground h-6 min-w-7 justify-start rounded-md border-0 px-2 shadow-none min-[640px]:w-44 min-[960px]:w-56"
                            onClick={openQuickSearch}
                        >
                            <SearchIcon data-icon="inline-start" />
                            <span className="hidden min-w-0 truncate min-[640px]:block">
                                {quickSearchLabel}
                            </span>
                            <KeyboardShortcut
                                keys={[isMacHost ? 'Meta' : 'Mod', 'K']}
                                kbdClassName={SHORTCUT_KBD_CLASS}
                                className="ml-auto hidden gap-0.5 min-[760px]:inline-flex"
                            />
                        </Button>
                    }
                />
            </div>
            {notificationAction}
            <StatusBarHoverCard
                icon={<SparklesIcon />}
                title={t('assistant.title')}
                description={t('assistant.empty_description')}
                actions={{ click: t('app_menu.title_bar_card.open_assistant') }}
                suppressed={shortcutHintsVisible}
                side="bottom"
                trigger={
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('assistant.title')}
                        className={TITLE_BAR_ICON_BUTTON_CLASS}
                        onClick={() =>
                            useAssistantChatStore.getState().setOpen(true)
                        }
                    >
                        <SparklesIcon data-icon="icon" />
                    </Button>
                }
            />
            {appearanceAction}
            {alwaysOnTopButton}
            {sidebarWindowModeButton}
            <TitleBarGroupSeparator />
            <TitleBarButton
                label={rightSidebarLabel}
                className="size-7 min-w-7 rounded-md px-0"
                onClick={toggleRightSidebar}
            >
                {rightSidebarOpen ? (
                    <PanelRightIcon data-icon="icon" />
                ) : (
                    <PanelRightOpenIcon data-icon="icon" />
                )}
            </TitleBarButton>
            {shortcutHintsVisible ? (
                <ShortcutHintPanel
                    ref={placeShortcutHintPanel}
                    className="motion-safe:slide-in-from-top-1 fixed mt-2 mr-1 origin-top-right"
                    groups={[
                        [
                            {
                                icon: <SearchIcon />,
                                id: 'titlebar-quick-search',
                                keys: 'K',
                                label: quickSearchLabel
                            },
                            {
                                icon: <CompassIcon />,
                                id: 'titlebar-direct-access',
                                keys: 'D',
                                label: directAccessLabel
                            },
                            {
                                icon: rightSidebarOpen ? (
                                    <PanelRightIcon />
                                ) : (
                                    <PanelRightOpenIcon />
                                ),
                                id: 'titlebar-right-sidebar',
                                keys: ['Shift', 'B'],
                                label: rightSidebarLabel
                            },
                            {
                                icon: <KeyboardIcon />,
                                id: 'titlebar-keyboard-shortcuts',
                                keys: '/',
                                label: t('app_menu.keyboard_shortcuts')
                            }
                        ]
                    ]}
                />
            ) : null}
        </div>
    ) : null;

    return {
        isSessionReady,
        actions,
        openQuickSearch,
        openDirectAccessFromClipboard,
        openNotificationCenter: openVrcNotificationCenter,
        toggleRightSidebar,
        rightSidebarOpen,
        alwaysOnTopButton,
        sidebarWindowModeButton,
        notificationAction,
        appearanceAction
    };
}
