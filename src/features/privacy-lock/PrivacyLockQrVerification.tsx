import { useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    DeviceLoginQrCode,
    DeviceLoginWaitingStatus
} from '@/components/device-login/DeviceLoginQr';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { commands } from '@/platform/tauri/bindings';
import { waitPrivacyLockDeviceVerification } from '@/services/privacyLockService';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

import { privacyLockOutcomeMessage } from './privacyLockOutcomeMessage';

export function PrivacyLockQrVerification({
    onVerified
}: {
    onVerified?: () => void;
}) {
    const { t } = useTranslation();
    const [round, setRound] = useState(0);
    const [pending, setPending] = useState<{
        verificationUrl: string;
        expiresAt: number;
    } | null>(null);
    const [phase, setPhase] = useState<
        'starting' | 'waiting' | 'expired' | 'failed'
    >('starting');
    const [error, setError] = useState('');
    const notifyVerified = useEffectEvent(() => onVerified?.());

    useEffect(() => {
        let active = true;
        setPending(null);
        setPhase('starting');

        async function verify() {
            const start = await commands.appPrivacyLockDeviceVerifyStart();
            if (!active) {
                return;
            }
            if (start.status !== 'pending') {
                setError(
                    start.status === 'failed'
                        ? start.reason
                        : t('privacy_lock.error.no_session')
                );
                setPhase('failed');
                return;
            }
            setPending(start);
            setPhase('waiting');
            const outcome = await waitPrivacyLockDeviceVerification(
                start.attemptId
            );
            if (!active || outcome.status === 'cancelled') {
                return;
            }
            if (outcome.status === 'ok') {
                notifyVerified();
                return;
            }
            if (outcome.status === 'deviceCodeExpired') {
                setPhase('expired');
                return;
            }
            setError(privacyLockOutcomeMessage(t, outcome));
            if (outcome.status === 'accountMismatch') {
                setRound((value) => value + 1);
                return;
            }
            setPhase('failed');
        }

        verify().catch((failure: unknown) => {
            if (active) {
                setError(
                    userFacingErrorMessage(
                        failure,
                        t('privacy_lock.error.failed')
                    )
                );
                setPhase('failed');
            }
        });
        return () => {
            active = false;
        };
    }, [round, t]);

    useEffect(
        () => () => {
            void commands.appPrivacyLockDeviceVerifyCancel();
        },
        []
    );

    function retry() {
        setError('');
        setRound((value) => value + 1);
    }

    return (
        <div className="flex w-full flex-col items-center gap-3">
            {phase === 'waiting' && pending ? (
                <>
                    <DeviceLoginQrCode
                        value={pending.verificationUrl}
                        size={164}
                    />
                    <p className="text-muted-foreground text-center text-xs">
                        {t('privacy_lock.recover.qr_description')}
                    </p>
                    <DeviceLoginWaitingStatus
                        expiresAt={pending.expiresAt}
                        className="w-full text-xs"
                    />
                </>
            ) : null}
            {phase === 'starting' ? <Spinner className="my-8" /> : null}
            {phase === 'expired' ? (
                <>
                    <p className="text-muted-foreground text-center text-xs">
                        {t('device_login.expired_title')}
                    </p>
                    <Button type="button" className="w-full" onClick={retry}>
                        {t('device_login.refresh')}
                    </Button>
                </>
            ) : null}
            {phase === 'failed' ? (
                <Button type="button" className="w-full" onClick={retry}>
                    {t('device_login.retry')}
                </Button>
            ) : null}
            {error ? (
                <p className="text-destructive text-center text-xs">{error}</p>
            ) : null}
        </div>
    );
}
