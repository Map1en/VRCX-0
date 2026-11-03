import { useEffect, useState } from 'react';

export function useNearViewport(element: Element | null): boolean {
    const [near, setNear] = useState(false);
    useEffect(() => {
        if (!element) {
            return;
        }
        const observer = new IntersectionObserver(
            ([entry]) => setNear(entry.isIntersecting),
            { rootMargin: '300px 0px' }
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [element]);
    return near;
}
