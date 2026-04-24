import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { avatarSearchProviderRepository } from '@/repositories/index.js';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';

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
    const { t } = useTranslation();
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
            const savedConfig = await avatarSearchProviderRepository.saveConfig(
                {
                    enabled: nextProviderList.filter(Boolean).length > 0,
                    providerList: nextProviderList
                }
            );
            setDraftProviderList(savedConfig.providerList);
            lastSavedProviderListKeyRef.current = providerListKey(
                savedConfig.providerList
            );
            onConfigSaved?.(savedConfig);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.avatar_provider_settings.generated_toast.failed_to_save_avatar_providers')
            );
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
        const nextProviderList = draftProviderList.filter(
            (_, providerIndex) => providerIndex !== index
        );
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
                    <DialogTitle>
                        {t('dialog.avatar_database_provider.header')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialog.avatar_database_provider.description')}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup className="gap-2">
                    {draftProviderList.map((provider, index) => (
                        <Field
                            key={`avatar-provider-${index}`}
                            data-disabled={isSaving}
                        >
                            <FieldLabel
                                htmlFor={`avatar-provider-${index}`}
                                className="sr-only"
                            >
                                {t('view.search.generated.avatar_provider')} {index + 1}
                            </FieldLabel>
                            <InputGroup>
                                <InputGroupInput
                                    id={`avatar-provider-${index}`}
                                    value={provider}
                                    disabled={isSaving}
                                    onChange={(event) =>
                                        updateProvider(
                                            index,
                                            event.target.value
                                        )
                                    }
                                    onBlur={() => void saveProviderList()}
                                />
                                <InputGroupAddon align="inline-end">
                                    <InputGroupButton
                                        type="button"
                                        size="icon-xs"
                                        aria-label={`Remove avatar provider ${index + 1}`}
                                        disabled={isSaving}
                                        onClick={() => removeProvider(index)}
                                    >
                                        <Trash2Icon data-icon="inline-start" />
                                    </InputGroupButton>
                                </InputGroupAddon>
                            </InputGroup>
                        </Field>
                    ))}
                    <Button
                        type="button"
                        size="sm"
                        disabled={isSaving}
                        onClick={addProvider}
                    >
                        <PlusIcon data-icon="inline-start" />
                        {t('dialog.avatar_database_provider.add_provider')}
                    </Button>
                </FieldGroup>
            </DialogContent>
        </Dialog>
    );
}
