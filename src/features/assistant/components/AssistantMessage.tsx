import { memo } from 'react';

import type { UIMessage } from '@/domain/assistant/types';
import { Bubble, BubbleContent } from '@/ui/shadcn/bubble';
import { Message, MessageContent } from '@/ui/shadcn/message';

import { AssistantMarkdown } from './AssistantMarkdown';
import { AssistantTrace } from './AssistantTrace';

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
    const renderPlain = isUser || message.streaming;
    const alignment = isUser ? 'end' : 'start';
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

                {hasVisibleText && (
                    <Bubble
                        align={alignment}
                        variant={isUser ? 'secondary' : 'ghost'}
                    >
                        <BubbleContent>
                            {renderPlain ? (
                                <span className="whitespace-pre-wrap">
                                    {message.text}
                                </span>
                            ) : (
                                <AssistantMarkdown text={message.text} />
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
