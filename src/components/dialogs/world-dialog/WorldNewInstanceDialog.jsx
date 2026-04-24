import { useEffect, useState } from 'react';

import { useTranslation } from 'react-i18next';
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
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { buildLegacyCreatedInstance } from './worldInstances.js';

const accessTypeOptions = [
    { value: 'public', label: 'Public' },
    { value: 'friends+', label: 'Friends+' },
    { value: 'friends', label: 'Friends' },
    { value: 'invite+', label: 'Invite+' },
    { value: 'invite', label: 'Invite' },
    { value: 'group', label: 'Group' }
];

const regionOptions = ['US West', 'US East', 'Europe', 'Japan'];
const groupAccessTypeOptions = [
    { value: 'public', label: 'Group Public' },
    { value: 'plus', label: 'Group+' },
    { value: 'members', label: 'Group Members' }
];

export function WorldNewInstanceDialog({
    open,
    request,
    world,
    currentUserId = '',
    submitting,
    onOpenChange,
    onSubmit,
    onCopy,
    onSelfInvite,
    onInvite,
    onLaunch,
    onOpenInGame
}) {
    const { t } = useTranslation();

    const [form, setForm] = useState({
        selectedTab: 'Normal',
        accessType: 'public',
        region: 'US West',
        groupId: '',
        groupAccessType: 'plus',
        queueEnabled: true,
        ageGate: false,
        displayName: '',
        roleIds: '',
        instanceName: '',
        legacyUserId: '',
        strict: false
    });
    const [legacySeed, setLegacySeed] = useState('00001');

    useEffect(() => {
        if (open && request?.defaults) {
            setLegacySeed(
                String((99999 * Math.random() + 1).toFixed(0)).padStart(5, '0')
            );
            setForm({
                selectedTab: 'Normal',
                instanceName: '',
                legacyUserId: currentUserId || '',
                strict: false,
                ...request.defaults
            });
        }
    }, [currentUserId, open, request]);

    function patchForm(patch) {
        setForm((current) => ({ ...current, ...patch }));
    }

    const legacyCreated =
        form.selectedTab === 'Legacy' && world?.id
            ? buildLegacyCreatedInstance({
                  worldId: world.id,
                  form,
                  currentUserId,
                  legacySeed
              })
            : null;
    const activeCreated = request?.created || legacyCreated;
    const activeAccessType = activeCreated?.accessType || form.accessType;
    const activeOwnerId = activeCreated?.ownerId || currentUserId;
    const inviteDisabled = Boolean(
        (activeAccessType === 'friends' || activeAccessType === 'invite') &&
        activeOwnerId &&
        currentUserId &&
        activeOwnerId !== currentUserId
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[min(92vw,34rem)]">
                <DialogHeader>
                    <DialogTitle>
                        {request?.selfInvite
                            ? 'New instance and self invite'
                            : 'New instance'}
                    </DialogTitle>
                    <DialogDescription>
                        {world?.name || world?.id || 'World'}
                    </DialogDescription>
                </DialogHeader>
                <Tabs
                    value={form.selectedTab}
                    onValueChange={(value) => patchForm({ selectedTab: value })}
                >
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="Normal">{t('dialog.new_instance.normal')}</TabsTrigger>
                        <TabsTrigger value="Legacy">{t('dialog.new_instance.legacy')}</TabsTrigger>
                    </TabsList>
                    <TabsContent value="Normal">
                        <FieldGroup className="gap-4">
                            <Field>
                                <FieldLabel>{t('dialog.world.generated.access')}</FieldLabel>
                                <Select
                                    value={form.accessType}
                                    disabled={Boolean(request?.created)}
                                    onValueChange={(value) =>
                                        patchForm({ accessType: value })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {accessTypeOptions.map((option) => (
                                                <SelectItem
                                                    key={option.value}
                                                    value={option.value}
                                                >
                                                    {option.label}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field>
                                <FieldLabel>{t('dialog.new_instance.region')}</FieldLabel>
                                <Select
                                    value={form.region}
                                    disabled={Boolean(request?.created)}
                                    onValueChange={(value) =>
                                        patchForm({ region: value })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {regionOptions.map((region) => (
                                                <SelectItem
                                                    key={region}
                                                    value={region}
                                                >
                                                    {region}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                            {form.accessType === 'group' ? (
                                <>
                                    <Field>
                                        <FieldLabel htmlFor="world-instance-group-id">
                                            {t('dialog.group.info.id')}
                                        </FieldLabel>
                                        <Input
                                            id="world-instance-group-id"
                                            value={form.groupId}
                                            disabled={Boolean(request?.created)}
                                            onChange={(event) =>
                                                patchForm({
                                                    groupId: event.target.value
                                                })
                                            }
                                        />
                                    </Field>
                                    <Field>
                                        <FieldLabel>{t('dialog.new_instance.group_access_type')}</FieldLabel>
                                        <Select
                                            value={form.groupAccessType}
                                            disabled={Boolean(request?.created)}
                                            onValueChange={(value) =>
                                                patchForm({
                                                    groupAccessType: value
                                                })
                                            }
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    {groupAccessTypeOptions.map(
                                                        (option) => (
                                                            <SelectItem
                                                                key={
                                                                    option.value
                                                                }
                                                                value={
                                                                    option.value
                                                                }
                                                            >
                                                                {option.label}
                                                            </SelectItem>
                                                        )
                                                    )}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                    {form.groupAccessType === 'members' ? (
                                        <Field>
                                            <FieldLabel htmlFor="world-instance-role-ids">
                                                {t('dialog.world.generated.role_ids')}
                                            </FieldLabel>
                                            <Input
                                                id="world-instance-role-ids"
                                                value={form.roleIds}
                                                disabled={Boolean(
                                                    request?.created
                                                )}
                                                onChange={(event) =>
                                                    patchForm({
                                                        roleIds:
                                                            event.target.value
                                                    })
                                                }
                                            />
                                        </Field>
                                    ) : null}
                                    <FieldGroup data-slot="checkbox-group">
                                        <Field
                                            orientation="horizontal"
                                            data-disabled={Boolean(
                                                request?.created
                                            )}
                                        >
                                            <Checkbox
                                                id="world-instance-queue-enabled"
                                                checked={form.queueEnabled}
                                                disabled={Boolean(
                                                    request?.created
                                                )}
                                                onCheckedChange={(value) =>
                                                    patchForm({
                                                        queueEnabled:
                                                            Boolean(value)
                                                    })
                                                }
                                            />
                                            <FieldLabel htmlFor="world-instance-queue-enabled">
                                                {t('dialog.world.generated.queue_enabled')}
                                            </FieldLabel>
                                        </Field>
                                        <Field
                                            orientation="horizontal"
                                            data-disabled={Boolean(
                                                request?.created
                                            )}
                                        >
                                            <Checkbox
                                                id="world-instance-age-gate"
                                                checked={form.ageGate}
                                                disabled={Boolean(
                                                    request?.created
                                                )}
                                                onCheckedChange={(value) =>
                                                    patchForm({
                                                        ageGate: Boolean(value)
                                                    })
                                                }
                                            />
                                            <FieldLabel htmlFor="world-instance-age-gate">
                                                {t('dialog.world.generated.age_gate')}
                                            </FieldLabel>
                                        </Field>
                                    </FieldGroup>
                                </>
                            ) : null}
                            <Field>
                                <FieldLabel htmlFor="world-instance-display-name">
                                    {t('dialog.world.generated.display_name')}
                                </FieldLabel>
                                <Input
                                    id="world-instance-display-name"
                                    value={form.displayName}
                                    disabled={Boolean(request?.created)}
                                    onChange={(event) =>
                                        patchForm({
                                            displayName: event.target.value
                                        })
                                    }
                                />
                            </Field>
                        </FieldGroup>
                    </TabsContent>
                    <TabsContent value="Legacy">
                        <FieldGroup className="gap-4">
                            <Field>
                                <FieldLabel>{t('dialog.world.generated.access')}</FieldLabel>
                                <Select
                                    value={form.accessType}
                                    onValueChange={(value) =>
                                        patchForm({ accessType: value })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {accessTypeOptions.map((option) => (
                                                <SelectItem
                                                    key={option.value}
                                                    value={option.value}
                                                >
                                                    {option.label}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field>
                                <FieldLabel>{t('dialog.new_instance.region')}</FieldLabel>
                                <Select
                                    value={form.region}
                                    onValueChange={(value) =>
                                        patchForm({ region: value })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {regionOptions.map((region) => (
                                                <SelectItem
                                                    key={region}
                                                    value={region}
                                                >
                                                    {region}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="world-launch-instance-name">
                                    {t('table.previous_instances.instance_name')}
                                </FieldLabel>
                                <Input
                                    id="world-launch-instance-name"
                                    value={form.instanceName}
                                    onChange={(event) =>
                                        patchForm({
                                            instanceName:
                                                event.target.value.replace(
                                                    /[^A-Za-z0-9]/g,
                                                    ''
                                                )
                                        })
                                    }
                                />
                            </Field>
                            {form.accessType !== 'public' &&
                            form.accessType !== 'group' ? (
                                <Field>
                                    <FieldLabel htmlFor="world-launch-user-id">
                                        {t('dialog.world.generated.user_id')}
                                    </FieldLabel>
                                    <Input
                                        id="world-launch-user-id"
                                        value={form.legacyUserId}
                                        onChange={(event) =>
                                            patchForm({
                                                legacyUserId: event.target.value
                                            })
                                        }
                                    />
                                </Field>
                            ) : null}
                            {form.accessType === 'group' ? (
                                <>
                                    <Field>
                                        <FieldLabel htmlFor="world-launch-group-id">
                                            {t('dialog.group.info.id')}
                                        </FieldLabel>
                                        <Input
                                            id="world-launch-group-id"
                                            value={form.groupId}
                                            onChange={(event) =>
                                                patchForm({
                                                    groupId: event.target.value
                                                })
                                            }
                                        />
                                    </Field>
                                    <Field>
                                        <FieldLabel>{t('dialog.new_instance.group_access_type')}</FieldLabel>
                                        <Select
                                            value={form.groupAccessType}
                                            onValueChange={(value) =>
                                                patchForm({
                                                    groupAccessType: value
                                                })
                                            }
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    {groupAccessTypeOptions.map(
                                                        (option) => (
                                                            <SelectItem
                                                                key={
                                                                    option.value
                                                                }
                                                                value={
                                                                    option.value
                                                                }
                                                            >
                                                                {option.label}
                                                            </SelectItem>
                                                        )
                                                    )}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                </>
                            ) : null}
                            {form.accessType === 'group' ? (
                                <Field orientation="horizontal">
                                    <Checkbox
                                        id="world-launch-age-gate"
                                        checked={form.ageGate}
                                        onCheckedChange={(value) =>
                                            patchForm({
                                                ageGate: Boolean(value)
                                            })
                                        }
                                    />
                                    <FieldLabel htmlFor="world-launch-age-gate">
                                        {t('dialog.world.generated.age_gate')}
                                    </FieldLabel>
                                </Field>
                            ) : null}
                            {form.accessType === 'invite' ||
                            form.accessType === 'friends' ? (
                                <Field orientation="horizontal">
                                    <Checkbox
                                        id="world-launch-strict"
                                        checked={form.strict}
                                        onCheckedChange={(value) =>
                                            patchForm({
                                                strict: Boolean(value)
                                            })
                                        }
                                    />
                                    <FieldLabel htmlFor="world-launch-strict">
                                        {t('dialog.world.generated.strict')}
                                    </FieldLabel>
                                </Field>
                            ) : null}
                        </FieldGroup>
                    </TabsContent>
                </Tabs>
                {activeCreated ? (
                    <FieldGroup className="gap-4">
                        <Field>
                            <FieldLabel htmlFor="world-created-location">
                                {t('dialog.world.generated.location')}
                            </FieldLabel>
                            <Input
                                id="world-created-location"
                                readOnly
                                value={activeCreated.location || ''}
                                onClick={(event) =>
                                    event.currentTarget.select()
                                }
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="world-created-url">
                                URL
                            </FieldLabel>
                            <Input
                                id="world-created-url"
                                readOnly
                                value={activeCreated.url || ''}
                                onClick={(event) =>
                                    event.currentTarget.select()
                                }
                            />
                        </Field>
                    </FieldGroup>
                ) : null}
                {activeCreated ? (
                    <DialogFooter className="gap-2 sm:justify-end">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={submitting}
                            onClick={() => onCopy?.(activeCreated)}
                        >
                            {t('dialog.world.generated.copy_url')}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={submitting}
                            onClick={() => onSelfInvite?.(activeCreated)}
                        >
                            {t('dialog.world.generated.self_invite')}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={submitting || inviteDisabled}
                            onClick={() => onInvite?.(activeCreated)}
                        >
                            {t('dialog.world.generated.invite')}
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={submitting}
                            onClick={() => onLaunch?.(activeCreated)}
                        >
                            {t('dialog.world.generated.launch')}
                        </Button>
                        <Button
                            type="button"
                            disabled={submitting}
                            onClick={() => onOpenInGame?.(activeCreated)}
                        >
                            {t('dialog.world.generated.open_in_game')}
                        </Button>
                    </DialogFooter>
                ) : (
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={submitting}
                            onClick={() => onOpenChange(false)}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                        <Button
                            type="button"
                            disabled={
                                submitting || form.selectedTab === 'Legacy'
                            }
                            onClick={() => onSubmit(form)}
                        >
                            {request?.selfInvite
                                ? 'Create and Invite'
                                : 'Create'}
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}
