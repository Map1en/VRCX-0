import {
    BellIcon,
    CompassIcon,
    KeyboardIcon,
    PanelLeftIcon,
    PanelLeftOpenIcon,
    PanelRightDashedIcon,
    PanelRightIcon,
    PanelRightOpenIcon,
    SearchIcon,
    SparklesIcon
} from 'lucide-react';
import {
    type ComponentProps,
    useCallback,
    useEffect,
    useState,
    type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';

import { KeyboardShortcut } from '@/components/keyboard/KeyboardShortcut';
import { ShortcutHintPanel } from '@/components/keyboard/ShortcutHintPanel';
import { QuickSearchDialog } from '@/components/sidebar/QuickSearchDialog';
import { cn } from '@/lib/utils';
import {
    setNavbarCollapsedPreference,
    setThemeModePreference
} from '@/services/preferencesService';
import { useResolvedThemeMode } from '@/services/themeService';
import {
    openOrInstallLatestAvailableUpdate,
    shouldShowUpdateUi
} from '@/services/updateInstallService';
import {
    enterSidebarWindowMode,
    restoreNormalWindowMode,
    runAfterRestoringNormalWindow
} from '@/services/windowModeService';
import { getBuildBadgeLabel } from '@/shared/buildLabel';
import { useAssistantChatStore } from '@/state/assistantChatStore';
import { useBackgroundImageStore } from '@/state/backgroundImageStore';
import {
    communityThemeControlsAppearance,
    useCommunityThemeStore
} from '@/state/communityThemeStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useShellStore } from '@/state/shellStore';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { useDirectAccessAction } from './directAccessAction';
import { TitleBarUpdateButton } from './TitleBarUpdateButton';
import { useRightSidePanelVisibility } from './useRightSidePanelVisibility';

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
                            'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
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
    sidebarWindowModeButton: ReactNode;
    notificationAction: ReactNode;
    themeToggleAction: ReactNode;
    quickSearchDialog: ReactNode;
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
    const [quickSearchOpen, setQuickSearchOpen] = useState(false);
    const { openDirectAccessFromClipboard } = useDirectAccessAction();
    const isSessionReady = useSessionStore(
        (state) => state.sessionPhase === 'ready'
    );
    const notificationLayout = usePreferencesStore(
        (state) => state.notificationLayout
    );
    const vrcUnseenNotificationCount = useVrcNotificationStore(
        (state) => state.unseenCount
    );
    const isVrcNotificationCenterOpen = useVrcNotificationStore(
        (state) => state.isCenterOpen
    );
    const openVrcNotificationCenter = useVrcNotificationStore(
        (state) => state.openCenter
    );
    const setVrcNotificationCenterOpen = useVrcNotificationStore(
        (state) => state.setCenterOpen
    );
    const markAllVrcNotificationsSeen = useVrcNotificationStore(
        (state) => state.markAllSeen
    );
    const removeNavNotification = useShellStore((state) => state.removeNotify);
    const hostPlatform = useRuntimeStore(
        (state) => state.hostCapabilities.platform
    );
    const showUpdateUi = useRuntimeStore((state) =>
        shouldShowUpdateUi(state.updateLoop)
    );
    const navbarOpen = useShellStore((state) => state.sidebarOpen);
    const sidebarWindowMode = useShellStore(
        (state) => state.windowDisplayMode === 'sidebar'
    );
    const shortcutHintsVisible = useShellStore(
        (state) => state.shortcutHintsVisible
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
    const {
        sidePanelOpen: rightSidebarOpen,
        toggleSidePanelOpen: toggleRightSidebar
    } = useRightSidePanelVisibility(location.pathname);

    const isMacHost = hostPlatform === 'macos';
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
    const leftSidebarLabel = navbarOpen
        ? t('nav_tooltip.collapse_nav')
        : t('nav_tooltip.expand_nav');
    const rightSidebarLabel = rightSidebarOpen
        ? t('app_menu.hide_friends_sidebar')
        : t('app_menu.show_friends_sidebar');
    const quickSearchShortcutLabel = getTitleBarShortcutLabel(isMacHost, 'K');
    const directAccessShortcutLabel = getTitleBarShortcutLabel(isMacHost, 'D');
    const quickSearchLabel = t('app_menu.quick_search');
    const directAccessLabel = t('prompt.direct_access_omni.header');
    const sidebarWindowModeLabel = sidebarWindowMode
        ? t('app_menu.restore_full_window')
        : t('app_menu.enter_sidebar_mode');

    const openQuickSearch = useCallback(() => {
        setQuickSearchOpen(true);
    }, []);

    const toggleSidebarWindowMode = useCallback(() => {
        const transition = sidebarWindowMode
            ? restoreNormalWindowMode()
            : enterSidebarWindowMode();
        void transition.catch((error: unknown) => {
            console.warn('Failed to change the window display mode:', error);
        });
    }, [sidebarWindowMode]);

    const sidebarWindowModeButton = (
        <TitleBarButton
            label={sidebarWindowModeLabel}
            aria-pressed={sidebarWindowMode}
            className="ml-1 size-7 min-w-7 rounded-md px-0"
            onClick={toggleSidebarWindowMode}
        >
            <PanelRightDashedIcon data-icon="icon" />
        </TitleBarButton>
    );

    useEffect(() => {
        if (!isSessionReady) {
            return undefined;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            const hasModifier = isMacHost
                ? event.metaKey
                : event.ctrlKey || event.metaKey;
            if (!hasModifier) {
                return;
            }

            const key = event.key.toLowerCase();
            if (key === 'k') {
                event.preventDefault();
                setQuickSearchOpen(true);
                return;
            }
            if (key === 'd') {
                event.preventDefault();
                openDirectAccessFromClipboard();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isSessionReady, isMacHost, openDirectAccessFromClipboard]);

    async function markAllNotificationsRead() {
        const store = useVrcNotificationStore.getState();
        if (!store.unseenCount) {
            removeNavNotification('notification');
            return;
        }

        try {
            await markAllVrcNotificationsSeen();
            removeNavNotification('notification');
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.app_title_bar.toast.failed_to_mark_notifications_as_seen'
                      )
            );
        }
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
        <TitleBarButton
            label={t('side_panel.notification_center.title')}
            className="relative size-7 min-w-7 rounded-md px-0"
            onClick={openNotifications}
            onContextMenu={
                vrcUnseenNotificationCount > 0
                    ? undefined
                    : (event: React.MouseEvent) => {
                          event.preventDefault();
                          toast.info(
                              t(
                                  'side_panel.notification_center.no_unseen_notifications'
                              )
                          );
                      }
            }
        >
            <BellIcon data-icon="icon" />
            {vrcUnseenNotificationCount > 0 ? (
                <Badge className="absolute top-0.5 right-1 h-3 min-w-3 rounded-full px-0.5 py-0 text-[7px] leading-none">
                    {vrcUnseenNotificationCount > 99
                        ? '99+'
                        : vrcUnseenNotificationCount}
                </Badge>
            ) : null}
        </TitleBarButton>
    );

    const notificationAction = notificationActionVisible ? (
        vrcUnseenNotificationCount > 0 ? (
            <ContextMenu>
                <ContextMenuTrigger render={notificationButton} />
                <ContextMenuContent className="w-48">
                    <ContextMenuGroup>
                        <ContextMenuItem
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
            notificationButton
        )
    ) : null;

    const themeToggleAction = themeToggleVisible ? (
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
                                'text-muted-foreground hover:bg-muted/40 hover:text-foreground size-7 min-w-7 rounded-md px-0'
                            )}
                        />
                    </span>
                }
            />
            <TooltipContent hidden={shortcutHintsVisible}>
                {themeToggleLabel}
            </TooltipContent>
        </Tooltip>
    ) : null;

    const actions = isSessionReady ? (
        <div
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
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                aria-label={formatTitleBarShortcutLabel(
                                    quickSearchLabel,
                                    quickSearchShortcutLabel
                                )}
                                className="bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground h-6 min-w-7 justify-start rounded-md border-0 px-2 shadow-none min-[640px]:w-44 min-[960px]:w-56"
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
                    <TooltipContent hidden={shortcutHintsVisible}>
                        {formatTitleBarShortcutLabel(
                            quickSearchLabel,
                            quickSearchShortcutLabel
                        )}
                    </TooltipContent>
                </Tooltip>
                <TitleBarButton
                    label={formatTitleBarShortcutLabel(
                        directAccessLabel,
                        directAccessShortcutLabel
                    )}
                    className="size-7 min-w-7 rounded-md px-0"
                    onClick={openDirectAccessFromClipboard}
                >
                    <CompassIcon data-icon="icon" />
                </TitleBarButton>
            </div>
            {notificationAction}
            <TitleBarButton
                label={t('assistant.title')}
                className="size-7 min-w-7 rounded-md px-0"
                onClick={() => useAssistantChatStore.getState().setOpen(true)}
            >
                <SparklesIcon data-icon="icon" />
            </TitleBarButton>
            {themeToggleAction}
            <TitleBarButton
                label={leftSidebarLabel}
                className="size-7 min-w-7 rounded-md px-0"
                onClick={() => {
                    setNavbarCollapsedPreference(navbarOpen);
                }}
            >
                {navbarOpen ? (
                    <PanelLeftIcon data-icon="icon" />
                ) : (
                    <PanelLeftOpenIcon data-icon="icon" />
                )}
            </TitleBarButton>
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
            {sidebarWindowModeButton}
            {shortcutHintsVisible ? (
                <ShortcutHintPanel
                    className="motion-safe:slide-in-from-top-1 absolute top-[calc(100%+0.5rem)] right-1 origin-top-right"
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
                                icon: navbarOpen ? (
                                    <PanelLeftIcon />
                                ) : (
                                    <PanelLeftOpenIcon />
                                ),
                                id: 'titlebar-left-sidebar',
                                keys: 'B',
                                label: leftSidebarLabel
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

    const quickSearchDialog = isSessionReady ? (
        <QuickSearchDialog
            open={quickSearchOpen}
            onOpenChange={setQuickSearchOpen}
        />
    ) : null;

    return {
        isSessionReady,
        actions,
        quickSearchDialog,
        openQuickSearch,
        openDirectAccessFromClipboard,
        openNotificationCenter: openVrcNotificationCenter,
        toggleRightSidebar,
        rightSidebarOpen,
        sidebarWindowModeButton,
        notificationAction,
        themeToggleAction
    };
}
