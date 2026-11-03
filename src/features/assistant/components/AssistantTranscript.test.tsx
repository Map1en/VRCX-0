import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { UIMessage } from '@/domain/assistant/types';

import { AssistantTranscript } from './AssistantTranscript';

vi.mock('@/ui/shadcn/message-scroller', () => ({
    MessageScrollerProvider: ({
        autoScroll,
        defaultScrollPosition,
        children
    }: {
        autoScroll?: boolean;
        defaultScrollPosition?: string;
        children?: ReactNode;
    }) => (
        <div
            data-testid="scroller-provider"
            data-auto-scroll={autoScroll}
            data-default-scroll-position={defaultScrollPosition}
        >
            {children}
        </div>
    ),
    MessageScroller: ({ children }: { children?: ReactNode }) => (
        <div data-slot="message-scroller">{children}</div>
    ),
    MessageScrollerViewport: ({ children }: { children?: ReactNode }) => (
        <div data-slot="message-scroller-viewport">{children}</div>
    ),
    MessageScrollerContent: ({ children }: { children?: ReactNode }) => (
        <div data-slot="message-scroller-content">{children}</div>
    ),
    MessageScrollerItem: ({
        messageId,
        scrollAnchor,
        children
    }: {
        messageId?: string;
        scrollAnchor?: boolean;
        children?: ReactNode;
    }) => (
        <div
            data-slot="message-scroller-item"
            data-message-id={messageId}
            data-scroll-anchor={scrollAnchor}
        >
            {children}
        </div>
    ),
    MessageScrollerButton: ({ children }: { children?: ReactNode }) => (
        <button data-slot="message-scroller-button">{children}</button>
    )
}));

const messages: UIMessage[] = [
    {
        id: 'user_1',
        role: 'user',
        text: 'Who did I see?',
        streaming: false,
        toolCalls: []
    },
    {
        id: 'asst_1',
        role: 'assistant',
        text: 'You saw Alex.',
        streaming: false,
        toolCalls: []
    }
];

describe('AssistantTranscript', () => {
    it('configures automatic scrolling to user-turn anchors', () => {
        const html = renderToStaticMarkup(
            <AssistantTranscript
                sessionId="session_1"
                messages={messages}
                busy={false}
                onSend={vi.fn()}
                emptyState={null}
                scrollToLatestLabel="Jump to latest"
                thinkingLabel="Thinking…"
                pendingLabel="Reading your question"
            />
        );

        expect(html).toContain('data-auto-scroll="true"');
        expect(html).toContain('data-default-scroll-position="last-anchor"');
        expect(html).toContain(
            'data-message-id="user_1" data-scroll-anchor="true"'
        );
        expect(html).toContain(
            'data-message-id="asst_1" data-scroll-anchor="false"'
        );
        expect(html).toContain('Jump to latest');
        expect(html).toContain('Who did I see?');
        expect(html).toContain('You saw Alex.');
    });

    it('renders the empty state inside a scroller item', () => {
        const html = renderToStaticMarkup(
            <AssistantTranscript
                sessionId={null}
                messages={[]}
                busy={false}
                onSend={vi.fn()}
                emptyState={<p>Ask about your social life</p>}
                scrollToLatestLabel="Jump to latest"
                thinkingLabel="Thinking…"
                pendingLabel="Reading your question"
            />
        );

        expect(html).toContain('data-slot="message-scroller-item"');
        expect(html).toContain('Ask about your social life');
    });

    it('shows a waiting row as soon as a question is sent', () => {
        const render = (busy: boolean, list: UIMessage[]) =>
            renderToStaticMarkup(
                <AssistantTranscript
                    sessionId="session_1"
                    messages={list}
                    busy={busy}
                    onSend={vi.fn()}
                    emptyState={null}
                    scrollToLatestLabel="Jump to latest"
                    thinkingLabel="Thinking…"
                    pendingLabel="Reading your question"
                />
            );

        expect(render(true, messages.slice(0, 1))).toContain(
            'Reading your question'
        );
        expect(render(true, messages)).not.toContain('Reading your question');
        expect(render(false, messages.slice(0, 1))).not.toContain(
            'Reading your question'
        );
    });
});
