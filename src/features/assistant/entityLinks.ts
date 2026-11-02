import type { Entity } from '@/domain/assistant/types';

type EntityLinkKind = 'user' | 'world';

interface MarkdownNode {
    type: string;
    value?: string;
    url?: string;
    children?: MarkdownNode[];
}

const ENTITY_HREF = /^vrcx-0:\/\/(user|world)\/open\?id=([^&#\s]+)$/;
const ASCII_WORD = /[A-Za-z0-9_]/;

export function entityHref(kind: EntityLinkKind, id: string): string {
    return `vrcx-0://${kind}/open?id=${id}`;
}

export function parseEntityHref(
    href: string | undefined
): { kind: EntityLinkKind; id: string } | null {
    const match = href ? ENTITY_HREF.exec(href) : null;
    return match ? { kind: match[1] as EntityLinkKind, id: match[2] } : null;
}

function linkableNames(entities: readonly Entity[]): Map<string, string> {
    const hrefByName = new Map<string, string | null>();
    for (const entity of entities) {
        if (entity.kind !== 'user' && entity.kind !== 'world') {
            continue;
        }
        const name = entity.displayName.trim();
        if ([...name].length < 2) {
            continue;
        }
        const href = entityHref(entity.kind, entity.id);
        const known = hrefByName.get(name);
        hrefByName.set(
            name,
            known === undefined || known === href ? href : null
        );
    }
    const linkable = new Map<string, string>();
    for (const [name, href] of hrefByName) {
        if (href) {
            linkable.set(name, href);
        }
    }
    return linkable;
}

function splitText(
    value: string,
    pattern: RegExp,
    hrefByName: ReadonlyMap<string, string>
): MarkdownNode[] {
    const nodes: MarkdownNode[] = [];
    let cursor = 0;
    for (const match of value.matchAll(pattern)) {
        const name = match[0];
        const start = match.index;
        const end = start + name.length;
        if (
            (ASCII_WORD.test(name[0]) &&
                ASCII_WORD.test(value[start - 1] ?? '')) ||
            (ASCII_WORD.test(name[name.length - 1]) &&
                ASCII_WORD.test(value[end] ?? ''))
        ) {
            continue;
        }
        if (start > cursor) {
            nodes.push({ type: 'text', value: value.slice(cursor, start) });
        }
        nodes.push({
            type: 'link',
            url: hrefByName.get(name),
            children: [{ type: 'text', value: name }]
        });
        cursor = end;
    }
    if (cursor === 0) {
        return [{ type: 'text', value }];
    }
    if (cursor < value.length) {
        nodes.push({ type: 'text', value: value.slice(cursor) });
    }
    return nodes;
}

export function entityLinking(entities: readonly Entity[]) {
    const hrefByName = linkableNames(entities);
    const hrefs = new Set(hrefByName.values());
    const names = [...hrefByName.keys()].sort(
        (left, right) => right.length - left.length
    );
    const pattern = names.length
        ? new RegExp(
              names
                  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                  .join('|'),
              'gu'
          )
        : null;

    const visit = (node: MarkdownNode) => {
        if (
            !pattern ||
            !node.children ||
            node.type === 'link' ||
            node.type === 'linkReference'
        ) {
            return;
        }
        node.children = node.children.flatMap((child) => {
            if (child.type === 'text' && child.value) {
                return splitText(child.value, pattern, hrefByName);
            }
            visit(child);
            return [child];
        });
    };

    return {
        remarkPlugin: () => visit,
        isEntityHref: (href: string) => hrefs.has(href)
    };
}
