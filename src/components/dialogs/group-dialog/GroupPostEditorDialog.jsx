import { ImageIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils.js';
import { mediaRepository } from '@/repositories/index.js';
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
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import {
    ToggleGroup,
    ToggleGroupItem
} from '@/ui/shadcn/toggle-group';
import { Textarea } from '@/ui/shadcn/textarea';

import { GroupListState } from './GroupListState.jsx';
import { getGroupRowImage, getGroupRowLabel } from './groupDialogUtils.js';

export function GroupPostEditorDialog({
    open,
    onOpenChange,
    form,
    onFormChange,
    group,
    endpoint = '',
    submitting = false,
    onSubmit
}) {
    const { t } = useTranslation();

    const [galleryRows, setGalleryRows] = useState([]);
    const [galleryStatus, setGalleryStatus] = useState('idle');
    const [galleryError, setGalleryError] = useState('');
    const galleryRequestIdRef = useRef(0);

    async function loadGalleryRows() {
        if (!open) {
            return;
        }
        const requestId = galleryRequestIdRef.current + 1;
        galleryRequestIdRef.current = requestId;
        setGalleryStatus('running');
        setGalleryError('');
        try {
            const response = await mediaRepository.getFileList(
                { n: 100, tag: 'gallery' },
                { endpoint }
            );
            if (galleryRequestIdRef.current !== requestId) {
                return;
            }
            setGalleryRows(
                Array.isArray(response.json) ? [...response.json].reverse() : []
            );
            setGalleryStatus('ready');
        } catch (error) {
            if (galleryRequestIdRef.current !== requestId) {
                return;
            }
            setGalleryRows([]);
            setGalleryStatus('error');
            setGalleryError(
                error instanceof Error
                    ? error.message
                    : 'Failed to load gallery images.'
            );
        }
    }

    useEffect(() => {
        if (open) {
            void loadGalleryRows();
        } else {
            galleryRequestIdRef.current += 1;
            setGalleryRows([]);
            setGalleryStatus('idle');
            setGalleryError('');
        }
    }, [endpoint, open]);

    if (!form) {
        return null;
    }
    const roles = Array.isArray(group?.roles) ? group.roles : [];
    const roleIds = Array.isArray(form.roleIds) ? form.roleIds : [];
    const isEdit = form.mode === 'edit';
    const galleryOptions = galleryRows
        .map((row) => ({
            id: row?.id || row?.fileId || row?.file_id || '',
            label: getGroupRowLabel(row),
            image: getGroupRowImage(row, 'gallery')
        }))
        .filter((option) => option.id);

    function updateForm(patch) {
        onFormChange?.({ ...form, ...patch });
    }

    function toggleRole(roleId, checked) {
        const nextRoleIds = checked
            ? Array.from(new Set([...roleIds, roleId]))
            : roleIds.filter((id) => id !== roleId);
        updateForm({ roleIds: nextRoleIds });
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {isEdit ? 'Edit group post' : 'Create group post'}
                    </DialogTitle>
                    <DialogDescription>
                        {group?.name || 'Group'}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup className="gap-4">
                    <Field>
                        <FieldLabel htmlFor="group-post-title">
                            {t('dialog.group_post_edit.title')}
                        </FieldLabel>
                        <Input
                            id="group-post-title"
                            value={form.title}
                            onChange={(event) =>
                                updateForm({ title: event.target.value })
                            }
                            disabled={submitting}
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="group-post-text">
                            {t('dialog.group.generated.message')}
                        </FieldLabel>
                        <Textarea
                            id="group-post-text"
                            rows={4}
                            value={form.text}
                            onChange={(event) =>
                                updateForm({ text: event.target.value })
                            }
                            disabled={submitting}
                            className="resize-none"
                        />
                    </Field>
                    {!isEdit ? (
                        <Field
                            orientation="horizontal"
                            data-disabled={submitting}
                        >
                            <Checkbox
                                id="group-post-send-notification"
                                checked={Boolean(form.sendNotification)}
                                disabled={submitting}
                                onCheckedChange={(checked) =>
                                    updateForm({
                                        sendNotification: checked === true
                                    })
                                }
                            />
                            <FieldLabel htmlFor="group-post-send-notification">
                                {t(
                                    'dialog.group.generated.send_notification'
                                )}
                            </FieldLabel>
                        </Field>
                    ) : null}
                    <Field>
                        <FieldLabel>
                            {t('dialog.group.generated.post_visibility')}
                        </FieldLabel>
                        <ToggleGroup
                            type="single"
                            variant="outline"
                            size="sm"
                            value={form.visibility}
                            onValueChange={(visibility) => {
                                if (visibility) {
                                    updateForm({ visibility });
                                }
                            }}
                            disabled={submitting}
                        >
                            {['public', 'group'].map((visibility) => (
                                <ToggleGroupItem
                                    key={visibility}
                                    value={visibility}
                                >
                                    {visibility === 'public'
                                        ? 'Public'
                                        : 'Group'}
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                    </Field>
                    {form.visibility === 'group' ? (
                        <Field>
                            <FieldLabel>
                                {t('dialog.group.generated.roles')}
                            </FieldLabel>
                            {roles.length ? (
                                <FieldGroup
                                    data-slot="checkbox-group"
                                    className="grid max-h-48 gap-2 overflow-auto rounded-md border p-2 sm:grid-cols-2"
                                >
                                    {roles.map((role) => (
                                        <Field
                                            key={role.id || role.name}
                                            orientation="horizontal"
                                            data-disabled={
                                                submitting || !role.id
                                            }
                                        >
                                            <Checkbox
                                                id={`group-post-role-${role.id || role.name}`}
                                                checked={roleIds.includes(
                                                    role.id
                                                )}
                                                disabled={
                                                    submitting || !role.id
                                                }
                                                onCheckedChange={(checked) =>
                                                    toggleRole(
                                                        role.id,
                                                        checked === true
                                                    )
                                                }
                                            />
                                            <FieldLabel
                                                htmlFor={`group-post-role-${role.id || role.name}`}
                                                className="min-w-0 truncate"
                                            >
                                                {role.name || role.id}
                                            </FieldLabel>
                                        </Field>
                                    ))}
                                </FieldGroup>
                            ) : (
                                <GroupListState
                                    title={t(
                                        'dialog.group.generated.no_roles'
                                    )}
                                    description=""
                                    className="min-h-20 p-3"
                                />
                            )}
                        </Field>
                    ) : null}
                    <Field>
                        <FieldLabel htmlFor="group-post-image-id">
                            {t('dialog.group.generated.image')}
                        </FieldLabel>
                        <InputGroup>
                            <InputGroupInput
                                id="group-post-image-id"
                                value={form.imageId || ''}
                                onChange={(event) =>
                                    updateForm({ imageId: event.target.value })
                                }
                                disabled={submitting}
                                placeholder={t(
                                    'dialog.group.generated.gallery_image_id'
                                )}
                            />
                            <InputGroupAddon align="inline-end">
                                <InputGroupButton
                                    type="button"
                                    disabled={submitting || !form.imageId}
                                    onClick={() => updateForm({ imageId: '' })}
                                >
                                    {t('common.actions.clear')}
                                </InputGroupButton>
                                <InputGroupButton
                                    type="button"
                                    disabled={
                                        submitting ||
                                        galleryStatus === 'running'
                                    }
                                    onClick={() => void loadGalleryRows()}
                                >
                                    {t('common.actions.refresh')}
                                </InputGroupButton>
                            </InputGroupAddon>
                        </InputGroup>
                        {galleryOptions.length ? (
                            <div className="grid max-h-56 gap-2 overflow-auto rounded-md border p-2 sm:grid-cols-2">
                                {galleryOptions.map((option) => (
                                    <Button
                                        key={option.id}
                                        type="button"
                                        variant="outline"
                                        disabled={submitting}
                                        className={cn(
                                            'h-auto w-full min-w-0 justify-start gap-2 p-2 text-left text-sm',
                                            form.imageId === option.id &&
                                                'border-primary'
                                        )}
                                        onClick={() =>
                                            updateForm({ imageId: option.id })
                                        }
                                    >
                                        {option.image ? (
                                            <img
                                                src={option.image}
                                                alt=""
                                                className="size-12 shrink-0 rounded object-cover"
                                            />
                                        ) : (
                                            <span className="text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded border">
                                                <ImageIcon />
                                            </span>
                                        )}
                                        <span className="min-w-0">
                                            <span className="block truncate font-medium">
                                                {option.label}
                                            </span>
                                            <span className="text-muted-foreground block truncate font-mono text-xs">
                                                {option.id}
                                            </span>
                                        </span>
                                    </Button>
                                ))}
                            </div>
                        ) : (
                            <GroupListState
                                title={t(
                                    'dialog.group.generated.no_gallery_images'
                                )}
                                description={t(
                                    'dialog.group.generated.refresh_to_load_gallery_images'
                                )}
                                loading={galleryStatus === 'running'}
                                error={galleryError}
                                className="min-h-24 p-3"
                            />
                        )}
                    </Field>
                </FieldGroup>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={submitting}
                        onClick={() => onOpenChange?.(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={submitting}
                        onClick={() => onSubmit?.(form)}
                    >
                        {isEdit ? 'Edit Post' : 'Create Post'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
