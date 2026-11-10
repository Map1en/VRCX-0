import { useEffect, useRef, useState } from 'react';

import { dimBlink } from '@/lib/dimBlink';
import { useOfflineRecordStore } from '@/state/offlineRecordStore';

type SyncAnimationPhase = 'idle' | 'syncing' | 'success';

const SYNC_BLINK = {
    opacity: 0.4,
    halfCycles: 2,
    halfCycleMs: 600,
    direction: 'alternate-reverse'
} satisfies Parameters<typeof dimBlink>[1];

export function useOfflineRecordSyncAnimation(currentUserId: string | null) {
    const iconRef = useRef<HTMLSpanElement>(null);
    const [phase, setPhase] = useState<SyncAnimationPhase>('idle');

    useEffect(() => {
        const icon = iconRef.current;
        setPhase('idle');
        if (!icon || !currentUserId) {
            return;
        }

        let currentPhase: SyncAnimationPhase = 'idle';
        let animation: Animation | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;

        function cancel() {
            if (animation) {
                animation.onfinish = null;
                animation.cancel();
                animation = undefined;
            }
            clearTimeout(timer);
        }

        function play(nextPhase: SyncAnimationPhase) {
            cancel();
            currentPhase = nextPhase;
            setPhase(nextPhase);
            if (nextPhase === 'idle') {
                return;
            }

            function completeCycle() {
                const { syncProgress, syncOutcome } =
                    useOfflineRecordStore.getState();
                if (syncProgress) {
                    play('syncing');
                } else if (
                    nextPhase === 'syncing' &&
                    syncOutcome === 'finished'
                ) {
                    play('success');
                } else {
                    play('idle');
                }
            }

            if (
                document.documentElement.classList.contains('reduce-effects') ||
                window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
            ) {
                if (nextPhase === 'success') {
                    timer = setTimeout(
                        completeCycle,
                        SYNC_BLINK.halfCycleMs * 2
                    );
                }
                return;
            }

            animation = dimBlink(icon!, SYNC_BLINK);
            animation.onfinish = completeCycle;
        }

        const unsubscribe = useOfflineRecordStore.subscribe(
            (state, previous) => {
                if (state.syncProgress && currentPhase === 'idle') {
                    play('syncing');
                } else if (state.syncOutcome !== previous.syncOutcome) {
                    if (state.syncOutcome === 'failed') {
                        play('idle');
                    } else if (state.syncOutcome === 'finished' && !animation) {
                        play('success');
                    }
                }
            }
        );
        if (useOfflineRecordStore.getState().syncProgress) {
            play('syncing');
        }

        return () => {
            unsubscribe();
            cancel();
        };
    }, [currentUserId]);

    return { iconRef, phase };
}
