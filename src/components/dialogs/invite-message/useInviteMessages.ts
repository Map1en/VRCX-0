import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { InviteMessageType } from '@/platform/tauri/bindings';
import vrchatToolsRepository from '@/repositories/vrchatToolsRepository';

import {
    normalizeInviteMessageRows,
    saveInviteMessage,
    type InviteMessageRow
} from './inviteMessageData';

type UseInviteMessagesOptions = {
    currentUserId?: string | null;
    endpoint?: string | null;
    messageType: InviteMessageType;
};

export type InviteMessagesState = ReturnType<typeof useInviteMessages>;

export function useInviteMessages({
    currentUserId,
    endpoint,
    messageType
}: UseInviteMessagesOptions) {
    const { t } = useTranslation();
    const [rows, setRows] = useState<InviteMessageRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [nowMs, setNowMs] = useState(() => Date.now());
    const requestIdRef = useRef(0);

    const reload = useCallback(async () => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        if (!currentUserId) {
            setRows([]);
            setError(
                t(
                    'dialog.user.error.cannot_load_message_templates_no_current_user_session_is_available'
                )
            );
            setLoading(false);
            return;
        }

        setLoading(true);
        setError('');
        try {
            const response = await vrchatToolsRepository.getInviteMessages({
                currentUserId,
                messageType
            });
            if (requestIdRef.current === requestId) {
                setRows(normalizeInviteMessageRows(response, messageType));
            }
        } catch (nextError) {
            if (requestIdRef.current === requestId) {
                setRows([]);
                setError(
                    nextError instanceof Error
                        ? nextError.message
                        : t(
                              'dialog.edit_invite_messages.error.failed_to_load_templates'
                          )
                );
            }
        } finally {
            if (requestIdRef.current === requestId) {
                setLoading(false);
            }
        }
    }, [currentUserId, messageType, t]);

    useEffect(() => {
        reload();
        return () => {
            requestIdRef.current += 1;
        };
    }, [endpoint, reload]);

    useEffect(() => {
        const intervalId = window.setInterval(() => setNowMs(Date.now()), 5000);
        return () => window.clearInterval(intervalId);
    }, []);

    const save = useCallback(
        async (row: InviteMessageRow, message: string) => {
            await saveInviteMessage({
                currentUserId,
                messageType,
                row,
                message,
                t
            });
            await reload();
        },
        [currentUserId, messageType, reload, t]
    );

    return { rows, loading, error, nowMs, reload, save };
}
