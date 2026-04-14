import { useEffect, useMemo, useState } from 'react';
import { PlusIcon, SaveIcon, XIcon } from 'lucide-react';

import { TAG_COLORS, getTagColor } from '@/shared/constants/tags.js';
import { Badge } from '@/ui/shadcn/badge.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import { Input } from '@/ui/shadcn/input.jsx';

function normalizeTagName(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeTagEntries(entries) {
    const seen = new Set();
    const normalized = [];

    for (const entry of entries ?? []) {
        const tag = normalizeTagName(entry?.tag ?? entry);
        if (!tag || seen.has(tag)) {
            continue;
        }
        seen.add(tag);
        normalized.push({
            tag,
            color: typeof entry?.color === 'string' && entry.color.trim() ? entry.color.trim() : null
        });
    }

    return normalized;
}

function resolveTagColor(entry) {
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
}) {
    const avatarId = normalizeTagName(avatar?.id);
    const avatarName = avatar?.name || avatarId || 'Avatar';
    const [tagEntries, setTagEntries] = useState([]);
    const [newTagName, setNewTagName] = useState('');

    useEffect(() => {
        if (open) {
            setTagEntries(normalizeTagEntries(avatar?.$tags || []));
            setNewTagName('');
        }
    }, [avatar, open]);

    const tagNames = useMemo(() => new Set(tagEntries.map((entry) => entry.tag)), [tagEntries]);

    function addTag() {
        const tag = normalizeTagName(newTagName);
        if (!tag || tagNames.has(tag)) {
            setNewTagName('');
            return;
        }

        setTagEntries((current) => [...current, { tag, color: null }]);
        setNewTagName('');
    }

    function removeTag(tag) {
        setTagEntries((current) => current.filter((entry) => entry.tag !== tag));
    }

    function setTagColor(tag, color) {
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
                    <DialogTitle>Manage avatar tags</DialogTitle>
                    <DialogDescription>{avatarName}</DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="flex gap-2">
                        <Input
                            value={newTagName}
                            onChange={(event) => setNewTagName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    addTag();
                                }
                            }}
                            placeholder="Add a local tag"
                            disabled={saving}
                        />
                        <Button type="button" variant="outline" className="gap-2" onClick={addTag} disabled={saving}>
                            <PlusIcon className="size-4" />
                            Add
                        </Button>
                    </div>

                    <div className="space-y-3">
                        {tagEntries.length > 0 ? (
                            tagEntries.map((entry) => {
                                const tagColor = resolveTagColor(entry);
                                return (
                                    <div key={entry.tag} className="rounded-xl border p-3">
                                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                            <Badge
                                                variant="secondary"
                                                className="w-fit"
                                                style={{
                                                    backgroundColor: tagColor.bg,
                                                    color: tagColor.text
                                                }}>
                                                {entry.tag}
                                            </Badge>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="h-8 gap-1"
                                                onClick={() => removeTag(entry.tag)}
                                                disabled={saving}>
                                                <XIcon className="size-3.5" />
                                                Remove
                                            </Button>
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {TAG_COLORS.map((color) => {
                                                const selected =
                                                    (entry.color && entry.color === color.bg) ||
                                                    (!entry.color && getTagColor(entry.tag).name === color.name);
                                                return (
                                                    <button
                                                        key={color.name}
                                                        type="button"
                                                        className="size-6 rounded-md border transition-transform hover:scale-110 disabled:opacity-50"
                                                        style={{
                                                            backgroundColor: color.bg.replace('/ 0.2)', '/ 1)')
                                                        }}
                                                        aria-label={color.label}
                                                        title={color.label}
                                                        disabled={saving}
                                                        data-selected={selected ? 'true' : undefined}
                                                        onClick={() => setTagColor(entry.tag, color)}
                                                    />
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
                                This avatar has no local tags yet.
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        className="gap-2"
                        disabled={saving || !avatarId}
                        onClick={() => onSave({ avatarId, tags: tagEntries })}>
                        <SaveIcon className="size-4" />
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
