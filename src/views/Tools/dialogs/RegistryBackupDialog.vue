<template>
    <Dialog :open="isRegistryBackupDialogVisible" @update:open="(open) => !open && closeAndClearDialog()">
        <DialogContent>
            <DialogHeader>
                <DialogTitle>{{ t('dialog.registry_backup.header') }}</DialogTitle>
            </DialogHeader>
            <div class="mt-2">
                <div class="flex items-center justify-between text-xs">
                    <span class="name mr-6">{{ t('dialog.registry_backup.auto_backup') }}</span>
                    <Switch :model-value="vrcRegistryAutoBackup" @update:modelValue="setVrcRegistryAutoBackup" />
                </div>
                <div class="mt-1.5 flex items-center justify-between text-xs">
                    <span class="name mr-6">{{ t('dialog.registry_backup.ask_to_restore') }}</span>
                    <Switch :model-value="vrcRegistryAskRestore" @update:modelValue="setVrcRegistryAskRestore" />
                </div>
                <DataTableLayout
                    class="min-w-0 w-full mt-2"
                    :table="table"
                    :loading="false"
                    :table-style="tableStyle"
                    :show-pagination="false" />
                <div class="mt-2" style="display: flex; align-items: center; justify-content: space-between">
                    <Button size="sm" variant="destructive" @click="deleteVrcRegistry">{{
                        t('dialog.registry_backup.reset')
                    }}</Button>
                    <div class="flex gap-2">
                        <Button size="sm" variant="outline" @click="promptVrcRegistryBackupName">{{
                            t('dialog.registry_backup.backup')
                        }}</Button>
                        <Button size="sm" variant="outline" @click="restoreVrcRegistryFromFile">{{
                            t('dialog.registry_backup.restore_from_file')
                        }}</Button>
                    </div>
                </div>
            </div>
        </DialogContent>
    </Dialog>
</template>

<script setup>
    import { invoke } from '@tauri-apps/api/core';
    import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
    import { computed, ref, watch } from 'vue';
    import { Button } from '@/components/ui/button';
    import { DataTableLayout } from '@/components/ui/data-table';
    import { storeToRefs } from 'pinia';
    import { toast } from 'vue-sonner';
    import { useI18n } from 'vue-i18n';

    import { useAdvancedSettingsStore, useModalStore, useVrcxStore } from '../../../stores';
    import { downloadAndSaveJson, removeFromArray } from '../../../shared/utils';
    import { Switch } from '../../../components/ui/switch';
    import { createColumns } from '../../Settings/dialogs/registryBackupColumns.jsx';
    import { useVrcxVueTable } from '../../../lib/table/useVrcxVueTable';

    import configRepository from '../../../services/config';

    const { backupVrcRegistry } = useVrcxStore();
    const { isRegistryBackupDialogVisible } = storeToRefs(useVrcxStore());
    const { vrcRegistryAutoBackup, vrcRegistryAskRestore } = storeToRefs(useAdvancedSettingsStore());
    const { setVrcRegistryAutoBackup, setVrcRegistryAskRestore } = useAdvancedSettingsStore();
    const modalStore = useModalStore();

    const { t } = useI18n();

    const registryBackupTable = ref({
        data: [],
        layout: 'table'
    });

    const tableStyle = { maxHeight: '320px' };

    const rows = computed(() =>
        Array.isArray(registryBackupTable.value?.data) ? registryBackupTable.value.data.slice() : []
    );

    const columns = computed(() =>
        createColumns({
            onRestore: restoreVrcRegistryBackup,
            onSaveToFile: saveVrcRegistryBackupToFile,
            onDelete: deleteVrcRegistryBackup
        })
    );

    const { table } = useVrcxVueTable({
        persistKey: 'registryBackupDialog',
        get data() {
            return rows.value;
        },
        columns: columns.value,
        getRowId: (row) => String(row?.name ?? ''),
        enablePagination: false,
        initialSorting: [{ id: 'date', desc: true }]
    });

    watch(
        () => isRegistryBackupDialogVisible.value,
        (newVal) => {
            if (newVal) {
                updateRegistryBackupDialog();
            }
        }
    );

    /**
     *
     */
    async function updateRegistryBackupDialog() {
        const backupsJson = await configRepository.getString('VRChatRegistryBackups');
        registryBackupTable.value.data = JSON.parse(backupsJson || '[]');
    }

    /**
     *
     * @param row
     */
    function restoreVrcRegistryBackup(row) {
        modalStore
            .confirm({
                description: t('confirm.restore_backup'),
                title: t('confirm.title')
            })
            .then(({ ok }) => {
                if (!ok) {
                    return;
                }
                const data = JSON.stringify(row.data);
                invoke('app__set_vrchat_registry', { json: data })
                    .then(() => {
                        toast.success(t('message.registry.restored'));
                    })
                    .catch((e) => {
                        console.error(e);
                        toast.error(t('message.registry.restore_failed', { error: e }));
                    });
            })
            .catch(() => {});
    }

    /**
     *
     * @param row
     */
    function saveVrcRegistryBackupToFile(row) {
        downloadAndSaveJson(row.name, row.data);
    }

    /**
     *
     * @param row
     */
    async function deleteVrcRegistryBackup(row) {
        const backups = registryBackupTable.value.data;
        removeFromArray(backups, row);
        await configRepository.setString('VRChatRegistryBackups', JSON.stringify(backups));
        await updateRegistryBackupDialog();
    }

    /**
     *
     */
    function deleteVrcRegistry() {
        modalStore
            .confirm({
                description: t('confirm.delete_vrc_registry'),
                title: t('confirm.title')
            })
            .then(({ ok }) => {
                if (!ok) {
                    return;
                }
                invoke('app__delete_vrchat_registry_folder').then(() => {
                    toast.success(t('message.registry.deleted'));
                });
            })
            .catch(() => {});
    }

    /**
     *
     * @param name
     */
    async function handleBackupVrcRegistry(name) {
        await backupVrcRegistry(name);
        await updateRegistryBackupDialog();
    }

    /**
     *
     */
    function promptVrcRegistryBackupName() {
        modalStore
            .prompt({
                title: t('prompt.backup_name.header'),
                description: t('prompt.backup_name.description'),
                inputValue: 'Backup',
                pattern: /\S+/,
                errorMessage: t('prompt.backup_name.input_error')
            })
            .then(({ ok, value }) => {
                if (!ok) return;
                handleBackupVrcRegistry(value);
            })
            .catch(() => {});
    }

    /**
     *
     */
    async function restoreVrcRegistryFromFile() {
        const filePath = await invoke('app__open_file_selector_dialog', {
            defaultPath: null,
            defaultExt: '.json',
            defaultFilter: 'JSON Files (*.json)|*.json'
        });
        if (filePath === '') {
            return;
        }

        const json = await invoke('app__read_vrc_reg_json_file', { filepath: filePath });

        try {
            const data = JSON.parse(json);
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid JSON');
            }
            // quick check to make sure it's a valid registry backup
            for (const key in data) {
                const value = data[key];
                if (typeof value !== 'object' || typeof value.type !== 'number' || typeof value.data === 'undefined') {
                    throw new Error('Invalid JSON');
                }
            }
            invoke('app__set_vrchat_registry', { json })
                .then(() => {
                    toast.success(t('message.registry.restored'));
                })
                .catch((e) => {
                    console.error(e);
                    toast.error(t('message.registry.restore_failed', { error: e }));
                });
        } catch {
            toast.error(t('message.registry.invalid_json'));
        }
    }

    /**
     *
     */
    function clearVrcRegistryDialog() {
        registryBackupTable.value.data = [];
    }

    /**
     *
     */
    function closeAndClearDialog() {
        closeDialog();
        // TODO: Element Plus had a distinct @closed event after animation.
        // If you ever need exact timing, wrap DialogContent with a Transition and call clear on after-leave.
        clearVrcRegistryDialog();
    }

    /**
     *
     */
    function closeDialog() {
        isRegistryBackupDialogVisible.value = false;
    }
</script>
