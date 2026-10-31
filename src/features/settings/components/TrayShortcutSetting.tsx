import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    formatKeyboardShortcut,
    KeyboardShortcut
} from '@/components/keyboard/KeyboardShortcut';
import { trayShortcutKeys } from '@/components/keyboard/trayShortcutKeys';
import type {
    TrayShortcutBinding,
    TrayShortcutError
} from '@/platform/tauri/bindings';
import { tauriEvents } from '@/platform/tauri/events';
import {
    checkTrayShortcut,
    initializeTrayShortcut,
    setTrayShortcut,
    setTrayShortcutRecording
} from '@/services/trayShortcutService';
import { useTrayShortcutStore } from '@/state/trayShortcutStore';
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

import { Field } from './SettingsField';

export function TrayShortcutSetting() {
    const { t } = useTranslation();
    const snapshot = useTrayShortcutStore((state) => state.snapshot);
    const [editing, setEditing] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<TrayShortcutError | null>(null);

    useEffect(() => {
        if (snapshot) return;
        let disposed = false;
        void initializeTrayShortcut().catch(() => {
            if (!disposed) setError('unavailable');
        });
        return () => {
            disposed = true;
        };
    }, [snapshot]);

    async function save(binding: TrayShortcutBinding | null): Promise<void> {
        setPending(true);
        setError(null);
        try {
            const result = await setTrayShortcut(binding);
            if (result.kind === 'failed') {
                setError(result.error);
                return;
            }
            setEditing(false);
        } catch {
            setError('unavailable');
        } finally {
            setPending(false);
        }
    }

    const unavailable = snapshot?.status === 'unavailable';
    const unsupported = snapshot?.status === 'unsupported';

    return (
        <>
            <Field
                settingId="system.window.tray-shortcut"
                label={t('shortcuts.tray.title')}
                description={
                    <>
                        {t('shortcuts.tray.description')}
                        <br />
                        {t('shortcuts.tray.background_hint')}
                    </>
                }
                error={
                    !editing && error
                        ? t(`shortcuts.tray.error.${error}`)
                        : undefined
                }
            >
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={pending || !snapshot || unsupported}
                        onClick={() => {
                            setError(null);
                            setEditing(true);
                        }}
                        aria-label={t('shortcuts.tray.configure')}
                    >
                        {snapshot?.binding ? (
                            <KeyboardShortcut
                                keys={trayShortcutKeys(snapshot.binding)}
                            />
                        ) : (
                            t(
                                snapshot
                                    ? 'shortcuts.tray.unset'
                                    : 'common.loading'
                            )
                        )}
                    </Button>
                    {snapshot?.binding ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => void save(null)}
                        >
                            {t('common.actions.clear')}
                        </Button>
                    ) : null}
                    {unavailable ? (
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={pending}
                            onClick={() => void save(snapshot.binding)}
                        >
                            {t('common.action.retry')}
                        </Button>
                    ) : null}
                    {!snapshot && error ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                                void initializeTrayShortcut().catch(() =>
                                    setError('unavailable')
                                )
                            }
                        >
                            {t('common.action.retry')}
                        </Button>
                    ) : null}
                    {unavailable || unsupported ? (
                        <span className="text-muted-foreground text-xs">
                            {t(
                                `shortcuts.tray.${unsupported ? 'unsupported' : 'inactive'}`
                            )}
                        </span>
                    ) : null}
                </div>
            </Field>
            {editing ? (
                <TrayShortcutRecorder
                    initialBinding={snapshot?.binding ?? null}
                    pending={pending}
                    error={error}
                    onErrorChange={setError}
                    onClose={() => {
                        if (!pending) {
                            setEditing(false);
                            setError(null);
                        }
                    }}
                    onSave={save}
                />
            ) : null}
        </>
    );
}

function TrayShortcutRecorder({
    initialBinding,
    pending,
    error,
    onErrorChange,
    onClose,
    onSave
}: {
    initialBinding: TrayShortcutBinding | null;
    pending: boolean;
    error: TrayShortcutError | null;
    onErrorChange: (error: TrayShortcutError | null) => void;
    onClose: () => void;
    onSave: (binding: TrayShortcutBinding) => Promise<void>;
}) {
    const { t } = useTranslation();
    const [binding, setBinding] = useState(initialBinding);
    const [recordingReady, setRecordingReady] = useState(false);
    const [recordingFailed, setRecordingFailed] = useState(false);
    const [checking, setChecking] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let disposed = false;
        let unsubscribe: (() => void) | undefined;
        const resumeRecording = () => {
            void setTrayShortcutRecording(true)
                .then((active) => {
                    if (!disposed) {
                        setRecordingReady(active);
                        setRecordingFailed(!active);
                    }
                })
                .catch(() => {
                    if (!disposed) {
                        setRecordingReady(false);
                        setRecordingFailed(true);
                    }
                });
        };
        const pauseRecording = () => setRecordingReady(false);
        void tauriEvents
            .subscribe<TrayShortcutBinding>(
                'trayShortcutRecorded',
                (recorded) => {
                    if (!disposed) setBinding(recorded);
                }
            )
            .then((dispose) => {
                if (disposed) {
                    dispose();
                    return;
                }
                unsubscribe = dispose;
                window.addEventListener('focus', resumeRecording);
                window.addEventListener('blur', pauseRecording);
                resumeRecording();
            })
            .catch(() => {
                if (!disposed) setRecordingFailed(true);
            });
        return () => {
            disposed = true;
            unsubscribe?.();
            window.removeEventListener('focus', resumeRecording);
            window.removeEventListener('blur', pauseRecording);
            void setTrayShortcutRecording(false).catch((failure: unknown) => {
                console.warn(
                    'Failed to stop tray shortcut recording:',
                    failure
                );
            });
        };
    }, []);

    useEffect(() => {
        if (recordingReady && !pending) inputRef.current?.focus();
    }, [recordingReady, pending]);

    useEffect(() => {
        onErrorChange(null);
        if (!binding) return;
        let disposed = false;
        setChecking(true);
        void checkTrayShortcut(binding)
            .then((failure) => {
                if (!disposed) onErrorChange(failure);
            })
            .catch(() => {
                if (!disposed) onErrorChange('unavailable');
            })
            .finally(() => {
                if (!disposed) setChecking(false);
            });
        return () => {
            disposed = true;
        };
    }, [binding, onErrorChange]);

    const message = recordingFailed
        ? t('shortcuts.tray.recording_failed')
        : error && t(`shortcuts.tray.error.${error}`);
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <DialogContent className="sm:max-w-md" initialFocus={inputRef}>
                <DialogHeader>
                    <DialogTitle>{t('shortcuts.tray.configure')}</DialogTitle>
                    <DialogDescription>
                        {t('shortcuts.tray.record_description')}
                    </DialogDescription>
                </DialogHeader>
                <Input
                    ref={inputRef}
                    readOnly
                    disabled={!recordingReady || pending}
                    aria-label={t('shortcuts.tray.record')}
                    aria-invalid={Boolean(message)}
                    aria-describedby={
                        message ? 'tray-shortcut-error' : undefined
                    }
                    placeholder={t('shortcuts.tray.record')}
                    value={
                        binding
                            ? formatKeyboardShortcut(trayShortcutKeys(binding))
                            : ''
                    }
                    onKeyDown={(event) => {
                        if (event.key === 'Escape' || event.key === 'Tab')
                            return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (event.metaKey) return;
                        if (
                            event.repeat ||
                            event.nativeEvent.isComposing ||
                            /^(Control|Alt|Shift|Meta)/.test(event.code)
                        )
                            return;
                        setBinding({
                            control: event.ctrlKey,
                            alt: event.altKey,
                            shift: event.shiftKey,
                            key: event.code
                        });
                    }}
                />
                {checking ? (
                    <p role="status" className="text-muted-foreground text-sm">
                        {t('shortcuts.tray.checking')}
                    </p>
                ) : null}
                {message ? (
                    <p
                        id="tray-shortcut-error"
                        role="alert"
                        className="text-destructive text-sm"
                    >
                        {message}
                    </p>
                ) : null}
                <DialogFooter>
                    <Button
                        variant="outline"
                        disabled={pending}
                        onClick={onClose}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        disabled={
                            pending ||
                            !recordingReady ||
                            recordingFailed ||
                            !binding ||
                            checking ||
                            Boolean(error)
                        }
                        onClick={() => {
                            if (binding) void onSave(binding);
                        }}
                    >
                        {t('common.actions.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
