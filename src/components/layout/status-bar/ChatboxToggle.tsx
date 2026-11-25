import {
    MessageSquareDashedIcon,
    MessageSquareIcon,
    MessageSquareTextIcon
} from 'lucide-react';
import { type ReactElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { cn } from '@/lib/utils';
import { commands, type ChatboxConfig } from '@/platform/tauri/bindings';
import { chatboxStatusLabelKey } from '@/services/chatboxStatusLabel';
import { toast } from '@/services/toastService';
import { useChatboxStore } from '@/state/chatboxStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import {
    ContextMenu,
    ContextMenuCheckboxItem,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';

import { StatusBarHoverCard } from './StatusBarHoverCard';
import {
    STATUS_BAR_TOGGLE_ACTIVE,
    STATUS_BAR_TOGGLE_IDLE
} from './statusBarToggle';

export function ChatboxToggle(): ReactElement | null {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [updating, setUpdating] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const available = useRuntimeStore(
        (state) => state.hostCapabilities.gameProcessMonitor.available
    );
    const config = useChatboxStore((state) => state.savedConfig);
    const status = useChatboxStore((state) => state.status);

    useEffect(() => {
        if (!available) {
            return;
        }
        const store = useChatboxStore.getState();
        if (!store.savedConfig) {
            commands.appChatboxEditorStateGet().then(
                ({ config: loaded }) => {
                    if (!useChatboxStore.getState().savedConfig) {
                        useChatboxStore.getState().setSavedConfig(loaded);
                    }
                },
                (error: unknown) => {
                    console.warn('Failed to load Chatbox settings:', error);
                }
            );
        }
        if (!store.status) {
            commands.appChatboxStatusGet().then(
                (loaded) => {
                    if (loaded && !useChatboxStore.getState().status) {
                        useChatboxStore.getState().setStatus(loaded);
                    }
                },
                (error: unknown) => {
                    console.warn('Failed to load Chatbox status:', error);
                }
            );
        }
    }, [available]);

    if (!available || !config) {
        return null;
    }

    async function update(request: () => Promise<ChatboxConfig>) {
        setUpdating(true);
        try {
            useChatboxStore.getState().setSavedConfig(await request());
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.tools.chatbox.save_failed')
            });
        } finally {
            setUpdating(false);
        }
    }

    const enabled = config.statusEnabled;
    const paused = status?.pauseReason != null;
    let Icon = MessageSquareIcon;
    if (enabled || status?.manualAfk) {
        Icon = paused ? MessageSquareDashedIcon : MessageSquareTextIcon;
    }
    const stateLabel = status
        ? t(chatboxStatusLabelKey(status))
        : t(
              enabled
                  ? 'view.tools.chatbox.status.showing'
                  : 'view.tools.chatbox.status.off'
          );
    const title = t('view.tools.chatbox.title');

    return (
        <ContextMenu onOpenChange={setMenuOpen}>
            <StatusBarHoverCard
                icon={<Icon />}
                title={title}
                state={stateLabel}
                description={t('view.tools.chatbox.description')}
                actions={{
                    click: t('status_bar.card.chatbox_click'),
                    rightClick: t('status_bar.card.chatbox_right_click')
                }}
                suppressed={menuOpen}
                trigger={
                    <ContextMenuTrigger
                        render={
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`${title} · ${stateLabel}`}
                                aria-pressed={enabled}
                                disabled={updating}
                                className={cn(
                                    'size-6 shrink-0 rounded-none',
                                    enabled
                                        ? STATUS_BAR_TOGGLE_ACTIVE
                                        : STATUS_BAR_TOGGLE_IDLE
                                )}
                                onClick={() =>
                                    void update(() =>
                                        commands.appChatboxStatusEnabledSet(
                                            !enabled
                                        )
                                    )
                                }
                            >
                                <Icon data-icon="icon" />
                            </Button>
                        }
                    />
                }
            >
                {status?.preview ? (
                    <div className="bg-muted/50 rounded-md px-2 py-1.5 whitespace-pre-line">
                        {status.preview}
                    </div>
                ) : null}
            </StatusBarHoverCard>
            <ContextMenuContent className="w-64">
                <ContextMenuCheckboxItem
                    checked={enabled}
                    disabled={updating}
                    onClick={() =>
                        void update(() =>
                            commands.appChatboxStatusEnabledSet(!enabled)
                        )
                    }
                >
                    {t('view.tools.chatbox.pages.enabled')}
                </ContextMenuCheckboxItem>
                {config.pages.length > 0 ? (
                    <>
                        <ContextMenuSeparator />
                        <ContextMenuGroup>
                            <ContextMenuLabel>
                                {t('status_bar.chatbox_pages')}
                            </ContextMenuLabel>
                            {config.pages.map((page, index) => (
                                <ContextMenuCheckboxItem
                                    key={page.id}
                                    checked={page.enabled}
                                    disabled={updating || !enabled}
                                    onClick={() =>
                                        void update(() =>
                                            commands.appChatboxPageEnabledSet(
                                                page.id,
                                                !page.enabled
                                            )
                                        )
                                    }
                                >
                                    <span className="flex min-w-0 flex-col">
                                        <span>
                                            {t(
                                                'view.tools.chatbox.pages.page',
                                                {
                                                    index: index + 1
                                                }
                                            )}
                                        </span>
                                        <span className="text-muted-foreground truncate text-xs">
                                            {page.lines
                                                .map((line) =>
                                                    line.template.replace(
                                                        /\s+/g,
                                                        ' '
                                                    )
                                                )
                                                .filter(Boolean)
                                                .join(' / ')}
                                        </span>
                                    </span>
                                </ContextMenuCheckboxItem>
                            ))}
                        </ContextMenuGroup>
                    </>
                ) : null}
                <ContextMenuSeparator />
                <ContextMenuCheckboxItem
                    checked={status?.manualAfk === true}
                    onClick={() =>
                        void commands.appChatboxAfkSet(
                            status?.manualAfk !== true
                        )
                    }
                >
                    {t('view.tools.chatbox.afk.go_afk')}
                </ContextMenuCheckboxItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => navigate('/tools/chatbox')}>
                    {t('status_bar.chatbox_open')}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
