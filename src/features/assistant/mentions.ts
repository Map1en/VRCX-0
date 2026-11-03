import type { MentionTarget } from '@/domain/assistant/types';

import { entityHref } from './entityLinks';

const MENTION_MARKER = /\]\(vrcx-0:\/\/(user|world)\/open\?id=/g;
const MENTION_QUERY_LIMIT = 32;

export type MentionSegment =
    | { kind: 'text'; text: string }
    | { kind: 'mention'; target: MentionTarget };

export function mentionToken({ kind, id, name }: MentionTarget): string {
    return `[@${name}](${entityHref(kind, id)})`;
}

export function encodeMentions(
    text: string,
    mentions: Readonly<Record<string, MentionTarget>>
): string {
    const names = Object.keys(mentions)
        .filter(Boolean)
        .sort((left, right) => right.length - left.length);
    if (!names.length) {
        return text;
    }
    const pattern = new RegExp(
        `@(${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
        'g'
    );
    return text.replace(pattern, (_, name: string) =>
        mentionToken(mentions[name])
    );
}

export function splitMentions(text: string): MentionSegment[] {
    const segments: MentionSegment[] = [];
    let rest = text;
    let pending = '';
    for (;;) {
        MENTION_MARKER.lastIndex = 0;
        const match = MENTION_MARKER.exec(rest);
        if (!match) {
            break;
        }
        const marker = match.index;
        const after = rest.slice(marker + match[0].length);
        const open = rest.lastIndexOf('[@', marker);
        const close = after.indexOf(')');
        if (open < 0 || close < 0) {
            pending += rest.slice(0, marker + match[0].length);
            rest = after;
            continue;
        }
        pending += rest.slice(0, open);
        if (pending) {
            segments.push({ kind: 'text', text: pending });
            pending = '';
        }
        segments.push({
            kind: 'mention',
            target: {
                kind: match[1] === 'world' ? 'world' : 'user',
                id: after.slice(0, close),
                name: rest.slice(open + 2, marker)
            }
        });
        rest = after.slice(close + 1);
    }
    pending += rest;
    if (pending) {
        segments.push({ kind: 'text', text: pending });
    }
    return segments;
}

export function findMentionQuery(
    text: string,
    caret: number
): { start: number; query: string } | null {
    const before = text.slice(0, caret);
    const start = before.lastIndexOf('@');
    if (start < 0 || (start > 0 && !/\s/.test(before[start - 1]))) {
        return null;
    }
    const query = before.slice(start + 1);
    if (query.length > MENTION_QUERY_LIMIT || /[\n@]/.test(query)) {
        return null;
    }
    return { start, query };
}
