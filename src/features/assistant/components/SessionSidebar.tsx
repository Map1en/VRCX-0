import {
    Loader2Icon,
    MoreHorizontalIcon,
    PencilIcon,
    PinIcon,
    PinOffIcon,
    PlusIcon,
    Trash2Icon
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SessionSummary } from '@/domain/assistant/types';
import { useTodayDate } from '@/lib/useTodayDate';
import { cn } from '@/lib/utils';
import { useAssistantChatStore } from '@/state/assistantChatStore';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { ScrollArea } from '@/ui/shadcn/scroll-area';

import {
    deleteSession,
    openSession,
    renameSession,
    setSessionPinned,
    startNewSession
} from '../assistantActions';
import { groupSessions } from '../sessionGroups';

function SessionTitleEditor({
    title,
    onDone
}: {
    title: string;
    onDone: (title: string | null) => void;
}) {
    const [value, setValue] = useState(title);
    return (
        <input
            autoFocus
            value={value}
            maxLength={80}
            className="text-foreground min-w-0 flex-1 bg-transparent px-2.5 py-1.5 outline-none"
            onChange={(event) => setValue(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={() => onDone(value)}
            onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) {
                    return;
                }
                if (event.key === 'Enter') {
                    event.currentTarget.blur();
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    onDone(null);
                }
            }}
        />
    );
}

function SessionRow({
    session,
    active
}: {
    session: SessionSummary;
    active: boolean;
}) {
    const { t } = useTranslation();
    const [editing, setEditing] = useState(false);
    const title = session.title || t('assistant.untitled');

    return (
        <div
            className={cn(
                'group flex items-center gap-1 rounded-lg text-sm transition-colors',
                active || editing
                    ? 'text-foreground bg-(--state-pressed-surface)'
                    : 'text-muted-foreground hover:text-foreground hover:bg-(--state-hover-surface)'
            )}
        >
            {editing ? (
                <SessionTitleEditor
                    title={session.title}
                    onDone={(next) => {
                        setEditing(false);
                        if (next !== null && next.trim() !== session.title) {
                            void renameSession(session.id, next);
                        }
                    }}
                />
            ) : (
                <button
                    type="button"
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left"
                    onClick={() => openSession(session.id)}
                    onDoubleClick={() => setEditing(true)}
                >
                    {session.busy && (
                        <Loader2Icon className="text-muted-foreground size-3 shrink-0 animate-spin" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{title}</span>
                </button>
            )}
            {!editing && (
                <DropdownMenu>
                    <DropdownMenuTrigger
                        className="text-muted-foreground hover:text-foreground data-popup-open:text-foreground mr-1.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
                        title={t('assistant.session_menu.more')}
                        aria-label={t('assistant.session_menu.more')}
                    >
                        <MoreHorizontalIcon className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="start"
                        className="w-40"
                        finalFocus={false}
                    >
                        <DropdownMenuItem
                            onClick={() =>
                                setSessionPinned(session.id, !session.pinned)
                            }
                        >
                            {session.pinned ? <PinOffIcon /> : <PinIcon />}
                            {t(
                                session.pinned
                                    ? 'assistant.session_menu.unpin'
                                    : 'assistant.session_menu.pin'
                            )}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setEditing(true)}>
                            <PencilIcon />
                            {t('assistant.session_menu.rename')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            variant="destructive"
                            onClick={() => deleteSession(session.id)}
                        >
                            <Trash2Icon />
                            {t('common.actions.delete')}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    );
}

export function SessionSidebar() {
    const { t } = useTranslation();
    const sessions = useAssistantChatStore((state) => state.sessions);
    const activeSessionId = useAssistantChatStore(
        (state) => state.activeSessionId
    );
    const today = useTodayDate();
    const groups = useMemo(
        () => groupSessions(sessions, today),
        [sessions, today]
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
                    {sessions.length === 0 && (
                        <p className="text-muted-foreground px-2 py-4 text-center text-xs">
                            {t('assistant.sessions_empty')}
                        </p>
                    )}
                    {groups.map((group) => (
                        <section
                            key={group.key}
                            className="flex flex-col gap-0.5"
                        >
                            <p className="text-muted-foreground/70 px-2.5 pt-2 pb-1 text-xs font-medium">
                                {t(`assistant.session_group.${group.key}`)}
                            </p>
                            {group.sessions.map((session) => (
                                <SessionRow
                                    key={session.id}
                                    session={session}
                                    active={session.id === activeSessionId}
                                />
                            ))}
                        </section>
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}
