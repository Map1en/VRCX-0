import { useLayoutEffect, type RefObject } from 'react';

const scrollTopByKey = new Map<string, number>();

export function useRouteScrollMemory(
    ref: RefObject<HTMLElement | null>,
    key: string
) {
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) {
            return undefined;
        }

        const savedTop = scrollTopByKey.get(key) ?? 0;
        if (
            savedTop > 0 &&
            element.scrollHeight - element.clientHeight >= savedTop
        ) {
            element.scrollTop = savedTop;
        }

        const remember = () => {
            scrollTopByKey.set(key, element.scrollTop);
        };
        element.addEventListener('scroll', remember, { passive: true });
        return () => {
            element.removeEventListener('scroll', remember);
        };
    }, [key, ref]);
}
