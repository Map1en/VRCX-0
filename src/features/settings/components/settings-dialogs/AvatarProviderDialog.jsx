import { PlusIcon, Trash2Icon } from 'lucide-react';

import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Empty, EmptyHeader, EmptyTitle } from '@/ui/shadcn/empty';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';

import { Field, FieldGroup } from '../SettingsField.jsx';

export function AvatarProviderDialog({
    t,
    open: avatarProviderDialogOpen,
    onOpenChange: setAvatarProviderDialogOpen,
    config: avatarProviderConfig,
    onUpdate: updateAvatarProvider,
    onSaveField: saveAvatarProviderField,
    onRemove: removeAvatarProvider,
    onAdd: addAvatarProvider
}) {
    return (
        <Dialog
            open={avatarProviderDialogOpen}
            onOpenChange={setAvatarProviderDialogOpen}
        >
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.avatar_database_provider.header')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialog.avatar_database_provider.description')}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    {avatarProviderConfig.providerList.length > 0 ? (
                        avatarProviderConfig.providerList.map(
                            (provider, index) => (
                                <Field
                                    key={`avatar-provider-dialog-${index}`}
                                    label={t('view.settings.generated_dynamic.value_value', { value: t('view.settings.advanced.advanced.remote_database.avatar_database_provider'), value2: index + 1 })}
                                    controlId={`settings-avatar-provider-${index}`}
                                >
                                    <InputGroup>
                                        <InputGroupInput
                                            id={`settings-avatar-provider-${index}`}
                                            name={`avatarProvider${index}`}
                                            value={provider}
                                            onChange={(event) =>
                                                updateAvatarProvider(
                                                    index,
                                                    event.target.value
                                                )
                                            }
                                            onBlur={(event) =>
                                                saveAvatarProviderField(
                                                    index,
                                                    event.target.value
                                                )
                                            }
                                        />
                                        <InputGroupAddon align="inline-end">
                                            <InputGroupButton
                                                type="button"
                                                size="icon-xs"
                                                aria-label={"Remove"}
                                                onClick={() =>
                                                    removeAvatarProvider(
                                                        index
                                                    )
                                                }
                                            >
                                                <Trash2Icon data-icon="inline-start" />
                                            </InputGroupButton>
                                        </InputGroupAddon>
                                    </InputGroup>
                                </Field>
                            )
                        )
                    ) : (
                        <Empty className="min-h-28">
                            <EmptyHeader>
                                <EmptyTitle>
                                    {t('search.avatar.no_provider')}
                                </EmptyTitle>
                            </EmptyHeader>
                        </Empty>
                    )}
                    <Field
                        label={t(
                            'dialog.avatar_database_provider.add_provider'
                        )}
                    >
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={addAvatarProvider}
                        >
                            <PlusIcon data-icon="inline-start" />
                            {t(
                                'dialog.avatar_database_provider.add_provider'
                            )}
                        </Button>
                    </Field>
                </FieldGroup>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => setAvatarProviderDialogOpen(false)}
                    >
                        {t('dialog.alertdialog.ok')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
