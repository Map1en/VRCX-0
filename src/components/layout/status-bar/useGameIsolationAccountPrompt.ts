import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { toast } from '@/services/toastService';
import { useRuntimeStore } from '@/state/runtimeStore';

import { useGameIsolationCardStore } from './gameIsolationCardStore';

export const GAME_ISOLATION_ACCOUNT_PROMPT_TOAST_ID =
    'game-isolation-account-prompt';

export function useGameIsolationAccountPrompt({
    available,
    onTurnOff
}: {
    available: boolean;
    onTurnOff: () => void;
}): void {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const enabled = useRuntimeStore((state) => state.gameIsolation.enabled);
    const gameUserId = useRuntimeStore(
        (state) => state.gameIsolation.localGameAccount?.userId ?? null
    );
    const gameDisplayName = useRuntimeStore(
        (state) => state.gameIsolation.localGameAccount?.displayName ?? ''
    );
    const promptedKeyRef = useRef<string | null>(null);
    const onTurnOffRef = useRef(onTurnOff);
    onTurnOffRef.current = onTurnOff;

    useEffect(() => {
        if (!available || !currentUserId || !gameUserId) {
            promptedKeyRef.current = null;
            toast.close(GAME_ISOLATION_ACCOUNT_PROMPT_TOAST_ID);
            return;
        }
        const otherAccountPlaying = gameUserId !== currentUserId;
        if (otherAccountPlaying === enabled) {
            toast.close(GAME_ISOLATION_ACCOUNT_PROMPT_TOAST_ID);
            return;
        }
        const key = `${currentUserId}:${gameUserId}`;
        if (promptedKeyRef.current === key) {
            return;
        }
        promptedKeyRef.current = key;
        toast.add({
            id: GAME_ISOLATION_ACCOUNT_PROMPT_TOAST_ID,
            type: 'warning',
            title: otherAccountPlaying
                ? t('game_isolation.prompt_other_account_title', {
                      name: gameDisplayName
                  })
                : t('game_isolation.prompt_own_account_title'),
            description: otherAccountPlaying
                ? t('game_isolation.prompt_other_account_description')
                : t('game_isolation.prompt_own_account_description'),
            timeout: 0,
            position: 'bottom-right',
            actionProps: otherAccountPlaying
                ? {
                      children: t('game_isolation.menu_item'),
                      onClick: () => {
                          useGameIsolationCardStore.getState().setOpen(true);
                      }
                  }
                : {
                      children: t('game_isolation.turn_off'),
                      onClick: () => {
                          onTurnOffRef.current();
                      }
                  },
            data: { closeButton: true }
        });
    }, [available, currentUserId, enabled, gameDisplayName, gameUserId, t]);
}
