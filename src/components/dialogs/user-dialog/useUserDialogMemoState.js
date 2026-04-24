import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { memoRepository, toolsRepository } from '@/repositories/index.js';

import { normalizeUserId } from './userProfileFields.js';

export function useUserDialogMemoState({
    activeUserTargetRef,
    applyFriendPatch,
    currentEndpoint,
    friendsById,
    isCurrentUser,
    normalizedUserId,
    profile,
    prompt,
    setBaseProfile,
    t
}) {
    const [memo, setMemo] = useState('');
    const memoRevisionRef = useRef(0);

    useEffect(() => {
        let active = true;

        if (!normalizedUserId) {
            setMemo('');
            return () => {
                active = false;
            };
        }

        setMemo('');
        const revision = memoRevisionRef.current;
        memoRepository
            .getUserMemo(normalizedUserId)
            .then((entry) => {
                if (active && memoRevisionRef.current === revision) {
                    setMemo(entry?.memo || '');
                }
            })
            .catch(() => {
                if (active && memoRevisionRef.current === revision) {
                    setMemo('');
                }
            });

        return () => {
            active = false;
        };
    }, [normalizedUserId]);

    async function editMemo() {
        const targetProfile = profile;
        const targetUserId = normalizeUserId(targetProfile?.id);
        const targetEndpoint = currentEndpoint;
        const editingCurrentUser = isCurrentUser;
        if (!targetUserId) {
            return;
        }

        let nextNote = targetProfile.note || '';
        if (!editingCurrentUser) {
            const noteResult = await prompt({
                title: t('dialog.user.generated_modal.edit_vrchat_note'),
                description: targetProfile.displayName || targetProfile.id,
                inputValue: nextNote,
                multiline: true,
                confirmText: t('dialog.user.generated_modal.next'),
                cancelText: t('common.actions.cancel')
            });
            if (!noteResult.ok) {
                return;
            }
            nextNote = String(noteResult.value || '').slice(0, 256);
        }

        const result = await prompt({
            title: t('dialog.user.generated_modal.edit_local_memo'),
            description: targetProfile.displayName || targetProfile.id,
            inputValue: memo,
            multiline: true,
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel')
        });

        if (!result.ok) {
            return;
        }

        memoRevisionRef.current += 1;
        try {
            if (
                !editingCurrentUser &&
                nextNote !== (targetProfile.note || '')
            ) {
                await toolsRepository.saveUserNote(
                    {
                        targetUserId,
                        note: nextNote
                    },
                    { endpoint: targetEndpoint }
                );
            }
            const nextEntry = await memoRepository.saveUserMemo({
                userId: targetUserId,
                memo: result.value
            });
            if (
                activeUserTargetRef.current.userId !== targetUserId ||
                activeUserTargetRef.current.endpoint !== targetEndpoint
            ) {
                return;
            }
            const nextMemo = nextEntry.memo || '';
            const rosterUserId = targetUserId;
            setMemo(nextMemo);
            setBaseProfile((currentProfile) =>
                normalizeUserId(currentProfile?.id) === targetUserId
                    ? {
                          ...currentProfile,
                          note: nextNote,
                          memo: nextMemo,
                          $nickName: nextMemo
                      }
                    : currentProfile
            );
            if (rosterUserId && friendsById[rosterUserId]) {
                applyFriendPatch({
                    userId: rosterUserId,
                    patch: {
                        note: nextNote,
                        memo: nextMemo,
                        $nickName: nextMemo
                    },
                    stateBucket:
                        friendsById[rosterUserId]?.stateBucket ||
                        friendsById[rosterUserId]?.state
                });
            }
            toast.success(
                nextMemo
                    ? t('dialog.user.generated_toast.memo_saved')
                    : t('dialog.user.generated_toast.memo_cleared')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.generated_toast.failed_to_save_memo')
            );
        }
    }

    return {
        editMemo,
        memo
    };
}
