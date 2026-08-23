import { PersonStandingIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { FadeInImage } from '@/components/media/FadeInImage';
import { cn } from '@/lib/utils';
import { commands } from '@/platform/tauri/bindings';
import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import myAvatarRepository from '@/repositories/myAvatarRepository';
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

import {
    CONTENT_TAG_OPTIONS,
    contentTagsCsv,
    contentTagsFromCsv
} from './contentTags';

export { AvatarDetailsDialog } from './AvatarDetailsDialog';

type OwnAvatar = Awaited<
    ReturnType<typeof myAvatarRepository.getMyAvatars>
>[number];
type EditableAvatar = Partial<OwnAvatar> & {
    id?: string;
    imageUrl?: string;
    name?: string;
    releaseStatus?: string;
    tags?: string[];
    thumbnailImageUrl?: string;
};

function mergeAvatars(currentAvatar: EditableAvatar, rows: OwnAvatar[]) {
    const avatars: EditableAvatar[] = [];
    const seen = new Set<string>();
    for (const row of [currentAvatar, ...rows]) {
        if (!row?.id || seen.has(row.id)) {
            continue;
        }
        seen.add(row.id);
        avatars.push(row);
    }
    return avatars;
}

function AvatarOwnerRow({
    avatar,
    selected,
    onToggle
}: {
    avatar: EditableAvatar;
    selected: boolean;
    onToggle(): void;
}) {
    const { t } = useTranslation();
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
                    <FadeInImage
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
                aria-label={t('accessibility.select_avatar', {
                    avatar:
                        avatar.name || avatar.id || t('accessibility.avatar')
                })}
                onCheckedChange={onToggle}
            />
        </div>
    );
}

export function AvatarContentTagsDialog({
    open,
    avatar,
    onOpenChange,
    onSavedCurrentAvatar
}: {
    open: boolean;
    avatar: EditableAvatar | null;
    onOpenChange(open: boolean): void;
    onSavedCurrentAvatar(avatar: OwnAvatar): void;
}) {
    const { t } = useTranslation();

    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [ownAvatars, setOwnAvatars] = useState<EditableAvatar[]>([]);
    const [selectedAvatarIds, setSelectedAvatarIds] = useState<string[]>([]);
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
        myAvatarRepository
            .getMyAvatars()
            .then((rows) => {
                if (active) {
                    setOwnAvatars(mergeAvatars(avatar, rows));
                }
            })
            .catch((error: unknown) => {
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
    }, [avatar, open, t]);

    function toggleBuiltInTag(tag: string) {
        const nextTags = new Set(selectedTags);
        if (nextTags.has(tag)) {
            nextTags.delete(tag);
        } else {
            nextTags.add(tag);
        }
        setSelectedTagsCsv(contentTagsCsv(Array.from(nextTags)));
    }

    function toggleAvatar(avatarId: string) {
        setSelectedAvatarIds((current) =>
            current.includes(avatarId)
                ? current.filter((id) => id !== avatarId)
                : [...current, avatarId]
        );
    }

    function toggleAllAvatars() {
        setSelectedAvatarIds((current) =>
            current.length === ownAvatars.length
                ? []
                : ownAvatars.flatMap((entry) => (entry.id ? [entry.id] : []))
        );
    }

    async function save() {
        if (saving || loading || !selectedAvatarIds.length || !avatar?.id) {
            return;
        }

        const avatarIds = selectedAvatarIds.filter(
            (avatarId): avatarId is string => typeof avatarId === 'string'
        );
        setSaving(true);
        try {
            const result = await commands.appAvatarContentTagsBatch({
                avatarIds,
                contentTags: selectedTags
            });
            const currentAvatarResult = result.items.find(
                (item) => item.id === avatar.id
            );
            if (currentAvatarResult?.entity) {
                const nextAvatar = avatarProfileRepository.normalize(
                    currentAvatarResult.entity
                );
                if (nextAvatar.id) {
                    onSavedCurrentAvatar(nextAvatar);
                }
            }
            if (result.failed) {
                const baseMessage =
                    result.lastError || 'Failed to update avatar content tags.';
                if (
                    result.appliedBeforeFailure > 0 &&
                    result.rollbackFailed > 0
                ) {
                    toast.error(
                        t(
                            'dialog.avatar_owner_edit_dialogs.dynamic.value_rolled_back_value_avatar_s_but_value_rollback',
                            {
                                value: baseMessage,
                                value2: result.rolledBack,
                                value3: result.rollbackFailed
                            }
                        )
                    );
                } else if (result.appliedBeforeFailure > 0) {
                    toast.error(
                        t(
                            'dialog.avatar_owner_edit_dialogs.dynamic.value_rolled_back_value_avatar_s',
                            {
                                value: baseMessage,
                                value2: result.rolledBack
                            }
                        )
                    );
                } else {
                    toast.error(baseMessage);
                }
                return;
            }
            toast.success(
                t('dialog.avatar.success.avatar_content_tags_updated')
            );
            onOpenChange(false);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to update avatar content tags.'
            );
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
                            {CONTENT_TAG_OPTIONS.map((option) => (
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
                                        {t(option.labelKey)}
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
                            onChange={(event) =>
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
                        {ownAvatars
                            .filter(
                                (
                                    entry
                                ): entry is EditableAvatar & { id: string } =>
                                    Boolean(entry.id)
                            )
                            .map((entry) => (
                                <AvatarOwnerRow
                                    key={entry.id}
                                    avatar={entry}
                                    selected={selectedAvatarIds.includes(
                                        entry.id
                                    )}
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
