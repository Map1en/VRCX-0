import { ArrowDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import type { UIMessage } from '@/domain/assistant/types';
import {
    MessageScroller,
    MessageScrollerButton,
    MessageScrollerContent,
    MessageScrollerItem,
    MessageScrollerProvider,
    MessageScrollerViewport
} from '@/ui/shadcn/message-scroller';

import { AssistantFollowUps } from './AssistantFollowUps';
import { AssistantMessage } from './AssistantMessage';

interface AssistantTranscriptProps {
    sessionId: string | null;
    messages: readonly UIMessage[] | undefined;
    busy: boolean;
    onSend: (text: string) => void;
    emptyState: ReactNode;
    scrollToLatestLabel: string;
    thinkingLabel: string;
}

export function AssistantTranscript({
    sessionId,
    messages,
    busy,
    onSend,
    emptyState,
    scrollToLatestLabel,
    thinkingLabel
}: AssistantTranscriptProps) {
    return (
        <MessageScrollerProvider
            key={sessionId ?? 'new-session'}
            autoScroll
            defaultScrollPosition="last-anchor"
        >
            <MessageScroller>
                <MessageScrollerViewport>
                    <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-6 px-6 py-6">
                        {messages?.length ? (
                            messages.map((message) => (
                                <MessageScrollerItem
                                    key={message.id}
                                    messageId={message.id}
                                    scrollAnchor={message.role === 'user'}
                                >
                                    <AssistantMessage
                                        message={message}
                                        thinkingLabel={thinkingLabel}
                                    />
                                    {!busy && message === messages.at(-1) && (
                                        <AssistantFollowUps
                                            message={message}
                                            onSend={onSend}
                                        />
                                    )}
                                </MessageScrollerItem>
                            ))
                        ) : (
                            <MessageScrollerItem className="flex flex-1">
                                {emptyState}
                            </MessageScrollerItem>
                        )}
                    </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton title={scrollToLatestLabel}>
                    <ArrowDownIcon />
                    <span className="sr-only">{scrollToLatestLabel}</span>
                </MessageScrollerButton>
            </MessageScroller>
        </MessageScrollerProvider>
    );
}
