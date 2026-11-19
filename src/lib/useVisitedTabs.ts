import { useState } from 'react';

export function useVisitedTabs(activeTab: string, resetKey: string) {
    const [state, setState] = useState<{
        resetKey: string;
        visited: ReadonlySet<string>;
    }>(() => ({ resetKey, visited: new Set([activeTab]) }));
    if (state.resetKey !== resetKey) {
        const next = { resetKey, visited: new Set([activeTab]) };
        setState(next);
        return next.visited;
    }
    if (!state.visited.has(activeTab)) {
        const next = {
            resetKey,
            visited: new Set([...state.visited, activeTab])
        };
        setState(next);
        return next.visited;
    }
    return state.visited;
}
