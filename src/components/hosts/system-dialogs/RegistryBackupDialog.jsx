import { useEffect, useRef, useState } from 'react';

import { useTranslation } from 'react-i18next';
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
    DialogDescription,
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

function formatBackupLabel(backup) {
    const date = backup.date ? new Date(backup.date) : null;
    const dateLabel =
        date && !Number.isNaN(date.getTime())
            ? date.toLocaleString()
            : 'Unknown date';
    return `${backup.name || 'Backup'} - ${dateLabel}`;
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
                setDetail('No VRChat registry backups are saved.');
            }
        } catch (error) {
            if (requestId !== refreshRequestRef.current) {
                return;
            }
            setDetail(
                userFacingErrorMessage(
                    error,
                    'Failed to load VRChat registry backups.'
                )
            );
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
            setDetail(
                userFacingErrorMessage(
                    error,
                    'Failed to update VRChat registry backup settings.'
                )
            );
        }
    }

    async function handleAskRestoreChange(value) {
        const nextValue = Boolean(value);
        setAskRestore(nextValue);
        try {
            await configRepository.setBool('vrcRegistryAskRestore', nextValue);
        } catch (error) {
            setAskRestore(!nextValue);
            setDetail(
                userFacingErrorMessage(
                    error,
                    'Failed to update VRChat registry backup settings.'
                )
            );
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
        setDetail('Creating VRChat registry backup.');
        try {
            const nextBackups = await backupVrcRegistry(backupName);
            setBackups(nextBackups);
            setSelectedKey(nextBackups[nextBackups.length - 1]?.key || '');
            setDetail('Registry backup saved.');
        } catch (error) {
            setDetail(
                userFacingErrorMessage(
                    error,
                    'Failed to create VRChat registry backup.'
                )
            );
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
            t('host.system_dialogs.generated_dynamic.restoring_value', {
                value: selectedBackup.name
            })
        );
        try {
            await restoreVrcRegistryBackup(selectedBackup.key);
            setDetail('Registry backup restored.');
        } catch (error) {
            setDetail(
                userFacingErrorMessage(
                    error,
                    'Failed to restore VRChat registry backup.'
                )
            );
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
            t('host.system_dialogs.generated_dynamic.deleting_value', {
                value: selectedBackup.name
            })
        );
        try {
            const nextBackups = await deleteVrcRegistryBackup(
                selectedBackup.key
            );
            setBackups(nextBackups);
            setSelectedKey(nextBackups[0]?.key || '');
            setDetail('Registry backup deleted.');
        } catch (error) {
            setDetail(
                userFacingErrorMessage(
                    error,
                    'Failed to delete VRChat registry backup.'
                )
            );
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
            t('host.system_dialogs.generated_dynamic.saving_value', {
                value: selectedBackup.name
            })
        );
        try {
            const filePath = await saveVrcRegistryBackupToFile(
                selectedBackup.key
            );
            setDetail(
                filePath
                    ? `Registry backup saved to ${filePath}.`
                    : 'Save cancelled.'
            );
        } catch (error) {
            setDetail(
                userFacingErrorMessage(
                    error,
                    'Failed to save VRChat registry backup.'
                )
            );
        } finally {
            setLoading(false);
        }
    }

    async function handleRestoreFromFile() {
        setLoading(true);
        setDetail('Restoring registry backup from file.');
        try {
            const restored = await restoreVrcRegistryBackupFromFile();
            setDetail(
                restored
                    ? 'Registry backup restored from file.'
                    : 'Restore cancelled.'
            );
        } catch (error) {
            setDetail(
                userFacingErrorMessage(
                    error,
                    'Failed to restore VRChat registry backup.'
                )
            );
        } finally {
            setLoading(false);
        }
    }

    async function handleDeleteRegistryFolder() {
        const result = await confirm({
            title: t(
                'host.system_dialogs.generated_modal.delete_vrchat_registry'
            ),
            description: t(
                'host.system_dialogs.generated_modal.delete_the_vrchat_registry_folder_this_matches_t'
            ),
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        setLoading(true);
        setDetail('Deleting VRChat registry folder.');
        try {
            await deleteVrcRegistryFolder();
            setDetail('VRChat registry folder deleted.');
        } catch (error) {
            setDetail(
                userFacingErrorMessage(
                    error,
                    'Failed to delete VRChat registry folder.'
                )
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {t(
                            'dialog.system.generated.vrchat_registry_backup'
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'dialog.system.generated.create_restore_or_remove_saved_vrchat_registry_backups'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <FieldGroup className="gap-3 rounded-md border p-3">
                        <Field orientation="horizontal" data-disabled={loading}>
                            <FieldContent>
                                <FieldLabel htmlFor="registry-auto-backup">
                                    {t(
                                        'dialog.system.generated.auto_backup'
                                    )}
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
                                    {t(
                                        'dialog.system.generated.ask_to_restore'
                                    )}
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
                                        ? 'Loading backups'
                                        : 'Select backup'
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
                                        {formatBackupLabel(backup)}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    {selectedBackup ? (
                        <div className="bg-muted/30 rounded-md border p-3 text-sm">
                            <div>
                                {t('dialog.system.generated.name')}{' '}
                                {selectedBackup.name}
                            </div>
                            <div>
                                {t('dialog.system.generated.date')}{' '}
                                {selectedBackup.date || 'Unknown'}
                            </div>
                        </div>
                    ) : null}
                    {detail ? (
                        <div className="text-muted-foreground text-sm">
                            {userFacingErrorMessage(
                                detail,
                                'Failed to update VRChat registry backups.'
                            )}
                        </div>
                    ) : null}
                </FieldGroup>
                <DialogFooter>
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
                        {t('dialog.system.generated.create_backup')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loading || !selectedBackup}
                        onClick={() => void handleDeleteBackup()}
                    >
                        {t('common.actions.delete')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loading || !selectedBackup}
                        onClick={() => void handleSaveBackupToFile()}
                    >
                        {t('dialog.system.generated.save_to_file')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loading}
                        onClick={() => void handleRestoreFromFile()}
                    >
                        {t('dialog.system.generated.restore_from_file')}
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={loading}
                        onClick={() => void handleDeleteRegistryFolder()}
                    >
                        {t('common.actions.reset')}
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
