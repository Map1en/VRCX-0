import { useEffect } from 'react';
export function useFriendsLocationsPageEffects({
    ResizeObserver,
    activeSegment,
    deferredSearchQuery,
    scrollRef,
    setActiveSegment,
    setScrollMetrics,
    showSameInstance
}) {
    useEffect(() => {
        if (!showSameInstance && activeSegment === 'same-instance') {
            setActiveSegment('online');
        }
    }, [activeSegment, showSameInstance]);
    useEffect(() => {
        function updateScrollMetrics() {
            const node = scrollRef.current;
            if (!node) {
                return;
            }
            const next = {
                scrollTop: node.scrollTop,
                viewportHeight: node.clientHeight,
                width: node.clientWidth
            };
            setScrollMetrics((current) =>
                current.scrollTop === next.scrollTop &&
                current.viewportHeight === next.viewportHeight &&
                current.width === next.width
                    ? current
                    : next
            );
        }
        const node = scrollRef.current;
        if (!node) {
            return undefined;
        }
        updateScrollMetrics();
        node.addEventListener('scroll', updateScrollMetrics, {
            passive: true
        });
        const observer =
            typeof ResizeObserver === 'function'
                ? new ResizeObserver(updateScrollMetrics)
                : null;
        observer?.observe(node);
        window.addEventListener('resize', updateScrollMetrics);
        return () => {
            node.removeEventListener('scroll', updateScrollMetrics);
            observer?.disconnect();
            window.removeEventListener('resize', updateScrollMetrics);
        };
    }, []);
    useEffect(() => {
        const node = scrollRef.current;
        if (!node) {
            return;
        }
        node.scrollTop = 0;
        setScrollMetrics((current) => ({
            ...current,
            scrollTop: 0
        }));
    }, [activeSegment, deferredSearchQuery, showSameInstance]);
}
