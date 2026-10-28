import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type RefObject
} from 'react';

type SessionScrollAnchor = {
    key: string;
    offset: number;
};

const SESSION_KEY_SELECTOR = '[data-session-key]';

function findFirstVisibleSession(root: HTMLElement) {
    const elements = Array.from(
        root.querySelectorAll<HTMLElement>(SESSION_KEY_SELECTOR)
    );
    const rootTop = root.getBoundingClientRect().top;
    let low = 0;
    let high = elements.length - 1;
    let found: HTMLElement | null = null;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (elements[middle].getBoundingClientRect().bottom > rootTop) {
            found = elements[middle];
            high = middle - 1;
        } else {
            low = middle + 1;
        }
    }
    return found
        ? {
              key: found.dataset.sessionKey ?? '',
              offset: found.getBoundingClientRect().top - rootTop
          }
        : null;
}

export function useSessionScrollAnchor<TItem>(
    scrollRef: RefObject<HTMLElement | null>,
    items: readonly TItem[],
    threshold: number
) {
    const anchorRef = useRef<SessionScrollAnchor | null>(null);
    const [scrolledAway, setScrolledAway] = useState(false);

    const recordAnchor = useCallback(() => {
        const root = scrollRef.current;
        if (!root) {
            return;
        }
        anchorRef.current =
            root.scrollTop > threshold ? findFirstVisibleSession(root) : null;
        setScrolledAway(root.scrollTop > threshold);
    }, [scrollRef, threshold]);

    useEffect(() => {
        const root = scrollRef.current;
        if (!root) {
            return undefined;
        }
        let frameId = 0;
        const handleScroll = () => {
            if (frameId) {
                return;
            }
            frameId = requestAnimationFrame(() => {
                frameId = 0;
                recordAnchor();
            });
        };
        root.addEventListener('scroll', handleScroll, { passive: true });
        return () => {
            if (frameId) {
                cancelAnimationFrame(frameId);
            }
            root.removeEventListener('scroll', handleScroll);
        };
    }, [recordAnchor, scrollRef]);

    useLayoutEffect(() => {
        const root = scrollRef.current;
        const anchor = anchorRef.current;
        if (root && anchor) {
            const element = Array.from(
                root.querySelectorAll<HTMLElement>(SESSION_KEY_SELECTOR)
            ).find((candidate) => candidate.dataset.sessionKey === anchor.key);
            if (element) {
                const offset =
                    element.getBoundingClientRect().top -
                    root.getBoundingClientRect().top;
                if (offset !== anchor.offset) {
                    root.scrollTop += offset - anchor.offset;
                }
            }
        }
        recordAnchor();
    }, [items, recordAnchor, scrollRef]);

    const scrollToLatest = useCallback(() => {
        const root = scrollRef.current;
        if (root) {
            root.scrollTop = 0;
        }
        anchorRef.current = null;
        setScrolledAway(false);
    }, [scrollRef]);

    return { scrolledAway, scrollToLatest };
}
