import { KeyRoundIcon, QrCodeIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    DeviceLoginNotice,
    DeviceLoginQrCode,
    DeviceLoginSteps,
    DeviceLoginWaitingStatus
} from '@/components/device-login/DeviceLoginQr';
import { commands, type FeedLoggerSession } from '@/platform/tauri/bindings';
import { useOfflineRecordStore } from '@/state/offlineRecordStore';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Field,
    FieldContent,
    FieldDescription,
    FieldGroup,
    FieldLabel
} from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { runThenRefreshStatus, type RunAction } from './offlineRecordModel';

function RiskNotice({
    acknowledged,
    onAcknowledgedChange
}: {
    acknowledged: boolean;
    onAcknowledgedChange: (acknowledged: boolean) => void;
}) {
    const { t } = useTranslation();
    return (
        <Alert>
            <TriangleAlertIcon className="text-[var(--status-askme)]" />
            <AlertTitle>{t('offline_record.risk_title')}</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
                <p className="text-xs leading-relaxed">
                    {t('offline_record.risk_description')}
                </p>
                <label className="flex items-center gap-2 text-xs">
                    <Checkbox
                        checked={acknowledged}
                        onCheckedChange={onAcknowledgedChange}
                    />
                    {t('offline_record.risk_ack')}
                </label>
            </AlertDescription>
        </Alert>
    );
}

function CredentialsForm({
    busy,
    savedCredentialsAvailable,
    run
}: {
    busy: boolean;
    savedCredentialsAvailable: boolean;
    run: RunAction;
}) {
    const { t } = useTranslation();
    const [savePassword, setSavePassword] = useState(true);

    return (
        <div className="flex flex-col gap-4">
            <Field orientation="horizontal" data-disabled={busy}>
                <FieldContent>
                    <FieldLabel htmlFor="offline-record-save-password">
                        {t('offline_record.save_password')}
                    </FieldLabel>
                    <FieldDescription>
                        {t('offline_record.save_password_description')}
                    </FieldDescription>
                </FieldContent>
                <Switch
                    id="offline-record-save-password"
                    checked={savePassword}
                    disabled={busy}
                    onCheckedChange={setSavePassword}
                />
            </Field>
            {savedCredentialsAvailable ? (
                <div className="flex justify-end">
                    <Button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                            void runThenRefreshStatus(run, () =>
                                commands.appFeedLoggerPushSavedCredentials(
                                    savePassword
                                )
                            )
                        }
                    >
                        {t('offline_record.push_saved_credentials')}
                    </Button>
                </div>
            ) : (
                <ManualCredentials
                    busy={busy}
                    savePassword={savePassword}
                    run={run}
                />
            )}
        </div>
    );
}

function ManualCredentials({
    busy,
    savePassword,
    run
}: {
    busy: boolean;
    savePassword: boolean;
    run: RunAction;
}) {
    const { t } = useTranslation();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    return (
        <>
            <FieldGroup className="gap-3">
                <Field data-disabled={busy}>
                    <FieldLabel htmlFor="offline-record-username">
                        {t('offline_record.vrchat_username')}
                    </FieldLabel>
                    <Input
                        id="offline-record-username"
                        autoComplete="off"
                        value={username}
                        disabled={busy}
                        onChange={(event) => setUsername(event.target.value)}
                    />
                </Field>
                <Field data-disabled={busy}>
                    <FieldLabel htmlFor="offline-record-vrchat-password">
                        {t('offline_record.vrchat_password')}
                    </FieldLabel>
                    <Input
                        id="offline-record-vrchat-password"
                        type="password"
                        value={password}
                        disabled={busy}
                        onChange={(event) => setPassword(event.target.value)}
                    />
                </Field>
            </FieldGroup>
            <div className="flex justify-end">
                <Button
                    type="button"
                    disabled={busy || !username.trim() || !password}
                    onClick={() =>
                        void runThenRefreshStatus(run, async () => {
                            await commands.appFeedLoggerPushCredentials(
                                username.trim(),
                                password,
                                savePassword
                            );
                            setPassword('');
                        })
                    }
                >
                    {t('offline_record.push_credentials')}
                </Button>
            </div>
        </>
    );
}

function TwoFactorForm({
    busy,
    methods,
    run
}: {
    busy: boolean;
    methods: string[];
    run: RunAction;
}) {
    const { t } = useTranslation();
    const [method, setMethod] = useState(methods[0] ?? 'totp');
    const [code, setCode] = useState('');
    const methodItems = methods.map((value) => ({
        value,
        label: t(`offline_record.two_factor_method.${value}`, {
            defaultValue: value
        })
    }));

    return (
        <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-xs leading-relaxed">
                {t('offline_record.two_factor_description')}
            </p>
            <div className="flex gap-2">
                {methodItems.length > 1 ? (
                    <Select
                        value={method}
                        items={methodItems}
                        onValueChange={(value) => {
                            if (value) {
                                setMethod(value);
                            }
                        }}
                    >
                        <SelectTrigger className="w-40">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {methodItems.map((item) => (
                                    <SelectItem
                                        key={item.value}
                                        value={item.value}
                                    >
                                        {item.label}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                ) : null}
                <Input
                    aria-label={t('offline_record.two_factor_code')}
                    placeholder={t('offline_record.two_factor_code')}
                    autoComplete="one-time-code"
                    value={code}
                    disabled={busy}
                    onChange={(event) => setCode(event.target.value)}
                />
                <Button
                    type="button"
                    disabled={busy || !code.trim()}
                    onClick={() =>
                        void runThenRefreshStatus(run, () =>
                            commands.appFeedLoggerSubmitTwoFactor(
                                method,
                                code.trim()
                            )
                        )
                    }
                >
                    {t('offline_record.verify')}
                </Button>
            </div>
        </div>
    );
}

const DEVICE_LOGIN_PROTOCOL_VERSION = 2;
const DEVICE_LOGIN_STATUS_POLL_MS = 3000;

function DeviceLoginForm({ busy, run }: { busy: boolean; run: RunAction }) {
    const { t } = useTranslation();
    const deviceLogin = useOfflineRecordStore((state) =>
        state.health?.state === 'connected'
            ? (state.health.status.deviceLogin ?? null)
            : null
    );
    const waiting = deviceLogin?.state === 'waiting';

    useEffect(() => {
        if (!waiting) {
            return undefined;
        }
        const timer = window.setInterval(() => {
            commands.appFeedLoggerStatus().catch(() => {});
        }, DEVICE_LOGIN_STATUS_POLL_MS);
        return () => window.clearInterval(timer);
    }, [waiting]);

    const start = () =>
        void runThenRefreshStatus(run, () =>
            commands.appFeedLoggerStartDeviceLogin()
        );

    if (deviceLogin?.state === 'waiting') {
        return (
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-5">
                    <DeviceLoginQrCode value={deviceLogin.verificationUrl} />
                    <div className="flex min-w-0 flex-1 flex-col gap-3">
                        <DeviceLoginSteps />
                        <p className="text-muted-foreground text-xs leading-relaxed">
                            {t('offline_record.qr_description')}
                        </p>
                        <DeviceLoginWaitingStatus
                            expiresAt={deviceLogin.expiresAt}
                        />
                    </div>
                </div>
                <DeviceLoginNotice
                    message={t('offline_record.qr_no_auto_relogin')}
                />
                <div className="flex justify-end">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                            void runThenRefreshStatus(run, () =>
                                commands.appFeedLoggerCancelDeviceLogin()
                            )
                        }
                    >
                        {t('offline_record.qr_cancel')}
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {deviceLogin?.state === 'expired' ? (
                <p className="text-muted-foreground text-xs">
                    {t('device_login.expired_title')}
                </p>
            ) : null}
            {deviceLogin?.state === 'failed' ? (
                <p className="text-destructive text-xs leading-relaxed">
                    {t('offline_record.login_failed_reason', {
                        reason: deviceLogin.reason
                    })}
                </p>
            ) : null}
            <DeviceLoginNotice
                message={t('offline_record.qr_no_auto_relogin')}
            />
            <div className="flex justify-end">
                <Button type="button" disabled={busy} onClick={start}>
                    <QrCodeIcon data-icon="inline-start" />
                    {deviceLogin
                        ? t('device_login.refresh')
                        : t('offline_record.qr_start')}
                </Button>
            </div>
        </div>
    );
}

export function VrchatLoginForm({
    session,
    busy,
    savedCredentialsAvailable,
    run
}: {
    session: FeedLoggerSession;
    busy: boolean;
    savedCredentialsAvailable: boolean;
    run: RunAction;
}) {
    const { t } = useTranslation();
    const acknowledged = useOfflineRecordStore(
        (state) => state.riskAcknowledged
    );
    const setAcknowledged = useOfflineRecordStore(
        (state) => state.setRiskAcknowledged
    );
    const deviceLoginSupported = useOfflineRecordStore(
        (state) =>
            state.health?.state === 'connected' &&
            state.health.status.protocolVersion >= DEVICE_LOGIN_PROTOCOL_VERSION
    );
    const [method, setMethod] = useState<'password' | 'qr'>(() => {
        const health = useOfflineRecordStore.getState().health;
        return health?.state === 'connected' &&
            health.status.deviceLogin?.state === 'waiting'
            ? 'qr'
            : 'password';
    });
    const credentials = (
        <CredentialsForm
            busy={busy || !acknowledged}
            savedCredentialsAvailable={savedCredentialsAvailable}
            run={run}
        />
    );

    return (
        <div className="flex flex-col gap-4">
            <RiskNotice
                acknowledged={acknowledged}
                onAcknowledgedChange={setAcknowledged}
            />
            {session.state === 'loginFailed' ? (
                <p className="text-destructive text-xs leading-relaxed">
                    {t('offline_record.login_failed_reason', {
                        reason: session.reason
                    })}
                </p>
            ) : null}
            {session.state === 'awaitingTwoFactor' ? (
                <TwoFactorForm
                    busy={busy || !acknowledged}
                    methods={session.methods}
                    run={run}
                />
            ) : deviceLoginSupported ? (
                <Tabs
                    value={method}
                    onValueChange={(value) =>
                        setMethod(value === 'qr' ? 'qr' : 'password')
                    }
                >
                    <TabsList className="w-full">
                        <TabsTrigger value="password">
                            <KeyRoundIcon />
                            {t('offline_record.login_method_password')}
                        </TabsTrigger>
                        <TabsTrigger value="qr">
                            <QrCodeIcon />
                            {t('offline_record.login_method_qr')}
                        </TabsTrigger>
                    </TabsList>
                    <TabsContent value="password" className="pt-2">
                        {credentials}
                    </TabsContent>
                    <TabsContent value="qr" className="pt-2">
                        <DeviceLoginForm
                            busy={busy || !acknowledged}
                            run={run}
                        />
                    </TabsContent>
                </Tabs>
            ) : (
                <>
                    {credentials}
                    <p className="text-muted-foreground text-xs">
                        {t('offline_record.qr_requires_update')}
                    </p>
                </>
            )}
        </div>
    );
}
