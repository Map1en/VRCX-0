import {
    CloudIcon,
    DownloadIcon,
    KeyRoundIcon,
    RefreshCwIcon,
    SaveIcon,
    ShieldAlertIcon,
    UploadIcon,
    WifiIcon
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    commands,
    type CloudBackupProgress,
    type CloudBackupSettings,
    type RemoteBackupStatus,
    type RestorePreview
} from '@/platform/tauri/bindings';
import { subscribeTauriEvent } from '@/platform/tauri/events';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Progress } from '@/ui/shadcn/progress';
import { Switch } from '@/ui/shadcn/switch';

import { Field, SettingsGroup } from '../SettingsField';

const CLOUD_BACKUP_PROGRESS_EVENT = 'cloudBackupProgress';
const CLOUD_BACKUP_I18N = 'view.settings.advanced.advanced.cloud_backup';

type BusyOperation =
    | 'save'
    | 'clearCredential'
    | 'connectionTest'
    | 'remoteStatus'
    | 'upload'
    | 'restoreProbe'
    | 'restorePrepare'
    | 'restoreCommit'
    | 'restoreRollback';

type UploadDialogState = {
    open: boolean;
    encrypted: boolean;
    passphrase: string;
    passphraseConfirmation: string;
    unencryptedConfirmed: boolean;
};

type RestoreDialogState = {
    open: boolean;
    encrypted: boolean;
    passphrase: string;
    preview: RestorePreview | null;
    restoreConfirmed: boolean;
};

const closedUploadDialog: UploadDialogState = {
    open: false,
    encrypted: true,
    passphrase: '',
    passphraseConfirmation: '',
    unencryptedConfirmed: false
};

const closedRestoreDialog: RestoreDialogState = {
    open: false,
    encrypted: false,
    passphrase: '',
    preview: null,
    restoreConfirmed: false
};

const progressOrder = [
    'connect',
    'snapshot',
    'package',
    'compress',
    'encrypt',
    'upload',
    'download',
    'validate',
    'staging',
    'prepared',
    'rollbackSnapshot',
    'restartRequired',
    'completed'
];

function formatBytes(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) {
        return '-';
    }
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let size = Math.max(0, value);
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit += 1;
    }
    return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(value: string | null | undefined, locale: string): string {
    if (!value) {
        return '-';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'medium'
    }).format(date);
}

function cloudBackupErrorCode(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.match(/cloud_backup\.([a-z_]+)/)?.[1] || 'unknown';
}

export function SettingsCloudBackup() {
    const { t, i18n } = useTranslation();
    const [settings, setSettings] = useState<CloudBackupSettings | null>(null);
    const [serverUrl, setServerUrl] = useState('');
    const [remoteDirectory, setRemoteDirectory] = useState('VRCX-0');
    const [username, setUsername] = useState('');
    const [webDavPassword, setWebDavPassword] = useState('');
    const [busy, setBusy] = useState<BusyOperation | null>(null);
    const [remoteStatus, setRemoteStatus] = useState<RemoteBackupStatus | null>(
        null
    );
    const [operationProgress, setOperationProgress] =
        useState<CloudBackupProgress | null>(null);
    const [uploadDialog, setUploadDialog] =
        useState<UploadDialogState>(closedUploadDialog);
    const [restoreDialog, setRestoreDialog] =
        useState<RestoreDialogState>(closedRestoreDialog);
    const preparedRestoreIdRef = useRef<string | null>(null);

    useEffect(() => {
        let active = true;
        void commands
            .appCloudBackupSettingsGet()
            .then((value) => {
                if (!active) {
                    return;
                }
                setSettings(value);
                setServerUrl(value.serverUrl);
                setRemoteDirectory(value.remoteDirectory);
                setUsername(value.username);
            })
            .catch(() => {
                if (active) {
                    toast.error(t(`${CLOUD_BACKUP_I18N}.errors.settings_load`));
                }
            });
        return () => {
            active = false;
        };
    }, [t]);

    useEffect(() => {
        let unsubscribe: (() => void) | undefined;
        void subscribeTauriEvent<CloudBackupProgress>(
            CLOUD_BACKUP_PROGRESS_EVENT,
            setOperationProgress
        ).then((value) => {
            unsubscribe = value;
        });
        return () => unsubscribe?.();
    }, []);

    useEffect(
        () => () => {
            const restoreId = preparedRestoreIdRef.current;
            if (restoreId) {
                void commands.appCloudBackupRestoreDiscard(restoreId);
            }
        },
        []
    );

    const dirty = useMemo(() => {
        if (!settings) {
            return false;
        }
        return (
            settings.serverUrl !== serverUrl.trim() ||
            settings.remoteDirectory !== remoteDirectory.trim() ||
            settings.username !== username.trim() ||
            webDavPassword.length > 0
        );
    }, [remoteDirectory, serverUrl, settings, username, webDavPassword]);
    const hasCredential = Boolean(
        settings?.credential.stored || settings?.credential.sessionOnly
    );
    const manualActionsDisabled = Boolean(
        busy || dirty || !hasCredential || settings?.pendingRestorePhase
    );
    const progressValue = operationProgress
        ? Math.max(
              5,
              ((progressOrder.indexOf(operationProgress.phase) + 1) /
                  progressOrder.length) *
                  100
          )
        : 0;

    function showError(error: unknown) {
        const code = cloudBackupErrorCode(error);
        toast.error(
            t(`${CLOUD_BACKUP_I18N}.errors.${code}`, {
                defaultValue: t(`${CLOUD_BACKUP_I18N}.errors.unknown`)
            })
        );
    }

    function applySettings(value: CloudBackupSettings) {
        setSettings(value);
        setServerUrl(value.serverUrl);
        setRemoteDirectory(value.remoteDirectory);
        setUsername(value.username);
        setWebDavPassword('');
        setRemoteStatus(null);
    }

    async function saveSettings() {
        setBusy('save');
        try {
            const value = await commands.appCloudBackupSettingsSave({
                serverUrl,
                remoteDirectory,
                username,
                passwordUpdate: webDavPassword
                    ? { action: 'set', password: webDavPassword }
                    : { action: 'keep' }
            });
            applySettings(value);
            toast.success(t(`${CLOUD_BACKUP_I18N}.messages.settings_saved`));
            if (value.credential.sessionOnly) {
                toast.warning(
                    t(`${CLOUD_BACKUP_I18N}.messages.credential_session_only`)
                );
            }
        } catch (error) {
            showError(error);
        } finally {
            setBusy(null);
        }
    }

    async function clearCredential() {
        setBusy('clearCredential');
        try {
            const value = await commands.appCloudBackupCredentialClear();
            applySettings(value);
            toast.success(
                t(`${CLOUD_BACKUP_I18N}.messages.credential_cleared`)
            );
        } catch (error) {
            showError(error);
        } finally {
            setBusy(null);
        }
    }

    async function testConnection() {
        setBusy('connectionTest');
        try {
            await commands.appCloudBackupConnectionTest();
            toast.success(t(`${CLOUD_BACKUP_I18N}.messages.connection_ok`));
        } catch (error) {
            showError(error);
        } finally {
            setBusy(null);
        }
    }

    async function refreshRemoteStatus() {
        setBusy('remoteStatus');
        try {
            setRemoteStatus(await commands.appCloudBackupRemoteStatus());
        } catch (error) {
            showError(error);
        } finally {
            setBusy(null);
        }
    }

    function openUploadDialog() {
        setUploadDialog({
            ...closedUploadDialog,
            open: true
        });
    }

    async function uploadBackup() {
        setBusy('upload');
        setOperationProgress(null);
        try {
            await commands.appCloudBackupUpload({
                backupPassphrase: uploadDialog.encrypted
                    ? uploadDialog.passphrase
                    : null,
                confirmUnencrypted:
                    !uploadDialog.encrypted && uploadDialog.unencryptedConfirmed
            });
            setRemoteStatus(null);
            setUploadDialog(closedUploadDialog);
            toast.success(t(`${CLOUD_BACKUP_I18N}.messages.upload_complete`));
        } catch (error) {
            showError(error);
        } finally {
            setUploadDialog((value) => ({
                ...value,
                passphrase: '',
                passphraseConfirmation: ''
            }));
            setBusy(null);
        }
    }

    async function openRestoreDialog() {
        setBusy('restoreProbe');
        try {
            const probe = await commands.appCloudBackupRestoreProbe();
            setRemoteStatus(probe.remote);
            setRestoreDialog({
                ...closedRestoreDialog,
                open: true,
                encrypted: probe.encrypted
            });
        } catch (error) {
            showError(error);
        } finally {
            setBusy(null);
        }
    }

    async function prepareRestore() {
        setBusy('restorePrepare');
        setOperationProgress(null);
        try {
            const preview = await commands.appCloudBackupRestorePrepare({
                backupPassphrase: restoreDialog.encrypted
                    ? restoreDialog.passphrase
                    : null
            });
            preparedRestoreIdRef.current = preview.restoreId;
            setRestoreDialog((value) => ({
                ...value,
                passphrase: '',
                preview
            }));
        } catch (error) {
            showError(error);
            setRestoreDialog((value) => ({ ...value, passphrase: '' }));
        } finally {
            setBusy(null);
        }
    }

    async function closeRestoreDialog() {
        if (busy) {
            return;
        }
        const restoreId = restoreDialog.preview?.restoreId;
        preparedRestoreIdRef.current = null;
        setRestoreDialog(closedRestoreDialog);
        if (restoreId) {
            try {
                await commands.appCloudBackupRestoreDiscard(restoreId);
            } catch {
                // Startup cleanup removes uncommitted staging data if this best-effort cleanup fails.
            }
        }
    }

    async function commitRestore() {
        const restoreId = restoreDialog.preview?.restoreId;
        if (!restoreId || !restoreDialog.restoreConfirmed) {
            return;
        }
        setBusy('restoreCommit');
        try {
            await commands.appCloudBackupRestoreCommit(restoreId);
        } catch (error) {
            showError(error);
            setBusy(null);
        }
    }

    async function requestRollback() {
        setBusy('restoreRollback');
        try {
            const requested = await commands.appCloudBackupRestoreRollback();
            if (!requested) {
                setBusy(null);
            }
        } catch (error) {
            showError(error);
            setBusy(null);
        }
    }

    const uploadReady = uploadDialog.encrypted
        ? uploadDialog.passphrase.length > 0 &&
          uploadDialog.passphrase === uploadDialog.passphraseConfirmation
        : uploadDialog.unencryptedConfirmed;

    return (
        <>
            <SettingsGroup
                title={t(`${CLOUD_BACKUP_I18N}.header`)}
                description={t(`${CLOUD_BACKUP_I18N}.description`)}
            >
                <Field
                    label={t(`${CLOUD_BACKUP_I18N}.server_url`)}
                    description={t(`${CLOUD_BACKUP_I18N}.https_only`)}
                    controlClassName="lg:max-w-[34rem]"
                >
                    <Input
                        type="url"
                        value={serverUrl}
                        placeholder="https://dav.example.com/remote.php/dav/files/user/"
                        autoCapitalize="none"
                        autoCorrect="off"
                        disabled={Boolean(busy)}
                        onChange={(event) => setServerUrl(event.target.value)}
                    />
                </Field>
                <Field
                    label={t(`${CLOUD_BACKUP_I18N}.remote_directory`)}
                    description={t(`${CLOUD_BACKUP_I18N}.remote_file_hint`)}
                    controlClassName="lg:max-w-[34rem]"
                >
                    <Input
                        value={remoteDirectory}
                        disabled={Boolean(busy)}
                        onChange={(event) =>
                            setRemoteDirectory(event.target.value)
                        }
                    />
                </Field>
                <Field
                    label={t(`${CLOUD_BACKUP_I18N}.username`)}
                    controlClassName="lg:max-w-[34rem]"
                >
                    <Input
                        value={username}
                        autoCapitalize="none"
                        autoCorrect="off"
                        disabled={Boolean(busy)}
                        onChange={(event) => setUsername(event.target.value)}
                    />
                </Field>
                <Field
                    label={t(`${CLOUD_BACKUP_I18N}.webdav_password`)}
                    description={t(
                        `${CLOUD_BACKUP_I18N}.credential_description`
                    )}
                    controlClassName="lg:max-w-[34rem]"
                >
                    <Input
                        type="password"
                        value={webDavPassword}
                        placeholder={
                            hasCredential
                                ? t(`${CLOUD_BACKUP_I18N}.credential_saved`)
                                : t(`${CLOUD_BACKUP_I18N}.credential_not_saved`)
                        }
                        autoComplete="new-password"
                        disabled={Boolean(busy)}
                        onChange={(event) =>
                            setWebDavPassword(event.target.value)
                        }
                    />
                </Field>
                <Field
                    label={t(`${CLOUD_BACKUP_I18N}.credential_status`)}
                    description={
                        settings?.credential.sessionOnly
                            ? t(`${CLOUD_BACKUP_I18N}.credential_session_only`)
                            : settings && !settings.credential.available
                              ? t(
                                    `${CLOUD_BACKUP_I18N}.credential_store_unavailable`
                                )
                              : undefined
                    }
                >
                    <Badge variant={hasCredential ? 'secondary' : 'outline'}>
                        {hasCredential
                            ? t(`${CLOUD_BACKUP_I18N}.credential_available`)
                            : t(`${CLOUD_BACKUP_I18N}.credential_unavailable`)}
                    </Badge>
                </Field>
                <Field
                    label={t(`${CLOUD_BACKUP_I18N}.settings_actions`)}
                    controlClassName="flex-wrap gap-2"
                >
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={Boolean(busy) || !dirty}
                            onClick={saveSettings}
                        >
                            <SaveIcon className="size-4" />
                            {t(`${CLOUD_BACKUP_I18N}.save`)}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={Boolean(busy) || !hasCredential || dirty}
                            onClick={clearCredential}
                        >
                            <KeyRoundIcon className="size-4" />
                            {t(`${CLOUD_BACKUP_I18N}.clear_password`)}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={manualActionsDisabled}
                            onClick={testConnection}
                        >
                            <WifiIcon className="size-4" />
                            {t(`${CLOUD_BACKUP_I18N}.test_connection`)}
                        </Button>
                    </div>
                </Field>
                <Field
                    label={t(`${CLOUD_BACKUP_I18N}.remote_status`)}
                    description={
                        remoteStatus
                            ? remoteStatus.exists
                                ? t(`${CLOUD_BACKUP_I18N}.remote_exists`, {
                                      size: formatBytes(
                                          remoteStatus.contentLength
                                      ),
                                      date: formatDate(
                                          remoteStatus.lastModified,
                                          i18n.language
                                      )
                                  })
                                : t(`${CLOUD_BACKUP_I18N}.remote_missing`)
                            : t(`${CLOUD_BACKUP_I18N}.remote_not_checked`)
                    }
                    controlClassName="flex-wrap gap-2"
                >
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={manualActionsDisabled}
                            onClick={refreshRemoteStatus}
                        >
                            <RefreshCwIcon className="size-4" />
                            {t(`${CLOUD_BACKUP_I18N}.refresh_status`)}
                        </Button>
                    </div>
                </Field>
                <Field
                    label={t(`${CLOUD_BACKUP_I18N}.manual_operations`)}
                    description={t(`${CLOUD_BACKUP_I18N}.manual_only`)}
                    controlClassName="flex-wrap gap-2"
                >
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button
                            type="button"
                            disabled={manualActionsDisabled}
                            onClick={openUploadDialog}
                        >
                            <UploadIcon className="size-4" />
                            {t(`${CLOUD_BACKUP_I18N}.upload`)}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={manualActionsDisabled}
                            onClick={openRestoreDialog}
                        >
                            <DownloadIcon className="size-4" />
                            {t(`${CLOUD_BACKUP_I18N}.restore`)}
                        </Button>
                    </div>
                </Field>
                {busy && operationProgress && (
                    <div className="space-y-2 px-3 py-2">
                        <div className="text-muted-foreground flex justify-between text-xs">
                            <span>
                                {t(
                                    `${CLOUD_BACKUP_I18N}.progress.${operationProgress.phase}`,
                                    {
                                        defaultValue: operationProgress.phase
                                    }
                                )}
                            </span>
                            <span>{Math.round(progressValue)}%</span>
                        </div>
                        <Progress value={progressValue} />
                    </div>
                )}
                {settings?.pendingRestorePhase && (
                    <Alert variant="destructive" className="mx-3 mb-2 w-auto">
                        <ShieldAlertIcon />
                        <AlertTitle>
                            {t(`${CLOUD_BACKUP_I18N}.pending_restore`)}
                        </AlertTitle>
                        <AlertDescription>
                            {t(
                                `${CLOUD_BACKUP_I18N}.pending_restore_description`,
                                {
                                    phase: settings.pendingRestorePhase
                                }
                            )}
                            <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                className="mt-2"
                                disabled={Boolean(busy)}
                                onClick={requestRollback}
                            >
                                {t(`${CLOUD_BACKUP_I18N}.rollback`)}
                            </Button>
                        </AlertDescription>
                    </Alert>
                )}
            </SettingsGroup>

            <Dialog
                open={uploadDialog.open}
                onOpenChange={(open) => {
                    if (!open && !busy) {
                        setUploadDialog(closedUploadDialog);
                    }
                }}
            >
                <DialogContent
                    className="sm:max-w-lg"
                    showCloseButton={!Boolean(busy)}
                >
                    <DialogHeader>
                        <DialogTitle>
                            {t(`${CLOUD_BACKUP_I18N}.upload_dialog.title`)}
                        </DialogTitle>
                        <DialogDescription>
                            {t(
                                `${CLOUD_BACKUP_I18N}.upload_dialog.description`
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                        <div>
                            <div className="font-medium">
                                {t(
                                    `${CLOUD_BACKUP_I18N}.upload_dialog.encrypt`
                                )}
                            </div>
                            <div className="text-muted-foreground text-xs">
                                {t(
                                    `${CLOUD_BACKUP_I18N}.upload_dialog.encrypt_hint`
                                )}
                            </div>
                        </div>
                        <Switch
                            checked={uploadDialog.encrypted}
                            disabled={Boolean(busy)}
                            onCheckedChange={(encrypted) =>
                                setUploadDialog((value) => ({
                                    ...value,
                                    encrypted,
                                    unencryptedConfirmed: false
                                }))
                            }
                        />
                    </div>
                    {uploadDialog.encrypted ? (
                        <div className="space-y-3">
                            <label className="grid gap-1.5">
                                <span className="text-sm font-medium">
                                    {t(
                                        `${CLOUD_BACKUP_I18N}.upload_dialog.passphrase`
                                    )}
                                </span>
                                <Input
                                    type="password"
                                    value={uploadDialog.passphrase}
                                    autoComplete="new-password"
                                    disabled={Boolean(busy)}
                                    onChange={(event) =>
                                        setUploadDialog((value) => ({
                                            ...value,
                                            passphrase: event.target.value
                                        }))
                                    }
                                />
                            </label>
                            <label className="grid gap-1.5">
                                <span className="text-sm font-medium">
                                    {t(
                                        `${CLOUD_BACKUP_I18N}.upload_dialog.passphrase_confirm`
                                    )}
                                </span>
                                <Input
                                    type="password"
                                    value={uploadDialog.passphraseConfirmation}
                                    autoComplete="new-password"
                                    disabled={Boolean(busy)}
                                    aria-invalid={
                                        Boolean(
                                            uploadDialog.passphraseConfirmation
                                        ) &&
                                        uploadDialog.passphrase !==
                                            uploadDialog.passphraseConfirmation
                                    }
                                    onChange={(event) =>
                                        setUploadDialog((value) => ({
                                            ...value,
                                            passphraseConfirmation:
                                                event.target.value
                                        }))
                                    }
                                />
                            </label>
                            <p className="text-muted-foreground text-xs">
                                {t(
                                    `${CLOUD_BACKUP_I18N}.upload_dialog.passphrase_notice`
                                )}
                            </p>
                        </div>
                    ) : (
                        <Alert variant="destructive">
                            <ShieldAlertIcon />
                            <AlertTitle>
                                {t(
                                    `${CLOUD_BACKUP_I18N}.upload_dialog.unencrypted_title`
                                )}
                            </AlertTitle>
                            <AlertDescription>
                                {t(
                                    `${CLOUD_BACKUP_I18N}.upload_dialog.unencrypted_warning`
                                )}
                                <label className="mt-3 flex items-start gap-2 text-sm">
                                    <Checkbox
                                        checked={
                                            uploadDialog.unencryptedConfirmed
                                        }
                                        disabled={Boolean(busy)}
                                        onCheckedChange={(checked) =>
                                            setUploadDialog((value) => ({
                                                ...value,
                                                unencryptedConfirmed:
                                                    Boolean(checked)
                                            }))
                                        }
                                    />
                                    <span>
                                        {t(
                                            `${CLOUD_BACKUP_I18N}.upload_dialog.unencrypted_confirm`
                                        )}
                                    </span>
                                </label>
                            </AlertDescription>
                        </Alert>
                    )}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={Boolean(busy)}
                            onClick={() => setUploadDialog(closedUploadDialog)}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                        <Button
                            type="button"
                            variant={
                                uploadDialog.encrypted
                                    ? 'default'
                                    : 'destructive'
                            }
                            disabled={Boolean(busy) || !uploadReady}
                            onClick={uploadBackup}
                        >
                            <CloudIcon className="size-4" />
                            {t(`${CLOUD_BACKUP_I18N}.upload_dialog.submit`)}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={restoreDialog.open}
                onOpenChange={(open) => {
                    if (!open) {
                        void closeRestoreDialog();
                    }
                }}
            >
                <DialogContent
                    className="sm:max-w-lg"
                    showCloseButton={!Boolean(busy)}
                >
                    <DialogHeader>
                        <DialogTitle>
                            {t(`${CLOUD_BACKUP_I18N}.restore_dialog.title`)}
                        </DialogTitle>
                        <DialogDescription>
                            {restoreDialog.preview
                                ? t(
                                      `${CLOUD_BACKUP_I18N}.restore_dialog.preview_description`
                                  )
                                : t(
                                      `${CLOUD_BACKUP_I18N}.restore_dialog.prepare_description`
                                  )}
                        </DialogDescription>
                    </DialogHeader>
                    {!restoreDialog.preview ? (
                        <div className="space-y-3">
                            <Badge variant="outline">
                                {restoreDialog.encrypted
                                    ? t(
                                          `${CLOUD_BACKUP_I18N}.restore_dialog.encrypted`
                                      )
                                    : t(
                                          `${CLOUD_BACKUP_I18N}.restore_dialog.unencrypted`
                                      )}
                            </Badge>
                            {restoreDialog.encrypted && (
                                <label className="grid gap-1.5">
                                    <span className="text-sm font-medium">
                                        {t(
                                            `${CLOUD_BACKUP_I18N}.restore_dialog.passphrase`
                                        )}
                                    </span>
                                    <Input
                                        type="password"
                                        value={restoreDialog.passphrase}
                                        autoComplete="off"
                                        disabled={Boolean(busy)}
                                        onChange={(event) =>
                                            setRestoreDialog((value) => ({
                                                ...value,
                                                passphrase: event.target.value
                                            }))
                                        }
                                    />
                                </label>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border p-3 text-sm">
                                <dt className="text-muted-foreground">
                                    {t(
                                        `${CLOUD_BACKUP_I18N}.restore_dialog.created_at`
                                    )}
                                </dt>
                                <dd>
                                    {formatDate(
                                        restoreDialog.preview.createdAt,
                                        i18n.language
                                    )}
                                </dd>
                                <dt className="text-muted-foreground">
                                    {t(
                                        `${CLOUD_BACKUP_I18N}.restore_dialog.app_version`
                                    )}
                                </dt>
                                <dd>{restoreDialog.preview.appVersion}</dd>
                                <dt className="text-muted-foreground">
                                    {t(
                                        `${CLOUD_BACKUP_I18N}.restore_dialog.schema_version`
                                    )}
                                </dt>
                                <dd>
                                    {
                                        restoreDialog.preview
                                            .databaseSchemaVersion
                                    }
                                </dd>
                                <dt className="text-muted-foreground">
                                    {t(
                                        `${CLOUD_BACKUP_I18N}.restore_dialog.size`
                                    )}
                                </dt>
                                <dd>
                                    {formatBytes(
                                        restoreDialog.preview.archiveSize
                                    )}
                                </dd>
                            </dl>
                            <Alert variant="destructive">
                                <ShieldAlertIcon />
                                <AlertTitle>
                                    {t(
                                        `${CLOUD_BACKUP_I18N}.restore_dialog.confirm_title`
                                    )}
                                </AlertTitle>
                                <AlertDescription>
                                    {t(
                                        `${CLOUD_BACKUP_I18N}.restore_dialog.confirm_warning`
                                    )}
                                    <label className="mt-3 flex items-start gap-2 text-sm">
                                        <Checkbox
                                            checked={
                                                restoreDialog.restoreConfirmed
                                            }
                                            disabled={Boolean(busy)}
                                            onCheckedChange={(checked) =>
                                                setRestoreDialog((value) => ({
                                                    ...value,
                                                    restoreConfirmed:
                                                        Boolean(checked)
                                                }))
                                            }
                                        />
                                        <span>
                                            {t(
                                                `${CLOUD_BACKUP_I18N}.restore_dialog.confirm_checkbox`
                                            )}
                                        </span>
                                    </label>
                                </AlertDescription>
                            </Alert>
                        </div>
                    )}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={Boolean(busy)}
                            onClick={() => void closeRestoreDialog()}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                        {restoreDialog.preview ? (
                            <Button
                                type="button"
                                variant="destructive"
                                disabled={
                                    Boolean(busy) ||
                                    !restoreDialog.restoreConfirmed
                                }
                                onClick={commitRestore}
                            >
                                {t(
                                    `${CLOUD_BACKUP_I18N}.restore_dialog.restore_restart`
                                )}
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                disabled={
                                    Boolean(busy) ||
                                    (restoreDialog.encrypted &&
                                        !restoreDialog.passphrase)
                                }
                                onClick={prepareRestore}
                            >
                                {t(
                                    `${CLOUD_BACKUP_I18N}.restore_dialog.download_validate`
                                )}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
