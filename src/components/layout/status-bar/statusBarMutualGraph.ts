import type { MutualGraphState } from '@/state/runtimeStore';

const VISIBLE_MUTUAL_GRAPH_STATUSES = new Set<MutualGraphState['status']>([
    'running',
    'cancelling',
    'completed',
    'cancelled',
    'error'
]);

export function isMutualGraphSegmentVisible(
    state: Pick<MutualGraphState, 'status' | 'ownerUserId'>,
    currentUserId: string | null
): boolean {
    return (
        VISIBLE_MUTUAL_GRAPH_STATUSES.has(state.status) &&
        (!state.ownerUserId || state.ownerUserId === currentUserId)
    );
}
