import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type RefObject
} from 'react';

const SECTION_SCROLL_OFFSET = 8;

type PinnedSection = {
    id: string;
    targetTop: number;
    settled: boolean;
};

function sectionElement(container: HTMLElement, attribute: string, id: string) {
    return container.querySelector<HTMLElement>(`[${attribute}="${id}"]`);
}

export function useActiveScrollSection(
    scrollRef: RefObject<HTMLElement | null>,
    sectionIds: readonly string[],
    attribute: string
) {
    const [activeId, setActiveId] = useState<string | null>(null);
    const pinnedRef = useRef<PinnedSection | null>(null);
    const sectionKey = sectionIds.join('\n');

    useEffect(() => {
        const ids = sectionKey ? sectionKey.split('\n') : [];
        const container = scrollRef.current;
        if (!container) {
            return undefined;
        }
        const compute = () => {
            const atBottom =
                container.scrollTop + container.clientHeight >=
                container.scrollHeight - 1;
            if (atBottom) {
                return ids[ids.length - 1] ?? null;
            }
            const threshold = container.scrollTop + SECTION_SCROLL_OFFSET + 1;
            let current: string | null = ids[0] ?? null;
            for (const id of ids) {
                const element = sectionElement(container, attribute, id);
                if (element && element.offsetTop <= threshold) {
                    current = id;
                }
            }
            return current;
        };
        const update = () => {
            const pinned = pinnedRef.current;
            if (pinned) {
                const reached =
                    Math.abs(container.scrollTop - pinned.targetTop) <= 1;
                if (!pinned.settled) {
                    if (reached) {
                        pinned.settled = true;
                    }
                    return;
                }
                if (reached) {
                    return;
                }
                pinnedRef.current = null;
            }
            setActiveId(compute());
        };
        update();
        container.addEventListener('scroll', update, { passive: true });
        return () => {
            container.removeEventListener('scroll', update);
        };
    }, [attribute, scrollRef, sectionKey]);

    const scrollTo = useCallback(
        (id: string) => {
            const container = scrollRef.current;
            const element = container
                ? sectionElement(container, attribute, id)
                : null;
            if (!container || !element) {
                return;
            }
            const targetTop = Math.max(
                0,
                Math.min(
                    element.offsetTop - SECTION_SCROLL_OFFSET,
                    container.scrollHeight - container.clientHeight
                )
            );
            pinnedRef.current = {
                id,
                targetTop,
                settled: Math.abs(container.scrollTop - targetTop) <= 1
            };
            setActiveId(id);
            container.scrollTo({ top: targetTop, behavior: 'smooth' });
        },
        [attribute, scrollRef]
    );

    return { activeId, scrollTo };
}
