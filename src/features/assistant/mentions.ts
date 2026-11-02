import { entityHref } from './entityLinks';

const MENTION_MARKER = `](${entityHref('user', '')}`;
const MENTION_QUERY_LIMIT = 32;

export type MentionSegment =
    | { kind: 'text'; text: string }
    | { kind: 'mention'; name: string; userId: string };

function mentionToken(name: string, userId: string): string {
    return `[@${name}](${entityHref('user', userId)})`;
}

export function encodeMentions(
    text: string,
    mentions: Readonly<Record<string, string>>
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
        mentionToken(name, mentions[name])
    );
}

export function splitMentions(text: string): MentionSegment[] {
    const segments: MentionSegment[] = [];
    let rest = text;
    let pending = '';
    for (;;) {
        const marker = rest.indexOf(MENTION_MARKER);
        if (marker < 0) {
            break;
        }
        const after = rest.slice(marker + MENTION_MARKER.length);
        const open = rest.lastIndexOf('[@', marker);
        const close = after.indexOf(')');
        if (open < 0 || close < 0) {
            pending += rest.slice(0, marker + MENTION_MARKER.length);
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
            name: rest.slice(open + 2, marker),
            userId: after.slice(0, close)
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
