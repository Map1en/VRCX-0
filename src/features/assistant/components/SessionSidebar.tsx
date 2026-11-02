import { Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { useAssistantChatStore } from '@/state/assistantChatStore';
import { Button } from '@/ui/shadcn/button';
import { ScrollArea } from '@/ui/shadcn/scroll-area';

import {
    deleteSession,
    openSession,
    startNewSession
} from '../assistantActions';

export function SessionSidebar() {
    const { t } = useTranslation();
    const sessions = useAssistantChatStore((state) => state.sessions);
    const activeSessionId = useAssistantChatStore(
        (state) => state.activeSessionId
    );

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="p-2">
                <Button
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground w-full justify-start gap-2"
                    onClick={() => startNewSession()}
                >
                    <PlusIcon className="size-4" />
                    {t('assistant.new_chat')}
                </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
                <div className="flex flex-col gap-0.5 p-2 pt-0">
                    {sessions.length === 0 ? (
                        <p className="text-muted-foreground px-2 py-4 text-center text-xs">
                            {t('assistant.sessions_empty')}
                        </p>
                    ) : (
                        <p className="text-muted-foreground/70 px-2.5 pt-2 pb-1 text-xs font-medium">
                            {t('assistant.recent')}
                        </p>
                    )}
                    {sessions.map((session) => (
                        <div
                            key={session.id}
                            className={cn(
                                'group flex items-center gap-1 rounded-lg text-sm transition-colors',
                                session.id === activeSessionId
                                    ? 'text-foreground bg-(--state-pressed-surface)'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-(--state-hover-surface)'
                            )}
                        >
                            <button
                                type="button"
                                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left"
                                onClick={() => openSession(session.id)}
                            >
                                {session.busy && (
                                    <Loader2Icon className="text-muted-foreground size-3 shrink-0 animate-spin" />
                                )}
                                <span className="min-w-0 flex-1 truncate">
                                    {session.title || t('assistant.untitled')}
                                </span>
                            </button>
                            <button
                                type="button"
                                className="mr-2 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                                onClick={() => deleteSession(session.id)}
                                title={t('common.actions.delete')}
                            >
                                <Trash2Icon className="text-muted-foreground hover:text-destructive size-3.5" />
                            </button>
                        </div>
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}
