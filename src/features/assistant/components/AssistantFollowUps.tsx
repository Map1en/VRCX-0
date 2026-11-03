import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type {
    AssistantDraft,
    MentionTarget,
    UIMessage
} from '@/domain/assistant/types';
import { useFriendRosterStore } from '@/state/friendRosterStore';

import { mentionToken } from '../mentions';

const PROMPT_LIMIT = 4;
const BRIEF_PROMPTS = ['assistant.brief.prompt', 'assistant.brief.world'];
const FRIEND_PROMPTS = [
    'assistant.brief.prompt',
    'assistant.follow_up.companions',
    'assistant.follow_up.mutuals',
    'assistant.follow_up.fading',
    'assistant.follow_up.last_visit'
];
const STRANGER_PROMPTS = [
    'assistant.brief.prompt',
    'assistant.follow_up.last_visit',
    'assistant.follow_up.companions',
    'assistant.follow_up.mutuals'
];
const WORLD_PROMPTS = [
    'assistant.brief.world',
    'assistant.follow_up.world_visits',
    'assistant.follow_up.world_people',
    'assistant.follow_up.world_popularity'
];
const SCREENSHOT_PROMPTS = {
    none: [
        'assistant.screenshots.top_people',
        'assistant.screenshots.top_worlds',
        'assistant.screenshots.latest_together',
        'assistant.screenshots.monthly'
    ],
    user: [
        'assistant.screenshots.person_latest',
        'assistant.screenshots.person_first',
        'assistant.screenshots.person_worlds'
    ],
    world: [
        'assistant.screenshots.world_people',
        'assistant.screenshots.world_count'
    ]
} as const satisfies Record<string, readonly string[]>;
const PROFILE_TOOLS = {
    get_friend_profile: { kind: 'user', argument: 'user' },
    get_world_profile: { kind: 'world', argument: 'world' }
} as const;

function briefTarget(message: UIMessage): MentionTarget | null {
    if (message.role !== 'assistant' || message.streaming) {
        return null;
    }
    const call = message.toolCalls.findLast(
        (item) => item.name in PROFILE_TOOLS && item.status === 'done'
    );
    if (!call) {
        return null;
    }
    const { kind, argument } =
        PROFILE_TOOLS[call.name as keyof typeof PROFILE_TOOLS];
    let requested = '';
    try {
        const args: unknown = JSON.parse(call.args);
        if (args && typeof args === 'object' && argument in args) {
            requested = String((args as Record<string, unknown>)[argument]);
        }
    } catch {
        return null;
    }
    const candidates = call.entities.filter((entity) => entity.kind === kind);
    const entity =
        candidates.find((item) => item.id === requested) ??
        candidates.find((item) => item.displayName === requested) ??
        (kind === 'world' && candidates.length === 1 ? candidates[0] : null);
    return entity?.displayName
        ? { kind, id: entity.id, name: entity.displayName }
        : null;
}

function typingInto(target: EventTarget | null): boolean {
    return (
        (target instanceof HTMLTextAreaElement ||
            target instanceof HTMLInputElement) &&
        target.value.length > 0
    );
}

function usePrompts(
    target: MentionTarget | null,
    topic: AssistantDraft['topic'],
    includeBrief: boolean
): Array<{ label: string; text: string }> {
    const { t } = useTranslation();
    const isFriend = useFriendRosterStore((state) =>
        target?.kind === 'user' ? Boolean(state.friendsById[target.id]) : false
    );
    return useMemo(() => {
        if (!target && topic === 'profile') {
            return [];
        }
        const mention = target ? mentionToken(target) : '';
        const keys =
            topic === 'screenshots'
                ? SCREENSHOT_PROMPTS[target?.kind ?? 'none']
                : target?.kind === 'world'
                  ? WORLD_PROMPTS
                  : isFriend
                    ? FRIEND_PROMPTS
                    : STRANGER_PROMPTS;
        return keys
            .filter((key) => includeBrief || !BRIEF_PROMPTS.includes(key))
            .slice(0, PROMPT_LIMIT)
            .map((key) => ({
                label: t(key, { mention: target?.name ?? '' }),
                text: t(key, { mention })
            }));
    }, [includeBrief, isFriend, target, topic, t]);
}

export function useMentionPrompts(
    target: MentionTarget | null,
    includeBrief: boolean
): Array<{ label: string; text: string }> {
    return usePrompts(target, 'profile', includeBrief);
}

export function useDraftPrompts(
    draft: AssistantDraft | null
): Array<{ label: string; text: string }> {
    const prompts = usePrompts(
        draft?.target ?? null,
        draft?.topic ?? 'profile',
        true
    );
    return draft ? prompts : [];
}

function MentionPrompts({
    target,
    title,
    onSend
}: {
    target: MentionTarget;
    title: string;
    onSend: (text: string) => void;
}) {
    const prompts = useMentionPrompts(target, false);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const index = Number(event.key) - 1;
            if (
                event.isComposing ||
                event.ctrlKey ||
                event.metaKey ||
                event.altKey ||
                !Number.isInteger(index) ||
                !prompts[index] ||
                typingInto(event.target)
            ) {
                return;
            }
            event.preventDefault();
            onSend(prompts[index].text);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onSend, prompts]);

    return (
        <div className="w-full">
            <p className="text-muted-foreground mb-1 px-2 text-xs">{title}</p>
            {prompts.map((prompt, index) => (
                <button
                    key={prompt.text}
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-(--state-hover-surface)"
                    onClick={() => onSend(prompt.text)}
                >
                    <kbd className="border-border text-muted-foreground inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border font-sans text-[11px]">
                        {index + 1}
                    </kbd>
                    {prompt.label}
                </button>
            ))}
        </div>
    );
}

export function AssistantFollowUps({
    message,
    onSend
}: {
    message: UIMessage;
    onSend: (text: string) => void;
}) {
    const { t } = useTranslation();
    const target = useMemo(() => briefTarget(message), [message]);
    if (!target) {
        return null;
    }
    return (
        <div className="border-border/60 mt-1 border-t pt-2">
            <MentionPrompts
                target={target}
                title={t('assistant.follow_up.title')}
                onSend={onSend}
            />
        </div>
    );
}
