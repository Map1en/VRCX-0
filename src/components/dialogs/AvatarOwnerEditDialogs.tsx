import { PersonStandingIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
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
import {
    Field,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSet
} from '@/ui/shadcn/field';
import { Spinner } from '@/ui/shadcn/spinner';
import { Textarea } from '@/ui/shadcn/textarea';

export { AvatarDetailsDialog } from './AvatarDetailsDialog';

const contentTagOptions = [
    { value: 'content_horror', label: 'Horror' },
    { value: 'content_gore', label: 'Gore' },
    { value: 'content_violence', label: 'Violence' },
    { value: 'content_adult', label: 'Adult' },
    { value: 'content_sex', label: 'Sex' }
];

function normalizeTagName(value: any, prefix: any) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(new RegExp(`^${prefix}`), '');
    return normalized ? `${prefix}${normalized}` : '';
}

function contentTagsFromCsv(value: any) {
    return Array.from(
        new Set(
            String(value || '')
                .split(',')
                .map((entry: any) => normalizeTagName(entry, 'content_'))
                .filter(Boolean)
        )
    );
}

function contentTagsCsv(tags: any) {
    return tags
        .filter((tag: any) => tag.startsWith('content_'))
        .map((tag: any) => tag.replace(/^content_/, ''))
        .join(',');
}

function mergeAvatars(currentAvatar: any, rows: any) {
    const avatars = [];
    const seen = new Set();
    for (const row of [currentAvatar, ...rows]) {
        if (!row?.id || seen.has(row.id)) {
            continue;
        }
        seen.add(row.id);
        avatars.push(row);
    }
    return avatars;
}

function AvatarOwnerRow({ avatar, selected, onToggle }: any) {
    const imageUrl = convertFileUrlToImageUrl(
        avatar.thumbnailImageUrl || avatar.imageUrl,
        128
    );
    const tagText = contentTagsCsv(
        Array.isArray(avatar.tags) ? avatar.tags : []
    );
    return (
        <div
            className={cn(
                'flex w-80 items-center rounded-md text-sm',
                selected && 'bg-muted/40'
            )}
        >
            <Button
                type="button"
                variant="ghost"
                className="h-auto min-w-0 flex-1 justify-start p-1.5 text-left"
                aria-pressed={selected}
                onClick={onToggle}
            >
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt=""
                        className="mr-2.5 size-9 shrink-0 rounded-full object-cover"
                    />
                ) : (
                    <div className="bg-muted mr-2.5 flex size-9 shrink-0 items-center justify-center rounded-full">
                        <PersonStandingIcon
                            data-icon="inline-start"
                            className="text-muted-foreground"
                        />
                    </div>
                )}
                <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="block truncate leading-5 font-medium">
                        {avatar.name || avatar.id}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                        {avatar.releaseStatus || 'unknown'}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                        {tagText || '—'}
                    </span>
                </span>
            </Button>
            <Checkbox
                checked={selected}
                className="mx-2 shrink-0"
                aria-label={`Select ${avatar.name || avatar.id || 'avatar'}`}
                onCheckedChange={onToggle}
            />
        </div>
    );
}

export function AvatarContentTagsDialog({
    open,
    avatar,
    currentUserId,
    endpoint,
    onOpenChange,
    onSavedCurrentAvatar
}: any) {
    const { t } = useTranslation();

    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [ownAvatars, setOwnAvatars] = useState<any[]>([]);
    const [selectedAvatarIds, setSelectedAvatarIds] = useState<any[]>([]);
    const [selectedTagsCsv, setSelectedTagsCsv] = useState('');
    const selectedTags = contentTagsFromCsv(selectedTagsCsv);
    const selectedTagsSet = new Set(selectedTags);

    useEffect(() => {
        let active = true;
        if (!open || !avatar?.id) {
            return () => {
                active = false;
            };
        }

        setSelectedAvatarIds([avatar.id]);
        setSelectedTagsCsv(
            contentTagsCsv(Array.isArray(avatar.tags) ? avatar.tags : [])
        );
        setLoading(true);
        avatarProfileRepository
            .getAllAvatarsByUser({
                userId: currentUserId,
                user: 'me',
                endpoint,
                releaseStatus: 'all'
            })
            .then((rows: any) => {
                if (active) {
                    setOwnAvatars(mergeAvatars(avatar, rows));
                }
            })
            .catch((error: any) => {
                if (active) {
                    setOwnAvatars([avatar]);
                    toast.error(
                        error instanceof Error
                            ? error.message
                            : t(
                                  'dialog.avatar_owner_edit_dialogs.toast.failed_to_load_own_avatars'
                              )
                    );
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [avatar, currentUserId, endpoint, open]);

    function toggleBuiltInTag(tag: any) {
        const nextTags = new Set(selectedTags);
        if (nextTags.has(tag)) {
            nextTags.delete(tag);
        } else {
            nextTags.add(tag);
        }
        setSelectedTagsCsv(contentTagsCsv(Array.from(nextTags)));
    }

    function toggleAvatar(avatarId: any) {
        setSelectedAvatarIds((current: any) =>
            current.includes(avatarId)
                ? current.filter((id: any) => id !== avatarId)
                : [...current, avatarId]
        );
    }

    function toggleAllAvatars() {
        setSelectedAvatarIds((current: any) =>
            current.length === ownAvatars.length
                ? []
                : ownAvatars.map((entry: any) => entry.id)
        );
    }

    async function save() {
        if (saving || loading || !selectedAvatarIds.length) {
            return;
        }

        const avatarsById = new Map(
            ownAvatars.map((entry: any) => [entry.id, entry])
        );
        const originalTagsById = new Map();
        const savedAvatarIds = [];
        setSaving(true);
        try {
            for (const avatarId of selectedAvatarIds) {
                const targetAvatar = avatarsById.get(avatarId);
                if (!targetAvatar) {
                    continue;
                }
                const originalTags = Array.isArray(targetAvatar.tags)
                    ? targetAvatar.tags.slice()
                    : [];
                originalTagsById.set(avatarId, originalTags);
                const remainingTags = Array.isArray(targetAvatar.tags)
                    ? targetAvatar.tags.filter(
                          (tag: any) => !tag.startsWith('content_')
                      )
                    : [];
                const nextTags = [...remainingTags, ...selectedTags];
                const response = await avatarProfileRepository.saveAvatar({
                    avatarId,
                    endpoint,
                    params: {
                        id: avatarId,
                        tags: nextTags
                    }
                });
                savedAvatarIds.push(avatarId);
                if (avatarId === avatar.id) {
                    onSavedCurrentAvatar?.(
                        response.json && typeof response.json === 'object'
                            ? response.json
                            : { ...targetAvatar, tags: nextTags }
                    );
                }
            }
            toast.success(
                t('dialog.avatar.success.avatar_content_tags_updated')
            );
            onOpenChange(false);
        } catch (error) {
            const rollbackFailures = [];
            for (
                let index = savedAvatarIds.length - 1;
                index >= 0;
                index -= 1
            ) {
                const avatarId = savedAvatarIds[index];
                const targetAvatar = avatarsById.get(avatarId);
                const originalTags = originalTagsById.get(avatarId) || [];
                try {
                    const response = await avatarProfileRepository.saveAvatar({
                        avatarId,
                        endpoint,
                        params: {
                            id: avatarId,
                            tags: originalTags
                        }
                    });
                    if (avatarId === avatar.id) {
                        onSavedCurrentAvatar?.(
                            response.json && typeof response.json === 'object'
                                ? response.json
                                : { ...targetAvatar, tags: originalTags }
                        );
                    }
                } catch {
                    rollbackFailures.push(avatarId);
                }
            }
            const baseMessage =
                error instanceof Error
                    ? error.message
                    : 'Failed to update avatar content tags.';
            if (savedAvatarIds.length && rollbackFailures.length) {
                toast.error(
                    t(
                        'dialog.avatar_owner_edit_dialogs.dynamic.value_rolled_back_value_avatar_s_but_value_rollback',
                        {
                            value: baseMessage,
                            value2:
                                savedAvatarIds.length - rollbackFailures.length,
                            value3: rollbackFailures.length
                        }
                    )
                );
            } else if (savedAvatarIds.length) {
                toast.error(
                    t(
                        'dialog.avatar_owner_edit_dialogs.dynamic.value_rolled_back_value_avatar_s',
                        { value: baseMessage, value2: savedAvatarIds.length }
                    )
                );
            } else {
                toast.error(baseMessage);
            }
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[min(92vw,49rem)]">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.avatar.actions.change_content_tags')}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'dialog.avatar.action.apply_content_tags_to_this_avatar_or_selected_owned_avatars'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <FieldSet>
                        <FieldLegend variant="label">
                            {t('dialog.avatar.label.built_in_content_tags')}
                        </FieldLegend>
                        <FieldGroup
                            data-slot="checkbox-group"
                            className="grid gap-2 sm:grid-cols-2"
                        >
                            {contentTagOptions.map((option: any) => (
                                <Field
                                    key={option.value}
                                    orientation="horizontal"
                                >
                                    <Checkbox
                                        id={`avatar-content-tag-${option.value}`}
                                        checked={selectedTagsSet.has(
                                            option.value
                                        )}
                                        onCheckedChange={() =>
                                            toggleBuiltInTag(option.value)
                                        }
                                    />
                                    <FieldLabel
                                        htmlFor={`avatar-content-tag-${option.value}`}
                                    >
                                        {option.label}
                                    </FieldLabel>
                                </Field>
                            ))}
                        </FieldGroup>
                    </FieldSet>
                    <Field>
                        <FieldLabel
                            htmlFor="avatar-content-tags-csv"
                            className="sr-only"
                        >
                            {t('dialog.avatar.label.raw_content_tags')}
                        </FieldLabel>
                        <Textarea
                            id="avatar-content-tags-csv"
                            rows={2}
                            value={selectedTagsCsv}
                            className="resize-none"
                            placeholder="horror,gore,violence,adult,sex"
                            onChange={(event: any) =>
                                setSelectedTagsCsv(event.target.value)
                            }
                        />
                    </Field>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={toggleAllAvatars}
                        >
                            {ownAvatars.length === selectedAvatarIds.length
                                ? 'Select None'
                                : 'Select All'}
                        </Button>
                        <span className="text-muted-foreground text-sm">
                            {selectedAvatarIds.length} / {ownAvatars.length}
                        </span>
                        {loading ? (
                            <Spinner className="text-muted-foreground" />
                        ) : null}
                    </div>
                    <div className="flex max-h-72 min-h-16 flex-wrap items-start overflow-auto">
                        {ownAvatars.map((entry: any) => (
                            <AvatarOwnerRow
                                key={entry.id}
                                avatar={entry}
                                selected={selectedAvatarIds.includes(entry.id)}
                                onToggle={() => toggleAvatar(entry.id)}
                            />
                        ))}
                    </div>
                </FieldGroup>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={saving}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={
                            saving || loading || !selectedAvatarIds.length
                        }
                        onClick={() => {
                            save();
                        }}
                    >
                        {t('common.actions.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
