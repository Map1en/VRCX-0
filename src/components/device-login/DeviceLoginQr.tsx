import { InfoIcon } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { Spinner } from '@/ui/shadcn/spinner';

function secondsUntil(expiresAt: number): number {
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}

function formatRemaining(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function DeviceLoginQrCode({
    value,
    size = 184,
    dimmed = false,
    className
}: {
    value: string;
    size?: number;
    dimmed?: boolean;
    className?: string;
}) {
    const { t } = useTranslation();

    return (
        <div
            className={cn(
                'shrink-0 rounded-lg bg-white p-2.5 transition-opacity',
                dimmed && 'opacity-20',
                className
            )}
        >
            <QRCodeSVG
                value={value}
                size={size}
                marginSize={0}
                title={t('device_login.qr_label')}
            />
        </div>
    );
}

export function DeviceLoginSteps({ className }: { className?: string }) {
    const { t } = useTranslation();

    return (
        <ol
            className={cn(
                'text-foreground/85 flex list-decimal flex-col gap-1 pl-5 text-sm leading-relaxed',
                className
            )}
        >
            <li>{t('device_login.steps.scan')}</li>
            <li>{t('device_login.steps.approve')}</li>
        </ol>
    );
}

export function DeviceLoginWaitingStatus({
    expiresAt,
    className
}: {
    expiresAt: number;
    className?: string;
}) {
    const { t } = useTranslation();
    const [remaining, setRemaining] = useState(() => secondsUntil(expiresAt));

    useEffect(() => {
        setRemaining(secondsUntil(expiresAt));
        const timer = window.setInterval(() => {
            setRemaining(secondsUntil(expiresAt));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [expiresAt]);

    return (
        <div
            className={cn(
                'flex items-center justify-between gap-3 text-sm',
                className
            )}
        >
            <span className="flex items-center gap-2">
                <Spinner />
                {t('device_login.waiting')}
            </span>
            <span className="text-muted-foreground tabular-nums">
                {t('device_login.expires_in', {
                    time: formatRemaining(remaining)
                })}
            </span>
        </div>
    );
}

export function DeviceLoginNotice({ message }: { message: string }) {
    return (
        <Alert>
            <InfoIcon />
            <AlertDescription>{message}</AlertDescription>
        </Alert>
    );
}
