import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type FormEvent
} from 'react';
import { useTranslation } from 'react-i18next';

import { commands, type BootstrapStatus } from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';

export function LoginStorageSettings({
    backendConnected,
    onBackendConnected,
    onBeforeOpen,
    variant = 'button'
}: {
    backendConnected: boolean;
    onBackendConnected?: () => void;
    onBeforeOpen?: () => void;
    variant?: 'button' | 'bootstrap';
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState<BootstrapStatus | null>(null);
    const [useRemote, setUseRemote] = useState(false);
    const [serverUrl, setServerUrl] = useState('');
    const [token, setToken] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const statusLoaded = useRef(false);
    const serverUrlRef = useRef('');
    const openRef = useRef(false);
    const mountedRef = useRef(true);
    const probeInFlightRef = useRef(false);
    const requestGenerationRef = useRef(0);
    const connectedNotifiedRef = useRef(backendConnected);

    const notifyConnected = useCallback(() => {
        if (!connectedNotifiedRef.current) {
            connectedNotifiedRef.current = true;
            onBackendConnected?.();
        }
    }, [onBackendConnected]);

    const setDialogOpen = (nextOpen: boolean) => {
        openRef.current = nextOpen;
        setOpen(nextOpen);
        if (!nextOpen && variant === 'bootstrap' && status?.connected) {
            notifyConnected();
        }
    };

    useEffect(() => {
        let active = true;
        mountedRef.current = true;
        let timer: number | null = null;
        const refresh = async () => {
            if (probeInFlightRef.current) return;
            probeInFlightRef.current = true;
            const generation = requestGenerationRef.current;
            try {
                const next = await commands.appBootstrapStatusGet();
                if (!active || generation !== requestGenerationRef.current)
                    return;
                setStatus(next);
                if (!statusLoaded.current) {
                    setUseRemote(next.isRemote);
                    statusLoaded.current = true;
                }
                if (next.serverUrl && !serverUrlRef.current) {
                    serverUrlRef.current = next.serverUrl;
                    setServerUrl((current) => current || next.serverUrl || '');
                }
                if (
                    next.connected &&
                    !(variant === 'bootstrap' && openRef.current)
                ) {
                    notifyConnected();
                    if (timer !== null) {
                        window.clearInterval(timer);
                        timer = null;
                    }
                }
            } catch (loadError) {
                if (active && generation === requestGenerationRef.current) {
                    setError(errorMessage(loadError));
                }
            } finally {
                probeInFlightRef.current = false;
            }
        };
        void refresh();
        timer = backendConnected
            ? null
            : window.setInterval(() => void refresh(), 1500);
        return () => {
            active = false;
            mountedRef.current = false;
            if (timer !== null) window.clearInterval(timer);
        };
    }, [backendConnected, notifyConnected, onBackendConnected, variant]);

    const run = async (action: () => Promise<BootstrapStatus>) => {
        requestGenerationRef.current += 1;
        setBusy(true);
        setError(null);
        try {
            const next = await action();
            if (!mountedRef.current) return;
            setStatus(next);
            if (next.connected) {
                setDialogOpen(false);
                notifyConnected();
            }
        } catch (actionError) {
            if (mountedRef.current) setError(errorMessage(actionError));
        } finally {
            if (mountedRef.current) setBusy(false);
        }
    };

    const connect = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        requestGenerationRef.current += 1;
        setBusy(true);
        setError(null);
        try {
            let latestStatus: BootstrapStatus | null = null;
            if (!backendConnected) {
                try {
                    latestStatus = await commands.appBootstrapStatusGet();
                } catch {
                    // Bootstrap connect/choose commands remain available without status.
                }
            }
            if (!mountedRef.current) return;
            if (latestStatus) setStatus(latestStatus);
            if (latestStatus?.connected || backendConnected) {
                await commands.appBootstrapSaveStorage(
                    useRemote,
                    serverUrl.trim(),
                    token
                );
                if (!mountedRef.current) return;
                setToken('');
                setDialogOpen(false);
                notifyConnected();
                return;
            }
            let next = useRemote
                ? await commands.appBootstrapConnect(serverUrl.trim(), token)
                : await commands.appBootstrapChooseLocal();
            if (!mountedRef.current) return;
            const requestedUrl = serverUrl.trim().replace(/\/+$/, '');
            const connectedUrl = (next.serverUrl || '').replace(/\/+$/, '');
            if (
                next.connected &&
                (next.isRemote !== useRemote ||
                    (useRemote && connectedUrl !== requestedUrl))
            ) {
                await commands.appBootstrapSaveStorage(
                    useRemote,
                    serverUrl.trim(),
                    token
                );
                if (!mountedRef.current) return;
                setToken('');
                setDialogOpen(false);
                notifyConnected();
                return;
            }
            setStatus(next);
            if (next.connected) {
                setDialogOpen(false);
                notifyConnected();
            }
            setToken('');
        } catch (actionError) {
            if (mountedRef.current) setError(errorMessage(actionError));
        } finally {
            if (mountedRef.current) setBusy(false);
        }
    };

    const isConnecting = busy || Boolean(status?.connecting);

    return (
        <>
            {variant === 'bootstrap' ? (
                <div className="space-y-3">
                    <p className="text-muted-foreground text-sm" role="status">
                        {status?.connecting
                            ? t('view.login.storage.connecting')
                            : status?.isRemote
                              ? t('view.login.storage.connectionUnavailable')
                              : t('view.login.storage.initializing')}
                    </p>
                    {error || status?.error ? (
                        <p role="alert" className="text-destructive text-sm">
                            {error || status?.error}
                        </p>
                    ) : null}
                    <Button
                        className="w-full"
                        type="button"
                        onClick={() => setDialogOpen(true)}
                    >
                        {t('view.login.storage.configure')}
                    </Button>
                </div>
            ) : (
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                        onBeforeOpen?.();
                        setDialogOpen(true);
                    }}
                >
                    {t('view.login.storage.option')}
                </Button>
            )}
            <Dialog open={open} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {t('view.login.storage.title')}
                        </DialogTitle>
                        <DialogDescription>
                            {t('view.login.storage.description')}
                        </DialogDescription>
                    </DialogHeader>
                    <form className="space-y-4" onSubmit={connect}>
                        <label className="flex items-start gap-3 text-sm">
                            <input
                                type="radio"
                                name="storage-mode"
                                checked={!useRemote}
                                disabled={isConnecting}
                                onChange={() => setUseRemote(false)}
                            />
                            <span>{t('view.login.storage.local')}</span>
                        </label>
                        <label className="flex items-start gap-3 text-sm">
                            <input
                                type="radio"
                                name="storage-mode"
                                checked={useRemote}
                                disabled={isConnecting}
                                onChange={() => setUseRemote(true)}
                            />
                            <span>{t('view.login.storage.remote')}</span>
                        </label>
                        {useRemote ? (
                            <div className="space-y-3 pl-6">
                                <label className="block space-y-1.5 text-sm font-medium">
                                    {t('view.login.storage.serverUrl')}
                                    <Input
                                        type="url"
                                        autoComplete="url"
                                        placeholder="https://vrcx.example.com"
                                        value={serverUrl}
                                        disabled={isConnecting}
                                        onChange={(event) =>
                                            setServerUrl(event.target.value)
                                        }
                                        required
                                    />
                                </label>
                                <label className="block space-y-1.5 text-sm font-medium">
                                    {t('view.login.storage.accessToken')}
                                    <Input
                                        type="password"
                                        autoComplete="current-password"
                                        value={token}
                                        disabled={isConnecting}
                                        onChange={(event) =>
                                            setToken(event.target.value)
                                        }
                                        required={!backendConnected}
                                        placeholder={
                                            backendConnected
                                                ? t(
                                                      'view.login.storage.keepCurrentToken'
                                                  )
                                                : undefined
                                        }
                                    />
                                </label>
                            </div>
                        ) : null}
                        {error || status?.error ? (
                            <p
                                role="alert"
                                className="text-destructive text-sm"
                            >
                                {error || status?.error}
                            </p>
                        ) : null}
                        <DialogFooter>
                            {!backendConnected &&
                            useRemote &&
                            status?.isRemote ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={isConnecting}
                                    onClick={() =>
                                        void run(() =>
                                            commands.appBootstrapRetrySaved()
                                        )
                                    }
                                >
                                    {t('view.login.storage.retrySaved')}
                                </Button>
                            ) : null}
                            <Button type="submit" disabled={isConnecting}>
                                {busy
                                    ? t('view.login.storage.working')
                                    : backendConnected
                                      ? t('view.login.storage.saveRestart')
                                      : useRemote
                                        ? t('view.login.storage.connect')
                                        : t('view.login.storage.useLocal')}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
