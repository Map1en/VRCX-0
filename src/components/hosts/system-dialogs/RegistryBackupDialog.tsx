// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateFilter } from '@/lib/dateTime.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { configRepository } from '@/repositories/index.js';
import {
    backupVrcRegistry,
    deleteVrcRegistryBackup,
    deleteVrcRegistryFolder,
    listVrcRegistryBackups,
    restoreVrcRegistryBackup,
    restoreVrcRegistryBackupFromFile,
    saveVrcRegistryBackupToFile
} from '@/services/registryBackupService.js';
import { useModalStore } from '@/state/modalStore.js';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Field, FieldContent, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

function formatBackupLabel(backup, t) {
    const dateLabel = backup.date
        ? formatDateFilter(backup.date, 'long')
        : t('common.no_data');
    return `${backup.name || t('dialog.registry_backup.backup')} - ${dateLabel}`;
}

function registryRestoreError(error, t) {
    const message = userFacingErrorMessage(error, '');
    return t('message.registry.restore_failed', { error: message });
}

export function RegistryBackupDialog({ open, onOpenChange }) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const refreshRequestRef = useRef(0);
    const [backups, setBackups] = useState([]);
    const [selectedKey, setSelectedKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [detail, setDetail] = useState('');
    const [autoBackup, setAutoBackup] = useState(false);
    const [askRestore, setAskRestore] = useState(false);
    const selectedBackup =
        backups.find((backup) => backup.key === selectedKey) || null;

    async function refreshBackups() {
        const requestId = refreshRequestRef.current + 1;
        refreshRequestRef.current = requestId;
        setLoading(true);
        setDetail('');
        try {
            const [nextBackups, nextAutoBackup, nextAskRestore] =
                await Promise.all([
                    listVrcRegistryBackups(),
                    configRepository.getBool('vrcRegistryAutoBackup', true),
                    configRepository.getBool('vrcRegistryAskRestore', true)
                ]);
            if (requestId !== refreshRequestRef.current) {
                return;
            }
            setBackups(nextBackups);
            setAutoBackup(Boolean(nextAutoBackup));
            setAskRestore(Boolean(nextAskRestore));
            setSelectedKey((current) =>
                nextBackups.some((backup) => backup.key === current)
                    ? current
                    : nextBackups[0]?.key || ''
            );
            if (nextBackups.length === 0) {
                setDetail(t('common.no_data'));
            }
        } catch (error) {
            if (requestId !== refreshRequestRef.current) {
                return;
            }
            setDetail(registryRestoreError(error, t));
        } finally {
            if (requestId === refreshRequestRef.current) {
                setLoading(false);
            }
        }
    }

    async function handleAutoBackupChange(value) {
        const nextValue = Boolean(value);
        setAutoBackup(nextValue);
        try {
            await configRepository.setBool('vrcRegistryAutoBackup', nextValue);
        } catch (error) {
            setAutoBackup(!nextValue);
            setDetail(registryRestoreError(error, t));
        }
    }

    async function handleAskRestoreChange(value) {
        const nextValue = Boolean(value);
        setAskRestore(nextValue);
        try {
            await configRepository.setBool('vrcRegistryAskRestore', nextValue);
        } catch (error) {
            setAskRestore(!nextValue);
            setDetail(registryRestoreError(error, t));
        }
    }

    useEffect(() => {
        if (open) {
            void refreshBackups();
        } else {
            refreshRequestRef.current += 1;
        }
    }, [open]);

    async function handleCreateBackup() {
        const result = await prompt({
            title: t('prompt.backup_name.header'),
            description: t('prompt.backup_name.description'),
            inputValue: 'Backup',
            pattern: /\S+/,
            errorMessage: t('prompt.backup_name.input_error')
        });
        if (!result.ok) {
            return;
        }
        const backupName = String(result.value || '').trim();
        if (!backupName) {
            return;
        }
        setLoading(true);
        setDetail(t('dialog.registry_backup.backup'));
        try {
            const nextBackups = await backupVrcRegistry(backupName);
            setBackups(nextBackups);
            setSelectedKey(nextBackups[nextBackups.length - 1]?.key || '');
            setDetail(t('common.actions.save'));
        } catch (error) {
            setDetail(registryRestoreError(error, t));
        } finally {
            setLoading(false);
        }
    }

    async function handleRestoreBackup() {
        if (!selectedBackup) {
            return;
        }

        setLoading(true);
        setDetail(
            `${t('dialog.registry_backup.restore')}: ${selectedBackup.name}`
        );
        try {
            await restoreVrcRegistryBackup(selectedBackup.key);
            setDetail(t('message.registry.restored'));
        } catch (error) {
            setDetail(registryRestoreError(error, t));
        } finally {
            setLoading(false);
        }
    }

    async function handleDeleteBackup() {
        if (!selectedBackup) {
            return;
        }

        setLoading(true);
        setDetail(
            `${t('dialog.registry_backup.delete')}: ${selectedBackup.name}`
        );
        try {
            const nextBackups = await deleteVrcRegistryBackup(
                selectedBackup.key
            );
            setBackups(nextBackups);
            setSelectedKey(nextBackups[0]?.key || '');
            setDetail(t('dialog.registry_backup.delete'));
        } catch (error) {
            setDetail(registryRestoreError(error, t));
        } finally {
            setLoading(false);
        }
    }

    async function handleSaveBackupToFile() {
        if (!selectedBackup) {
            return;
        }

        setLoading(true);
        setDetail(
            `${t('dialog.registry_backup.save_to_file')}: ${selectedBackup.name}`
        );
        try {
            const filePath = await saveVrcRegistryBackupToFile(
                selectedBackup.key
            );
            setDetail(
                filePath
                    ? `${t('dialog.registry_backup.save_to_file')}: ${filePath}`
                    : t('common.actions.cancel')
            );
        } catch (error) {
            setDetail(registryRestoreError(error, t));
        } finally {
            setLoading(false);
        }
    }

    async function handleRestoreFromFile() {
        setLoading(true);
        setDetail(t('dialog.registry_backup.restore_from_file'));
        try {
            const restored = await restoreVrcRegistryBackupFromFile();
            setDetail(
                restored
                    ? t('message.registry.restored')
                    : t('common.actions.cancel')
            );
        } catch (error) {
            setDetail(registryRestoreError(error, t));
        } finally {
            setLoading(false);
        }
    }

    async function handleDeleteRegistryFolder() {
        const result = await confirm({
            title: t('confirm.title'),
            description: t('confirm.delete_vrc_registry'),
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        setLoading(true);
        setDetail(t('dialog.registry_backup.reset'));
        try {
            await deleteVrcRegistryFolder();
            setDetail(t('message.registry.deleted'));
        } catch (error) {
            setDetail(registryRestoreError(error, t));
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.registry_backup.header')}
                    </DialogTitle>
                </DialogHeader>
                <FieldGroup>
                    <FieldGroup className="gap-3 rounded-md border p-3">
                        <Field orientation="horizontal" data-disabled={loading}>
                            <FieldContent>
                                <FieldLabel htmlFor="registry-auto-backup">
                                    {t('dialog.registry_backup.auto_backup')}
                                </FieldLabel>
                            </FieldContent>
                            <Switch
                                id="registry-auto-backup"
                                checked={autoBackup}
                                disabled={loading}
                                onCheckedChange={(value) =>
                                    void handleAutoBackupChange(value)
                                }
                            />
                        </Field>
                        <Field orientation="horizontal" data-disabled={loading}>
                            <FieldContent>
                                <FieldLabel htmlFor="registry-ask-restore">
                                    {t('dialog.registry_backup.ask_to_restore')}
                                </FieldLabel>
                            </FieldContent>
                            <Switch
                                id="registry-ask-restore"
                                checked={askRestore}
                                disabled={loading}
                                onCheckedChange={(value) =>
                                    void handleAskRestoreChange(value)
                                }
                            />
                        </Field>
                    </FieldGroup>
                    <Select
                        value={selectedKey}
                        onValueChange={setSelectedKey}
                        disabled={loading || backups.length === 0}
                    >
                        <SelectTrigger>
                            <SelectValue
                                placeholder={
                                    loading
                                        ? t('common.loading')
                                        : t('common.actions.select')
                                }
                            />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {backups.map((backup) => (
                                    <SelectItem
                                        key={backup.key}
                                        value={backup.key}
                                    >
                                        {formatBackupLabel(backup, t)}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    {selectedBackup ? (
                        <div className="bg-muted/30 rounded-md border p-3 text-sm">
                            <div>
                                {t('dialog.registry_backup.name')}{' '}
                                {selectedBackup.name}
                            </div>
                            <div>
                                {t('dialog.registry_backup.date')}{' '}
                                {selectedBackup.date
                                    ? formatDateFilter(
                                          selectedBackup.date,
                                          'long'
                                      )
                                    : t('common.no_data')}
                            </div>
                        </div>
                    ) : null}
                    {detail ? (
                        <div className="text-muted-foreground text-sm">
                            {userFacingErrorMessage(
                                detail,
                                t('message.registry.restore_failed', {
                                    error: ''
                                })
                            )}
                        </div>
                    ) : null}
                </FieldGroup>
                <DialogFooter className="sm:flex-wrap">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loading}
                        onClick={() => void refreshBackups()}
                    >
                        {t('common.actions.refresh')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loading}
                        onClick={() => void handleCreateBackup()}
                    >
                        {t('dialog.registry_backup.backup')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loading || !selectedBackup}
                        onClick={() => void handleDeleteBackup()}
                    >
                        {t('dialog.registry_backup.delete')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loading || !selectedBackup}
                        onClick={() => void handleSaveBackupToFile()}
                    >
                        {t('dialog.registry_backup.save_to_file')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loading}
                        onClick={() => void handleRestoreFromFile()}
                    >
                        {t('dialog.registry_backup.restore_from_file')}
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={loading}
                        onClick={() => void handleDeleteRegistryFolder()}
                    >
                        {t('dialog.registry_backup.reset')}
                    </Button>
                    <Button
                        type="button"
                        disabled={loading || !selectedBackup}
                        onClick={() => void handleRestoreBackup()}
                    >
                        {t('dialog.registry_backup.restore')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
