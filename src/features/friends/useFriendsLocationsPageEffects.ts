// @ts-nocheck
import { useEffect } from 'react';
export function useFriendsLocationsPageEffects({
    activeSegment,
    deferredSearchQuery,
    resetScrollTop,
    setActiveSegment,
    showSameInstance
}) {
    useEffect(() => {
        if (!showSameInstance && activeSegment === 'same-instance') {
            setActiveSegment('online');
        }
    }, [activeSegment, setActiveSegment, showSameInstance]);

    useEffect(() => {
        resetScrollTop();
    }, [activeSegment, deferredSearchQuery, resetScrollTop, showSameInstance]);
}
