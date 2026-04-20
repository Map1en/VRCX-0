import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { OpenSourceNoticeDialog } from '@/features/settings/components/OpenSourceNoticeDialog.jsx';
import { openExternalLink } from '@/lib/entityMedia.js';
import { backend } from '@/platform/index.js';
import { logoutFromReactShell } from '@/services/authExecutionService.js';
import { setZoomLevelPreference } from '@/services/preferencesService.js';
import {
    formatZoomPercentage,
    normalizeZoomLevel
} from '@/services/themeService.js';
import { triggerToolByKey } from '@/services/toolActionService.js';
import { links } from '@/shared/constants/link.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Menubar,
    MenubarContent,
    MenubarGroup,
    MenubarItem,
    MenubarMenu,
    MenubarSeparator,
    MenubarShortcut,
    MenubarTrigger
} from '@/ui/shadcn/menubar';

const ZOOM_STEP = 10;

function MenuItem({ children, onSelect, ...props }) {
    return (
        <MenubarItem
            className="min-h-7 min-w-48 text-xs"
            onSelect={onSelect}
            {...props}
        >
            {children}
        </MenubarItem>
    );
}

function ToolMenuItem({ toolKey, children, navigate, t }) {
    return (
        <MenuItem
            onSelect={() => void triggerToolByKey(toolKey, { navigate, t })}
        >
            {children}
        </MenuItem>
    );
}

export function AppMenuBar({
    rightSidebarVisible,
    rightSidebarOpen,
    onOpenQuickSearch,
    onOpenNotificationCenter,
    onToggleRightSidebar
}) {
    const { t } = useI18n();
    const navigate = useNavigate();
    const [aboutOpen, setAboutOpen] = useState(false);
    const [openSourceNoticeOpen, setOpenSourceNoticeOpen] = useState(false);
    const zoomLevel = useShellStore((state) => state.zoomLevel);
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );
    const currentZoom = normalizeZoomLevel(zoomLevel);

    async function applyZoomLevel(nextZoom) {
        try {
            await setZoomLevelPreference(nextZoom);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('app_menu.messages.zoom_failed')
            );
        }
    }

    async function runLogout() {
        try {
            await logoutFromReactShell();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('app_menu.messages.logout_failed')
            );
        }
    }

    function openLink(url) {
        void openExternalLink(url);
    }

    return (
        <>
            <Menubar className="h-7 border-0 bg-transparent p-0 shadow-none">
                <MenubarMenu>
                    <MenubarTrigger className="h-7 rounded px-2 py-0 text-xs">
                        {t('app_menu.app')}
                    </MenubarTrigger>
                    <MenubarContent align="start">
                        <MenubarGroup>
                            <MenuItem onSelect={() => navigate('/settings')}>
                                {t('app_menu.settings')}
                            </MenuItem>
                            <MenuItem
                                onSelect={() =>
                                    setSystemHostOpen('updaterOpen', true)
                                }
                            >
                                {t('app_menu.check_updates')}
                            </MenuItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenuItem onSelect={() => void runLogout()}>
                                {t('app_menu.logout')}
                            </MenuItem>
                            <MenuItem
                                variant="destructive"
                                onSelect={() =>
                                    void backend.webview.closeWindow()
                                }
                            >
                                {t('app_menu.quit')}
                            </MenuItem>
                        </MenubarGroup>
                    </MenubarContent>
                </MenubarMenu>

                <MenubarMenu>
                    <MenubarTrigger className="h-7 rounded px-2 py-0 text-xs">
                        {t('app_menu.view')}
                    </MenubarTrigger>
                    <MenubarContent align="start">
                        <MenubarGroup>
                            <MenuItem onSelect={() => onOpenQuickSearch?.()}>
                                {t('app_menu.quick_search')}
                                <MenubarShortcut className="tracking-normal">
                                    Ctrl+K
                                </MenubarShortcut>
                            </MenuItem>
                            <MenuItem
                                onSelect={() => onOpenNotificationCenter?.()}
                            >
                                {t('app_menu.notification_center')}
                            </MenuItem>
                            {rightSidebarVisible ? (
                                <MenuItem
                                    onSelect={() => onToggleRightSidebar?.()}
                                >
                                    {t(
                                        rightSidebarOpen
                                            ? 'app_menu.collapse_friends_sidebar'
                                            : 'app_menu.expand_friends_sidebar'
                                    )}
                                </MenuItem>
                            ) : null}
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenuItem
                                onSelect={() =>
                                    void applyZoomLevel(currentZoom + ZOOM_STEP)
                                }
                            >
                                {t('app_menu.zoom_in')}
                                <MenubarShortcut className="tracking-normal">
                                    {formatZoomPercentage(
                                        currentZoom + ZOOM_STEP
                                    )}
                                </MenubarShortcut>
                            </MenuItem>
                            <MenuItem
                                onSelect={() =>
                                    void applyZoomLevel(currentZoom - ZOOM_STEP)
                                }
                            >
                                {t('app_menu.zoom_out')}
                                <MenubarShortcut className="tracking-normal">
                                    {formatZoomPercentage(
                                        currentZoom - ZOOM_STEP
                                    )}
                                </MenubarShortcut>
                            </MenuItem>
                            <MenuItem onSelect={() => void applyZoomLevel(100)}>
                                {t('app_menu.reset_zoom')}
                                <MenubarShortcut className="tracking-normal">
                                    {formatZoomPercentage(100)}
                                </MenubarShortcut>
                            </MenuItem>
                        </MenubarGroup>
                    </MenubarContent>
                </MenubarMenu>

                <MenubarMenu>
                    <MenubarTrigger className="h-7 rounded px-2 py-0 text-xs">
                        {t('app_menu.tools')}
                    </MenubarTrigger>
                    <MenubarContent align="start">
                        <MenubarGroup>
                            <MenuItem onSelect={() => navigate('/tools')}>
                                {t('app_menu.all_tools')}
                            </MenuItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <ToolMenuItem
                                toolKey="screenshot-metadata"
                                navigate={navigate}
                                t={t}
                            >
                                {t('view.tools.pictures.screenshot')}
                            </ToolMenuItem>
                            <ToolMenuItem
                                toolKey="gallery"
                                navigate={navigate}
                                t={t}
                            >
                                {t('view.tools.pictures.gallery')}
                            </ToolMenuItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <ToolMenuItem
                                toolKey="vrchat-config"
                                navigate={navigate}
                                t={t}
                            >
                                {t('view.tools.system_tools.vrchat_config')}
                            </ToolMenuItem>
                            <ToolMenuItem
                                toolKey="launch-options"
                                navigate={navigate}
                                t={t}
                            >
                                {t(
                                    'view.settings.advanced.advanced.launch_options'
                                )}
                            </ToolMenuItem>
                            <ToolMenuItem
                                toolKey="registry-backup"
                                navigate={navigate}
                                t={t}
                            >
                                {t(
                                    'view.settings.advanced.advanced.vrc_registry_backup'
                                )}
                            </ToolMenuItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <ToolMenuItem
                                toolKey="export-friend-list"
                                navigate={navigate}
                                t={t}
                            >
                                {t('view.tools.export.export_friend_list')}
                            </ToolMenuItem>
                            <ToolMenuItem
                                toolKey="export-own-avatars"
                                navigate={navigate}
                                t={t}
                            >
                                {t('view.tools.export.export_own_avatars')}
                            </ToolMenuItem>
                            <ToolMenuItem
                                toolKey="export-notes"
                                navigate={navigate}
                                t={t}
                            >
                                {t('view.tools.export.export_notes')}
                            </ToolMenuItem>
                        </MenubarGroup>
                    </MenubarContent>
                </MenubarMenu>

                <MenubarMenu>
                    <MenubarTrigger className="h-7 rounded px-2 py-0 text-xs">
                        {t('app_menu.help')}
                    </MenubarTrigger>
                    <MenubarContent align="start">
                        <MenubarGroup>
                            <MenuItem onSelect={() => openLink(links.github)}>
                                {t('app_menu.github')}
                            </MenuItem>
                            <MenuItem onSelect={() => openLink(links.issues)}>
                                {t('app_menu.report_issue')}
                            </MenuItem>
                            <MenuItem onSelect={() => openLink(links.discord)}>
                                {t('nav_menu.discord')}
                            </MenuItem>
                        </MenubarGroup>
                        <MenubarSeparator />
                        <MenubarGroup>
                            <MenuItem
                                onSelect={() => setOpenSourceNoticeOpen(true)}
                            >
                                {t('app_menu.open_source_licenses')}
                            </MenuItem>
                            <MenuItem onSelect={() => setAboutOpen(true)}>
                                {t('app_menu.about')}
                            </MenuItem>
                        </MenubarGroup>
                    </MenubarContent>
                </MenubarMenu>
            </Menubar>

            <OpenSourceNoticeDialog
                open={openSourceNoticeOpen}
                onOpenChange={setOpenSourceNoticeOpen}
                t={t}
            />

            <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
                <DialogContent showCloseButton={false}>
                    <DialogHeader>
                        <DialogTitle>{t('app_menu.about_title')}</DialogTitle>
                        <DialogDescription>
                            {t('app_menu.about_description')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="bg-muted/30 rounded-lg border p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">
                                {t('app_menu.version')}
                            </span>
                            <span className="font-medium">
                                {VERSION || '-'}
                            </span>
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button type="button" variant="outline">
                                {t('app_menu.close')}
                            </Button>
                        </DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
