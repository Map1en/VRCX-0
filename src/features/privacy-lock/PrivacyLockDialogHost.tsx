import { useEffect } from 'react';

import { commands } from '@/platform/tauri/bindings';
import { tauriEvents } from '@/platform/tauri/events';
import {
    closePrivacyLockDialog,
    openPrivacyLockDialog,
    usePrivacyLockDialogStore
} from '@/state/privacyLockDialogStore';

import { PrivacyLockPasswordDialog } from './PrivacyLockPasswordDialog';

const SETUP_REQUESTED_EVENT = 'privacyLockSetupRequested';

function consumeSetupRequest() {
    commands
        .appPrivacyLockSetupRequestTake()
        .then((requested) => {
            if (requested) {
                openPrivacyLockDialog({ engageAfterSetup: true });
            }
        })
        .catch((error: unknown) => {
            console.warn('Unable to read privacy lock setup request:', error);
        });
}

export function PrivacyLockDialogHost() {
    const open = usePrivacyLockDialogStore((state) => state.open);
    const engageAfterSetup = usePrivacyLockDialogStore(
        (state) => state.engageAfterSetup
    );

    useEffect(() => {
        let disposed = false;
        let unlisten: (() => void) | undefined;
        consumeSetupRequest();
        tauriEvents
            .subscribe(SETUP_REQUESTED_EVENT, consumeSetupRequest)
            .then((unsubscribe) => {
                if (disposed) {
                    unsubscribe();
                    return;
                }
                unlisten = unsubscribe;
            })
            .catch((error: unknown) => {
                console.warn(
                    'Unable to subscribe privacy lock setup event:',
                    error
                );
            });
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);

    return (
        <PrivacyLockPasswordDialog
            open={open}
            engageAfterSetup={engageAfterSetup}
            onClose={closePrivacyLockDialog}
        />
    );
}
