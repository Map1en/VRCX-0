import { useEffect, useMemo, useRef, useState } from 'react';

import type { GroupInstanceRecord } from '@/domain/entities/group';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    createEmptyQuickSearchState,
    loadQuickSearchResults
} from '../quickSearch';
import {
    mergeQuickSearchGroupInstances,
    USER_QUERY_MIN_LENGTH
} from './quickSearchResultModel';

const EMPTY_GROUP_INSTANCES: GroupInstanceRecord[] = [];

export function useQuickSearchResults({
    currentEndpoint,
    currentUserId,
    normalizedQuery,
    open
}: {
    currentEndpoint?: string | null;
    currentUserId?: string | null;
    normalizedQuery: string;
    open: boolean;
}) {
    const [state, setState] = useState(() => createEmptyQuickSearchState());
    const resultsAccountRef = useRef('');
    const groupInstancesState = useRuntimeStore(
        (runtimeState) => runtimeState.groupInstances
    );
    const groupInstances =
        groupInstancesState.userId === currentUserId &&
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.instances
            : EMPTY_GROUP_INSTANCES;

    useEffect(() => {
        if (
            !open ||
            !currentUserId ||
            normalizedQuery.length < USER_QUERY_MIN_LENGTH
        ) {
            setState(createEmptyQuickSearchState());
            return;
        }

        let active = true;
        const account = `${currentUserId}|${currentEndpoint ?? ''}`;
        setState((current) =>
            resultsAccountRef.current === account
                ? { ...current, status: 'running', detail: '' }
                : createEmptyQuickSearchState('running')
        );
        loadQuickSearchResults(normalizedQuery)
            .then((results) => {
                if (active) {
                    resultsAccountRef.current = account;
                    setState(results);
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    setState(
                        createEmptyQuickSearchState(
                            'error',
                            error instanceof Error
                                ? error.message
                                : 'Search failed.'
                        )
                    );
                }
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, currentUserId, normalizedQuery, open]);

    return useMemo(
        () =>
            mergeQuickSearchGroupInstances(
                state,
                normalizedQuery,
                groupInstances
            ),
        [groupInstances, normalizedQuery, state]
    );
}
