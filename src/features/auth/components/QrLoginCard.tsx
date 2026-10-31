import { ArrowLeftIcon, Clock3Icon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    DeviceLoginNotice,
    DeviceLoginQrCode,
    DeviceLoginSteps,
    DeviceLoginWaitingStatus
} from '@/components/device-login/DeviceLoginQr';
import type { PendingDeviceLogin } from '@/state/deviceLoginStore';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Spinner } from '@/ui/shadcn/spinner';

export type QrLoginView =
    | { status: 'closed' }
    | { status: 'starting' }
    | { status: 'expired' }
    | { status: 'failed'; reason: string };

type QrLoginCardProps = {
    view: QrLoginView;
    pending: PendingDeviceLogin | null;
    onCancel: () => void;
    onRetry: () => void;
    onUsePassword: () => void;
};

export function QrLoginCard({
    view,
    pending,
    onCancel,
    onRetry,
    onUsePassword
}: QrLoginCardProps) {
    const { t } = useTranslation();

    return (
        <Card className="flex flex-1 flex-col gap-3 pt-2">
            <CardHeader>
                <Button
                    type="button"
                    variant="link"
                    className="text-muted-foreground h-auto w-fit p-0 text-xs"
                    disabled={!pending && view.status === 'starting'}
                    onClick={pending ? onCancel : onUsePassword}
                >
                    <ArrowLeftIcon data-icon="inline-start" />
                    {t('view.login.qr.use_password')}
                </Button>
                <CardTitle className="text-center">
                    {t('view.login.qr.title')}
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
                {pending ? (
                    <>
                        <DeviceLoginQrCode
                            value={pending.verificationUrl}
                            className="self-center"
                        />
                        <DeviceLoginSteps />
                        <DeviceLoginWaitingStatus
                            expiresAt={pending.expiresAt}
                        />
                        <DeviceLoginNotice
                            message={t('device_login.no_auto_relogin')}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            onClick={onCancel}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                    </>
                ) : view.status === 'expired' ? (
                    <>
                        <div className="bg-muted/40 flex flex-col items-center gap-2 self-center rounded-lg border px-6 py-8 text-center">
                            <Clock3Icon className="size-7" />
                            <span className="text-sm font-medium">
                                {t('device_login.expired_title')}
                            </span>
                            <span className="text-muted-foreground text-xs">
                                {t('device_login.expired_description')}
                            </span>
                        </div>
                        <Button
                            type="button"
                            className="w-full"
                            onClick={onRetry}
                        >
                            {t('device_login.refresh')}
                        </Button>
                    </>
                ) : view.status === 'failed' ? (
                    <>
                        <div className="bg-muted/40 flex flex-col items-center gap-2 self-center rounded-lg border px-6 py-8 text-center">
                            <TriangleAlertIcon className="text-destructive size-7" />
                            <span className="text-sm font-medium">
                                {t('device_login.failed_title')}
                            </span>
                            <span className="text-muted-foreground max-w-xs text-xs break-words">
                                {view.reason}
                            </span>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                className="flex-1"
                                onClick={onUsePassword}
                            >
                                {t('view.login.qr.use_password')}
                            </Button>
                            <Button
                                type="button"
                                className="flex-1"
                                onClick={onRetry}
                            >
                                {t('device_login.retry')}
                            </Button>
                        </div>
                    </>
                ) : (
                    <div className="flex justify-center py-16">
                        <Spinner className="text-muted-foreground" />
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
