import { PlusIcon, SaveIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TAG_COLORS, getTagColor } from '@/shared/constants/tags';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import type { MyAvatarRow, MyAvatarTag } from './myAvatarsTypes';

type TagColor = (typeof TAG_COLORS)[number];

type ManageAvatarTagsDialogProps = {
    open: boolean;
    avatar: MyAvatarRow | null;
    saving?: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (payload: { avatarId: string; tags: MyAvatarTag[] }) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function normalizeTagName(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeTagEntries(entries: unknown): MyAvatarTag[] {
    const seen = new Set<string>();
    const normalized: MyAvatarTag[] = [];

    for (const entry of Array.isArray(entries) ? entries : []) {
        const entryRecord = isRecord(entry) ? entry : null;
        const tag = normalizeTagName(entryRecord?.tag ?? entry);
        if (!tag || seen.has(tag)) {
            continue;
        }
        seen.add(tag);
        normalized.push({
            tag,
            color:
                typeof entryRecord?.color === 'string' &&
                entryRecord.color.trim()
                    ? entryRecord.color.trim()
                    : null
        });
    }

    return normalized;
}

function resolveTagColor(entry: MyAvatarTag) {
    if (entry?.color) {
        return {
            bg: entry.color,
            text:
                typeof entry.color === 'string'
                    ? entry.color.replace(/\/ [\d.]+\)$/, ')')
                    : entry.color
        };
    }

    return getTagColor(entry?.tag || '');
}

export function ManageAvatarTagsDialog({
    open,
    avatar,
    saving = false,
    onOpenChange,
    onSave
}: ManageAvatarTagsDialogProps) {
    const { t } = useTranslation();

    const avatarId = normalizeTagName(avatar?.id);
    const avatarName = avatar?.name || avatarId || 'Avatar';
    const [tagEntries, setTagEntries] = useState<
        ReturnType<typeof normalizeTagEntries>
    >([]);
    const [newTagName, setNewTagName] = useState('');

    useEffect(() => {
        if (open) {
            setTagEntries(normalizeTagEntries(avatar?.$tags || []));
            setNewTagName('');
        }
    }, [avatar, open]);

    const tagNames = new Set(tagEntries.map((entry) => entry.tag));

    function addTag() {
        const tag = normalizeTagName(newTagName);
        if (!tag || tagNames.has(tag)) {
            setNewTagName('');
            return;
        }

        setTagEntries((current) => [...current, { tag, color: null }]);
        setNewTagName('');
    }

    function removeTag(tag: string) {
        setTagEntries((current) =>
            current.filter((entry) => entry.tag !== tag)
        );
    }

    function setTagColor(tag: string, color: TagColor) {
        setTagEntries((current) =>
            current.map((entry) => {
                if (entry.tag !== tag) {
                    return entry;
                }

                const defaultColor = getTagColor(entry.tag);
                return {
                    ...entry,
                    color: defaultColor.name === color.name ? null : color.bg
                };
            })
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('view.my_avatars.label.manage_avatar_tags')}
                    </DialogTitle>
                    <DialogDescription>{avatarName}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <FieldGroup>
                        <Field>
                            <FieldLabel htmlFor="avatar-tag-name">
                                {t('view.my_avatars.action.add_local_tag')}
                            </FieldLabel>
                            <div className="flex gap-2">
                                <Input
                                    id="avatar-tag-name"
                                    value={newTagName}
                                    onChange={(event) =>
                                        setNewTagName(event.target.value)
                                    }
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault();
                                            addTag();
                                        }
                                    }}
                                    placeholder={t(
                                        'view.my_avatars.label.tag_name'
                                    )}
                                    disabled={saving}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={addTag}
                                    disabled={saving}
                                >
                                    <PlusIcon data-icon="inline-start" />
                                    {t('view.my_avatars.action.add')}
                                </Button>
                            </div>
                        </Field>
                    </FieldGroup>

                    <div className="flex flex-col gap-3">
                        {tagEntries.length > 0 ? (
                            tagEntries.map((entry) => {
                                const tagColor = resolveTagColor(entry);
                                return (
                                    <div
                                        key={entry.tag}
                                        className="rounded-xl border p-3"
                                    >
                                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                            <Badge
                                                variant="secondary"
                                                className="w-fit"
                                                style={{
                                                    backgroundColor:
                                                        tagColor.bg,
                                                    color: tagColor.text
                                                }}
                                            >
                                                {entry.tag}
                                            </Badge>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                onClick={() =>
                                                    removeTag(entry.tag)
                                                }
                                                disabled={saving}
                                            >
                                                <XIcon data-icon="inline-start" />
                                                {t('common.actions.remove')}
                                            </Button>
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {TAG_COLORS.map((color) => {
                                                const selected =
                                                    (entry.color &&
                                                        entry.color ===
                                                            color.bg) ||
                                                    (!entry.color &&
                                                        getTagColor(entry.tag)
                                                            .name ===
                                                            color.name);
                                                return (
                                                    <Tooltip key={color.name}>
                                                        <TooltipTrigger
                                                            render={
                                                                <Button
                                                                    type="button"
                                                                    size="icon-sm"
                                                                    variant="outline"
                                                                    className={
                                                                        selected
                                                                            ? 'ring-ring size-6 p-0 ring-2 ring-offset-2'
                                                                            : 'size-6 p-0'
                                                                    }
                                                                    style={{
                                                                        backgroundColor:
                                                                            color.bg.replace(
                                                                                '/ 0.2)',
                                                                                '/ 1)'
                                                                            )
                                                                    }}
                                                                    aria-label={
                                                                        color.label
                                                                    }
                                                                    aria-pressed={
                                                                        selected
                                                                    }
                                                                    disabled={
                                                                        saving
                                                                    }
                                                                    data-selected={
                                                                        selected
                                                                            ? 'true'
                                                                            : undefined
                                                                    }
                                                                    onClick={() =>
                                                                        setTagColor(
                                                                            entry.tag,
                                                                            color
                                                                        )
                                                                    }
                                                                />
                                                            }
                                                        />
                                                        <TooltipContent>
                                                            {color.label}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="bg-muted/20 text-muted-foreground rounded-xl border border-dashed p-4 text-sm">
                                {t(
                                    'view.my_avatars.empty.this_avatar_has_no_local_tags_yet'
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={saving || !avatarId}
                        onClick={() => onSave({ avatarId, tags: tagEntries })}
                    >
                        <SaveIcon data-icon="inline-start" />
                        {t('common.actions.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
