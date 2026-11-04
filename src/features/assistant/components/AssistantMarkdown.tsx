import { Children, isValidElement, memo, useMemo, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remend, { type RemendOptions } from 'remend';

import { HighlightedCodeBlock } from '@/components/HighlightedCodeBlock';
import type { Entity } from '@/domain/assistant/types';
import { openExternalLink } from '@/services/entityMediaService';

import { entityLinking, parseEntityHref } from '../entityLinks';
import { EntityChip } from './EntityChip';

const NO_ENTITIES: Entity[] = [];

function AssistantCodeBlock({ children }: { children?: ReactNode }) {
    const codeElement = Children.toArray(children)[0];
    const codeProps = isValidElement<{
        className?: string;
        children?: ReactNode;
    }>(codeElement)
        ? codeElement.props
        : null;
    const language =
        codeProps?.className?.match(/(?:^|\s)language-(\S+)/)?.[1] ?? '';
    const code = Children.toArray(codeProps?.children)
        .filter((part) => typeof part === 'string')
        .join('')
        .replace(/\n$/, '');

    return (
        <HighlightedCodeBlock
            code={code}
            language={language}
            size="sm"
            className="my-1.5"
        />
    );
}

const markdownComponents: Components = {
    p: ({ children }) => (
        <p className="my-1 first:mt-0 last:mb-0">{children}</p>
    ),
    ul: ({ children }) => (
        <ul className="my-1 list-disc pl-5 first:mt-0 last:mb-0">{children}</ul>
    ),
    ol: ({ children }) => (
        <ol className="my-1 list-decimal pl-5 first:mt-0 last:mb-0">
            {children}
        </ol>
    ),
    li: ({ children }) => <li className="my-0.5">{children}</li>,
    strong: ({ children }) => (
        <strong className="font-semibold">{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,
    code: ({ children }) => (
        <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]">
            {children}
        </code>
    ),
    pre: AssistantCodeBlock,
    a: ({ href, children }) => {
        const entity = parseEntityHref(href);
        return entity ? (
            <EntityChip kind={entity.kind} id={entity.id}>
                {children}
            </EntityChip>
        ) : (
            <button
                type="button"
                className="text-primary cursor-pointer underline underline-offset-2"
                onClick={() => {
                    if (href) {
                        openExternalLink(href);
                    }
                }}
            >
                {children}
            </button>
        );
    },
    h1: ({ children }) => (
        <h1 className="mt-2 mb-1 text-base font-semibold">{children}</h1>
    ),
    h2: ({ children }) => (
        <h2 className="mt-2 mb-1 text-sm font-semibold">{children}</h2>
    ),
    h3: ({ children }) => (
        <h3 className="mt-2 mb-1 text-sm font-medium">{children}</h3>
    ),
    blockquote: ({ children }) => (
        <blockquote className="border-border/60 text-muted-foreground my-1 border-l-2 pl-2">
            {children}
        </blockquote>
    ),
    table: ({ children }) => (
        <div className="my-2 max-w-full overflow-x-auto">
            <table className="w-full border-collapse text-sm">{children}</table>
        </div>
    ),
    thead: ({ children }) => (
        <thead className="border-border/50 border-b">{children}</thead>
    ),
    tr: ({ children }) => (
        <tr className="border-border/25 border-b last:border-0">{children}</tr>
    ),
    th: ({ children }) => (
        <th className="px-3 py-1.5 text-left font-medium whitespace-nowrap">
            {children}
        </th>
    ),
    td: ({ children }) => <td className="px-3 py-1.5 align-top">{children}</td>
};

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;

function splitMarkdownBlocks(text: string): string[] {
    const lines = text.split('\n');
    const blocks: string[] = [];
    let start = 0;
    let fence: string | null = null;
    let afterBlank = false;
    lines.forEach((line, index) => {
        const fenceMatch = FENCE.exec(line);
        if (fence) {
            if (
                fenceMatch &&
                fenceMatch[1][0] === fence[0] &&
                fenceMatch[1].length >= fence.length &&
                line.trim() === fenceMatch[1]
            ) {
                fence = null;
            }
            return;
        }
        if (line.trim() === '') {
            afterBlank = true;
            return;
        }
        if (afterBlank && !/^\s/.test(line) && !LIST_ITEM.test(line)) {
            blocks.push(lines.slice(start, index).join('\n'));
            start = index;
        }
        afterBlank = false;
        if (fenceMatch) {
            fence = fenceMatch[1];
        }
    });
    blocks.push(lines.slice(start).join('\n'));
    return blocks;
}

const STREAMING_TAIL_OPTIONS: RemendOptions = {
    comparisonOperators: false,
    images: false,
    linkMode: 'text-only',
    singleTilde: false
};

const MarkdownBlock = memo(function MarkdownBlock({
    text,
    linking
}: {
    text: string;
    linking: ReturnType<typeof entityLinking>;
}) {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm, linking.remarkPlugin]}
            urlTransform={(url) =>
                linking.isEntityHref(url) ? url : defaultUrlTransform(url)
            }
            components={markdownComponents}
        >
            {text}
        </ReactMarkdown>
    );
});

interface AssistantMarkdownProps {
    text: string;
    entities?: readonly Entity[];
    streaming?: boolean;
}

export function AssistantMarkdown({
    text,
    entities = NO_ENTITIES,
    streaming = false
}: AssistantMarkdownProps) {
    const linking = useMemo(() => entityLinking(entities), [entities]);
    const blocks = splitMarkdownBlocks(text);
    const last = blocks.length - 1;
    return blocks.map((block, index) => (
        <MarkdownBlock
            key={index}
            text={
                streaming && index === last
                    ? remend(block, STREAMING_TAIL_OPTIONS)
                    : block
            }
            linking={linking}
        />
    ));
}
