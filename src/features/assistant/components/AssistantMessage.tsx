import { memo, useMemo } from 'react';

import type { UIMessage } from '@/domain/assistant/types';
import { Bubble, BubbleContent } from '@/ui/shadcn/bubble';
import { Message, MessageContent } from '@/ui/shadcn/message';

import { AssistantChoiceCard } from './AssistantChoiceCard';
import { AssistantMarkdown } from './AssistantMarkdown';
import { AssistantTrace } from './AssistantTrace';
import { MentionText } from './MentionText';

interface AssistantMessageProps {
    message: UIMessage;
    thinkingLabel: string;
}

function AssistantMessageImpl({
    message,
    thinkingLabel
}: AssistantMessageProps) {
    const isUser = message.role === 'user';
    const hasVisibleText = message.text.trim().length > 0;
    const alignment = isUser ? 'end' : 'start';
    const entities = useMemo(
        () => message.toolCalls.flatMap((call) => call.entities),
        [message.toolCalls]
    );
    const traceRunning =
        message.streaming &&
        (!hasVisibleText ||
            message.toolCalls.some((call) => call.status === 'pending'));

    return (
        <Message align={alignment}>
            <MessageContent>
                {(message.toolCalls.length > 0 || traceRunning) && (
                    <AssistantTrace
                        toolCalls={message.toolCalls}
                        running={traceRunning}
                        thinkingLabel={thinkingLabel}
                    />
                )}

                {message.choices?.map((choice) => (
                    <AssistantChoiceCard
                        key={choice.id}
                        choice={choice}
                        active={message.streaming}
                    />
                ))}

                {hasVisibleText && (
                    <Bubble
                        align={alignment}
                        variant={isUser ? 'secondary' : 'ghost'}
                    >
                        <BubbleContent>
                            {isUser ? (
                                <MentionText text={message.text} />
                            ) : message.streaming ? (
                                <span className="whitespace-pre-wrap">
                                    {message.text}
                                </span>
                            ) : (
                                <AssistantMarkdown
                                    text={message.text}
                                    entities={entities}
                                />
                            )}
                            {message.streaming && (
                                <span
                                    aria-hidden="true"
                                    className="shimmer ml-1"
                                >
                                    …
                                </span>
                            )}
                        </BubbleContent>
                    </Bubble>
                )}

                {message.error && (
                    <Bubble align="start" variant="destructive">
                        <BubbleContent>{message.error}</BubbleContent>
                    </Bubble>
                )}
            </MessageContent>
        </Message>
    );
}

export const AssistantMessage = memo(AssistantMessageImpl);
