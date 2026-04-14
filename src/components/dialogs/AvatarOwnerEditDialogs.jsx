import { useEffect, useMemo, useState } from 'react';
import { Loader2Icon, UserIcon } from 'lucide-react';
import { toast } from 'sonner';

import { convertFileUrlToImageUrl } from '@/lib/entityMedia.js';
import { avatarProfileRepository } from '@/repositories/index.js';
import { cn } from '@/lib/utils.js';
import { Checkbox } from '@/ui/shadcn/checkbox.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import { Label } from '@/ui/shadcn/label.jsx';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select.jsx';
import { Textarea } from '@/ui/shadcn/textarea.jsx';

const contentTagOptions = [
    { value: 'content_horror', label: 'Horror' },
    { value: 'content_gore', label: 'Gore' },
    { value: 'content_violence', label: 'Violence' },
    { value: 'content_adult', label: 'Adult' },
    { value: 'content_sex', label: 'Sex' }
];

const noneValue = '__none__';

function normalizeTagName(value, prefix) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(new RegExp(`^${prefix}`), '');
    return normalized ? `${prefix}${normalized}` : '';
}

function contentTagsFromCsv(value) {
    return Array.from(
        new Set(
            String(value || '')
                .split(',')
                .map((entry) => normalizeTagName(entry, 'content_'))
                .filter(Boolean)
        )
    );
}

function contentTagsCsv(tags) {
    return tags
        .filter((tag) => tag.startsWith('content_'))
        .map((tag) => tag.replace(/^content_/, ''))
        .join(',');
}

function authorTagsFromCsv(value) {
    return Array.from(
        new Set(
            String(value || '')
                .split(',')
                .map((entry) => normalizeTagName(entry, 'author_tag_'))
                .filter(Boolean)
        )
    );
}

function mergeAvatars(currentAvatar, rows) {
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

function AvatarOwnerRow({ avatar, selected, onToggle }) {
    const imageUrl = convertFileUrlToImageUrl(avatar.thumbnailImageUrl || avatar.imageUrl, 128);
    const tagText = contentTagsCsv(Array.isArray(avatar.tags) ? avatar.tags : []);
    return (
        <button
            type="button"
            className={cn(
                'box-border flex w-[335px] cursor-pointer items-center p-1.5 text-left text-[13px] hover:rounded-[25px_5px_5px_25px] hover:bg-muted/50',
                selected ? 'bg-muted/40' : ''
            )}
            onClick={onToggle}>
            {imageUrl ? (
                <img src={imageUrl} alt="" className="mr-2.5 size-9 shrink-0 rounded-full object-cover" />
            ) : (
                <div className="mr-2.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                    <UserIcon className="size-4 text-muted-foreground" />
                </div>
            )}
            <span className="min-w-0 flex-1 overflow-hidden">
                <span className="block truncate font-medium leading-[18px]">{avatar.name || avatar.id}</span>
                <span className="block truncate text-xs text-muted-foreground">{avatar.releaseStatus || 'unknown'}</span>
                <span className="block truncate text-xs text-muted-foreground">{tagText || '—'}</span>
            </span>
            <span className="ml-2" onClick={(event) => event.stopPropagation()}>
                <Checkbox checked={selected} onCheckedChange={onToggle} />
            </span>
        </button>
    );
}

export function AvatarContentTagsDialog({
    open,
    avatar,
    currentUserId,
    endpoint,
    onOpenChange,
    onSavedCurrentAvatar
}) {
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [ownAvatars, setOwnAvatars] = useState([]);
    const [selectedAvatarIds, setSelectedAvatarIds] = useState([]);
    const [selectedTagsCsv, setSelectedTagsCsv] = useState('');
    const selectedTags = useMemo(() => contentTagsFromCsv(selectedTagsCsv), [selectedTagsCsv]);
    const selectedTagsSet = useMemo(() => new Set(selectedTags), [selectedTags]);

    useEffect(() => {
        let active = true;
        if (!open || !avatar?.id) {
            return () => {
                active = false;
            };
        }

        setSelectedAvatarIds([avatar.id]);
        setSelectedTagsCsv(contentTagsCsv(Array.isArray(avatar.tags) ? avatar.tags : []));
        setLoading(true);
        avatarProfileRepository.getAllAvatarsByUser({
            userId: currentUserId,
            user: 'me',
            endpoint,
            releaseStatus: 'all'
        })
            .then((rows) => {
                if (active) {
                    setOwnAvatars(mergeAvatars(avatar, rows));
                }
            })
            .catch((error) => {
                if (active) {
                    setOwnAvatars([avatar]);
                    toast.error(error instanceof Error ? error.message : 'Failed to load own avatars.');
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

    function toggleBuiltInTag(tag) {
        const nextTags = new Set(selectedTags);
        if (nextTags.has(tag)) {
            nextTags.delete(tag);
        } else {
            nextTags.add(tag);
        }
        setSelectedTagsCsv(contentTagsCsv(Array.from(nextTags)));
    }

    function toggleAvatar(avatarId) {
        setSelectedAvatarIds((current) =>
            current.includes(avatarId)
                ? current.filter((id) => id !== avatarId)
                : [...current, avatarId]
        );
    }

    function toggleAllAvatars() {
        setSelectedAvatarIds((current) =>
            current.length === ownAvatars.length ? [] : ownAvatars.map((entry) => entry.id)
        );
    }

    async function save() {
        if (saving || loading || !selectedAvatarIds.length) {
            return;
        }

        const avatarsById = new Map(ownAvatars.map((entry) => [entry.id, entry]));
        const originalTagsById = new Map();
        const savedAvatarIds = [];
        setSaving(true);
        try {
            for (const avatarId of selectedAvatarIds) {
                const targetAvatar = avatarsById.get(avatarId);
                if (!targetAvatar) {
                    continue;
                }
                const originalTags = Array.isArray(targetAvatar.tags) ? targetAvatar.tags.slice() : [];
                originalTagsById.set(avatarId, originalTags);
                const remainingTags = Array.isArray(targetAvatar.tags)
                    ? targetAvatar.tags.filter((tag) => !tag.startsWith('content_'))
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
                    onSavedCurrentAvatar?.(response.json && typeof response.json === 'object'
                        ? response.json
                        : { ...targetAvatar, tags: nextTags });
                }
            }
            toast.success('Avatar content tags updated.');
            onOpenChange(false);
        } catch (error) {
            const rollbackFailures = [];
            for (let index = savedAvatarIds.length - 1; index >= 0; index -= 1) {
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
                        onSavedCurrentAvatar?.(response.json && typeof response.json === 'object'
                            ? response.json
                            : { ...targetAvatar, tags: originalTags });
                    }
                } catch {
                    rollbackFailures.push(avatarId);
                }
            }
            const baseMessage = error instanceof Error ? error.message : 'Failed to update avatar content tags.';
            if (savedAvatarIds.length && rollbackFailures.length) {
                toast.error(`${baseMessage} Rolled back ${savedAvatarIds.length - rollbackFailures.length} avatar(s), but ${rollbackFailures.length} rollback(s) failed.`);
            } else if (savedAvatarIds.length) {
                toast.error(`${baseMessage} Rolled back ${savedAvatarIds.length} avatar(s).`);
            } else {
                toast.error(baseMessage);
            }
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[min(92vw,49rem)]">
                <DialogHeader>
                    <DialogTitle>Change Content Tags</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="grid gap-2 sm:grid-cols-2">
                        {contentTagOptions.map((option) => (
                            <Label key={option.value} className="inline-flex items-center gap-2">
                                <Checkbox checked={selectedTagsSet.has(option.value)} onCheckedChange={() => toggleBuiltInTag(option.value)} />
                                <span>{option.label}</span>
                            </Label>
                        ))}
                    </div>
                    <Textarea
                        rows={2}
                        value={selectedTagsCsv}
                        className="resize-none"
                        placeholder="horror,gore,violence,adult,sex"
                        onChange={(event) => setSelectedTagsCsv(event.target.value)}
                    />
                    <div className="flex items-center gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={toggleAllAvatars}>
                            {ownAvatars.length === selectedAvatarIds.length ? 'Select None' : 'Select All'}
                        </Button>
                        <span className="text-sm text-muted-foreground">{selectedAvatarIds.length} / {ownAvatars.length}</span>
                        {loading ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
                    </div>
                    <div className="flex max-h-[300px] min-h-[60px] flex-wrap items-start overflow-auto">
                        {ownAvatars.map((entry) => (
                            <AvatarOwnerRow
                                key={entry.id}
                                avatar={entry}
                                selected={selectedAvatarIds.includes(entry.id)}
                                onToggle={() => toggleAvatar(entry.id)}
                            />
                        ))}
                    </div>
                </div>
                <DialogFooter>
                    <Button type="button" variant="secondary" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button type="button" disabled={saving || loading || !selectedAvatarIds.length} onClick={() => void save()}>Save</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function AvatarStylesDialog({
    open,
    avatar,
    endpoint,
    onOpenChange,
    onSavedCurrentAvatar
}) {
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [styles, setStyles] = useState([]);
    const [primaryStyle, setPrimaryStyle] = useState('');
    const [secondaryStyle, setSecondaryStyle] = useState('');
    const [authorTags, setAuthorTags] = useState('');
    const stylesByName = useMemo(
        () => new Map(styles.filter((style) => style?.styleName && style?.id).map((style) => [style.styleName, style.id])),
        [styles]
    );

    useEffect(() => {
        let active = true;
        if (!open || !avatar?.id) {
            return () => {
                active = false;
            };
        }

        setPrimaryStyle(avatar.styles?.primary || '');
        setSecondaryStyle(avatar.styles?.secondary || '');
        setAuthorTags(
            (Array.isArray(avatar.tags) ? avatar.tags : [])
                .filter((tag) => tag.startsWith('author_tag_'))
                .map((tag) => tag.replace(/^author_tag_/, ''))
                .join(',')
        );
        setLoading(true);
        avatarProfileRepository.getAvatarStyles({ endpoint })
            .then((rows) => {
                if (active) {
                    setStyles(rows);
                }
            })
            .catch((error) => {
                if (active) {
                    setStyles([]);
                    toast.error(error instanceof Error ? error.message : 'Failed to load avatar styles.');
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
    }, [avatar, endpoint, open]);

    async function save() {
        if (saving || loading || !avatar?.id) {
            return;
        }

        const remainingTags = Array.isArray(avatar.tags)
            ? avatar.tags.filter((tag) => !tag.startsWith('author_tag_'))
            : [];
        const nextAuthorTags = authorTagsFromCsv(authorTags);
        const primaryStyleId = primaryStyle ? stylesByName.get(primaryStyle) || primaryStyle : '';
        const secondaryStyleId = secondaryStyle ? stylesByName.get(secondaryStyle) || secondaryStyle : '';

        setSaving(true);
        try {
            const response = await avatarProfileRepository.saveAvatar({
                avatarId: avatar.id,
                endpoint,
                params: {
                    id: avatar.id,
                    primaryStyle: primaryStyleId,
                    secondaryStyle: secondaryStyleId,
                    tags: [...remainingTags, ...nextAuthorTags]
                }
            });
            onSavedCurrentAvatar?.(response.json && typeof response.json === 'object'
                ? response.json
                : {
                    ...avatar,
                    styles: { primary: primaryStyle, secondary: secondaryStyle },
                    tags: [...remainingTags, ...nextAuthorTags]
                });
            toast.success('Avatar styles and author tags updated.');
            onOpenChange(false);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update avatar styles and author tags.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[min(92vw,25rem)]">
                <DialogHeader>
                    <DialogTitle>Change Styles and Author Tags</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Primary Style</Label>
                        <Select value={primaryStyle || noneValue} disabled={loading} onValueChange={(value) => setPrimaryStyle(value === noneValue ? '' : value)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select style" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={noneValue}>None</SelectItem>
                                {styles.map((style) => (
                                    <SelectItem key={style.id || style.styleName} value={style.styleName}>{style.styleName}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Secondary Style</Label>
                        <Select value={secondaryStyle || noneValue} disabled={loading} onValueChange={(value) => setSecondaryStyle(value === noneValue ? '' : value)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select style" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={noneValue}>None</SelectItem>
                                {styles.map((style) => (
                                    <SelectItem key={style.id || style.styleName} value={style.styleName}>{style.styleName}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Author Tags</Label>
                        <Textarea rows={2} className="resize-none" value={authorTags} onChange={(event) => setAuthorTags(event.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <Button type="button" variant="secondary" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button type="button" disabled={saving || loading} onClick={() => void save()}>Save</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
