import { ArrowUpIcon, AtSignIcon, SquareIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { MentionTarget } from '@/domain/assistant/types';
import type { FriendRecord } from '@/domain/friends/types';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { Button } from '@/ui/shadcn/button';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupTextarea
} from '@/ui/shadcn/input-group';

import { encodeMentions, findMentionQuery } from '../mentions';
import { MentionMenu } from './MentionMenu';

const MENTION_CANDIDATE_LIMIT = 8;

interface ComposerProps {
    busy: boolean;
    disabled: boolean;
    suggestions?: Array<{ label: string; text: string }>;
    mentioned?: MentionTarget | null;
    toolbar?: ReactNode;
    onSend: (text: string) => void;
    onStop: () => void;
}

export function Composer({
    busy,
    disabled,
    suggestions,
    mentioned,
    toolbar,
    onSend,
    onStop
}: ComposerProps) {
    const { t } = useTranslation();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [value, setValue] = useState(() =>
        mentioned ? `@${mentioned.name} ` : ''
    );
    const [mentions, setMentions] = useState<Record<string, MentionTarget>>(
        () => (mentioned ? { [mentioned.name]: mentioned } : {})
    );
    const [mention, setMention] = useState<{
        start: number;
        query: string;
    } | null>(null);
    const [dismissedAt, setDismissedAt] = useState<number | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const orderedFriendIds = useFriendRosterStore(
        (state) => state.orderedFriendIds
    );

    const candidates = useMemo(() => {
        if (!mention || mention.start === dismissedAt) {
            return [];
        }
        const query = mention.query.toLowerCase();
        const matches: FriendRecord[] = [];
        const prefixed: FriendRecord[] = [];
        for (const id of orderedFriendIds) {
            const friend = friendsById[id];
            const name = friend?.displayName.toLowerCase();
            if (!name?.includes(query)) {
                continue;
            }
            (name.startsWith(query) ? prefixed : matches).push(friend);
        }
        return [...prefixed, ...matches].slice(0, MENTION_CANDIDATE_LIMIT);
    }, [mention, dismissedAt, orderedFriendIds, friendsById]);
    const menuOpen = candidates.length > 0;

    useEffect(() => {
        const textarea = textareaRef.current;
        if (mentioned && textarea) {
            textarea.focus();
            textarea.setSelectionRange(
                textarea.value.length,
                textarea.value.length
            );
        }
    }, [mentioned]);

    const syncMention = (textarea: HTMLTextAreaElement) => {
        const next = findMentionQuery(textarea.value, textarea.selectionStart);
        setMention((current) =>
            current?.start === next?.start && current?.query === next?.query
                ? current
                : next
        );
        if (!next) {
            setDismissedAt(null);
        }
        setActiveIndex(0);
    };

    const replaceRange = (start: number, end: number, insert: string) => {
        const next = value.slice(0, start) + insert + value.slice(end);
        const caret = start + insert.length;
        setValue(next);
        requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (textarea) {
                textarea.focus();
                textarea.setSelectionRange(caret, caret);
                syncMention(textarea);
            }
        });
    };

    const pickFriend = (friend: FriendRecord) => {
        if (!mention) {
            return;
        }
        setMentions((current) => ({
            ...current,
            [friend.displayName]: {
                kind: 'user',
                id: friend.id,
                name: friend.displayName
            }
        }));
        setMention(null);
        replaceRange(
            mention.start,
            mention.start + 1 + mention.query.length,
            `@${friend.displayName} `
        );
    };

    const startMention = () => {
        const textarea = textareaRef.current;
        const caret = textarea?.selectionStart ?? value.length;
        const spacer = caret > 0 && !/\s/.test(value[caret - 1]) ? ' ' : '';
        setDismissedAt(null);
        replaceRange(caret, textarea?.selectionEnd ?? caret, `${spacer}@`);
    };

    const submit = () => {
        const text = value.trim();
        if (!text || disabled) {
            return;
        }
        onSend(encodeMentions(text, mentions));
        setValue('');
        setMentions({});
        setMention(null);
    };

    return (
        <form
            className="mx-auto w-full max-w-3xl px-6 pb-3"
            onSubmit={(event) => {
                event.preventDefault();
                submit();
            }}
        >
            {suggestions?.length ? (
                <div className="mb-2 flex [scrollbar-width:none] gap-2 overflow-x-auto overscroll-x-contain">
                    {suggestions.map((suggestion) => (
                        <Button
                            key={suggestion.text}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-muted-foreground hover:text-foreground shrink-0 rounded-full font-normal"
                            onClick={() => onSend(suggestion.text)}
                        >
                            {suggestion.label}
                        </Button>
                    ))}
                </div>
            ) : null}
            <div className="relative">
                {menuOpen && (
                    <MentionMenu
                        label={t('assistant.mention.list')}
                        candidates={candidates}
                        activeIndex={activeIndex}
                        onPick={pickFriend}
                        onHover={setActiveIndex}
                    />
                )}
                <InputGroup className="dark:has-disabled:bg-input/30 border-border/70 rounded-2xl shadow-sm has-disabled:bg-transparent has-disabled:opacity-100">
                    <InputGroupTextarea
                        ref={textareaRef}
                        value={value}
                        disabled={disabled}
                        onChange={(event) => {
                            setValue(event.target.value);
                            syncMention(event.target);
                        }}
                        onSelect={(event) => syncMention(event.currentTarget)}
                        onBlur={() => setMention(null)}
                        onKeyDown={(event) => {
                            if (event.nativeEvent.isComposing) {
                                return;
                            }
                            if (menuOpen) {
                                if (event.key === 'ArrowDown') {
                                    event.preventDefault();
                                    setActiveIndex(
                                        (activeIndex + 1) % candidates.length
                                    );
                                    return;
                                }
                                if (event.key === 'ArrowUp') {
                                    event.preventDefault();
                                    setActiveIndex(
                                        (activeIndex - 1 + candidates.length) %
                                            candidates.length
                                    );
                                    return;
                                }
                                if (
                                    event.key === 'Enter' ||
                                    event.key === 'Tab'
                                ) {
                                    event.preventDefault();
                                    pickFriend(candidates[activeIndex]);
                                    return;
                                }
                                if (event.key === 'Escape') {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setDismissedAt(mention?.start ?? null);
                                    return;
                                }
                            }
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                submit();
                            }
                        }}
                        placeholder={t('assistant.composer_placeholder')}
                        className="max-h-48 min-h-14 px-3.5 pt-3"
                        rows={2}
                    />
                    <InputGroupAddon align="block-end" className="gap-1">
                        <InputGroupButton
                            size="icon-sm"
                            disabled={disabled}
                            title={t('assistant.mention.add')}
                            aria-label={t('assistant.mention.add')}
                            onClick={startMention}
                        >
                            <AtSignIcon />
                        </InputGroupButton>
                        {toolbar}
                        {busy ? (
                            <InputGroupButton
                                size="icon-sm"
                                variant="secondary"
                                onClick={onStop}
                                title={t('assistant.stop')}
                                aria-label={t('assistant.stop')}
                                className="ml-auto rounded-full"
                            >
                                <SquareIcon />
                            </InputGroupButton>
                        ) : (
                            <InputGroupButton
                                type="submit"
                                size="icon-sm"
                                variant="default"
                                disabled={disabled || !value.trim()}
                                title={t('assistant.send')}
                                aria-label={t('assistant.send')}
                                className="ml-auto rounded-full"
                            >
                                <ArrowUpIcon />
                            </InputGroupButton>
                        )}
                    </InputGroupAddon>
                </InputGroup>
            </div>
            <p className="text-muted-foreground/70 mt-2 text-center text-[11px]">
                {t('assistant.disclaimer')}
            </p>
        </form>
    );
}
