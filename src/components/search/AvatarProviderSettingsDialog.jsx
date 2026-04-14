import { useEffect, useRef, useState } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { avatarSearchProviderRepository } from '@/repositories/index.js';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import { Input } from '@/ui/shadcn/input.jsx';

function providerListKey(providerList) {
    return JSON.stringify(
        (Array.isArray(providerList) ? providerList : [])
            .map((provider) => String(provider ?? '').trim())
            .filter(Boolean)
    );
}

export function AvatarProviderSettingsDialog({
    open,
    onOpenChange,
    providerList = [],
    onConfigSaved
}) {
    const { t } = useI18n();
    const [draftProviderList, setDraftProviderList] = useState(providerList);
    const [isSaving, setIsSaving] = useState(false);
    const lastSavedProviderListKeyRef = useRef(providerListKey(providerList));
    const inFlightProviderListKeyRef = useRef('');

    useEffect(() => {
        if (open) {
            setDraftProviderList(providerList);
            lastSavedProviderListKeyRef.current = providerListKey(providerList);
        }
    }, [open, providerList]);

    async function saveProviderList(nextProviderList = draftProviderList) {
        const nextProviderListKey = providerListKey(nextProviderList);
        if (
            nextProviderListKey === lastSavedProviderListKeyRef.current ||
            nextProviderListKey === inFlightProviderListKeyRef.current
        ) {
            return;
        }
        inFlightProviderListKeyRef.current = nextProviderListKey;
        setIsSaving(true);
        try {
            const savedConfig = await avatarSearchProviderRepository.saveConfig({
                enabled: nextProviderList.filter(Boolean).length > 0,
                providerList: nextProviderList
            });
            setDraftProviderList(savedConfig.providerList);
            lastSavedProviderListKeyRef.current = providerListKey(savedConfig.providerList);
            onConfigSaved?.(savedConfig);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to save avatar providers.');
        } finally {
            if (inFlightProviderListKeyRef.current === nextProviderListKey) {
                inFlightProviderListKeyRef.current = '';
            }
            setIsSaving(false);
        }
    }

    function updateProvider(index, value) {
        setDraftProviderList((current) =>
            current.map((provider, providerIndex) =>
                providerIndex === index ? value : provider
            )
        );
    }

    function addProvider() {
        setDraftProviderList((current) => [...current, '']);
    }

    function removeProvider(index) {
        const nextProviderList = draftProviderList.filter((_, providerIndex) => providerIndex !== index);
        setDraftProviderList(nextProviderList);
        void saveProviderList(nextProviderList);
    }

    function handleOpenChange(nextOpen) {
        if (!nextOpen) {
            void saveProviderList();
        }
        onOpenChange?.(nextOpen);
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('dialog.avatar_database_provider.header')}</DialogTitle>
                </DialogHeader>
                <div className="space-y-2">
                    {draftProviderList.map((provider, index) => (
                        <div key={`avatar-provider-${index}`} className="flex items-center gap-2">
                            <Input
                                value={provider}
                                disabled={isSaving}
                                onChange={(event) => updateProvider(index, event.target.value)}
                                onBlur={() => void saveProviderList()}
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled={isSaving}
                                onClick={() => removeProvider(index)}>
                                <Trash2Icon className="size-4" />
                            </Button>
                        </div>
                    ))}
                    <Button type="button" size="sm" disabled={isSaving} onClick={addProvider}>
                        <PlusIcon className="size-4" />
                        {t('dialog.avatar_database_provider.add_provider')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
