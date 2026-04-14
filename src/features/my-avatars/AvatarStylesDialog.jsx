import { useEffect, useMemo, useState } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import { toast } from 'sonner';

import { myAvatarRepository } from '@/repositories/index.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    Dialog,
    DialogContent,
    DialogDescription,
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

const CLEAR_STYLE_VALUE = '__clear__';

function normalizeStyleName(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function resolveAuthorTags(tags) {
    return (Array.isArray(tags) ? tags : [])
        .filter((tag) => typeof tag === 'string' && tag.startsWith('author_tag_'))
        .map((tag) => tag.slice('author_tag_'.length))
        .join(',');
}

function buildTags(initialTags, authorTags) {
    const tags = (Array.isArray(initialTags) ? initialTags : []).filter(
        (tag) => typeof tag === 'string' && !tag.startsWith('author_tag_')
    );
    for (const tag of String(authorTags || '').split(',')) {
        const normalized = tag.trim();
        if (!normalized) {
            continue;
        }
        const tagName = `author_tag_${normalized}`;
        if (!tags.includes(tagName)) {
            tags.push(tagName);
        }
    }
    return tags;
}

function arraysMatch(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
        return false;
    }

    return left.every((entry, index) => entry === right[index]);
}

function applyStyleParam(params, key, styleName, initialStyleName, styleIdByName) {
    if (!styleName) {
        params[key] = '';
        return true;
    }

    if (styleIdByName.has(styleName)) {
        params[key] = styleIdByName.get(styleName);
        return true;
    }

    return styleName === initialStyleName;
}

function isRuntimeAuthTarget(authTarget) {
    const runtimeAuth = useRuntimeStore.getState().auth;
    return (
        runtimeAuth.currentUserId === authTarget.currentUserId &&
        runtimeAuth.currentUserEndpoint === authTarget.currentEndpoint
    );
}

export function AvatarStylesDialog({
    open,
    avatar,
    currentUserId = '',
    endpoint = '',
    onOpenChange,
    onSaved
}) {
    const avatarId = normalizeStyleName(avatar?.id);
    const initialPrimaryStyle = normalizeStyleName(avatar?.styles?.primary);
    const initialSecondaryStyle = normalizeStyleName(avatar?.styles?.secondary);
    const initialTags = useMemo(() => (Array.isArray(avatar?.tags) ? avatar.tags : []), [avatar]);
    const [primaryStyle, setPrimaryStyle] = useState('');
    const [secondaryStyle, setSecondaryStyle] = useState('');
    const [authorTags, setAuthorTags] = useState('');
    const [availableStyles, setAvailableStyles] = useState([]);
    const [loadStatus, setLoadStatus] = useState('idle');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) {
            setPrimaryStyle('');
            setSecondaryStyle('');
            setAuthorTags('');
            setAvailableStyles([]);
            setLoadStatus('idle');
            setSaving(false);
            return;
        }

        setPrimaryStyle(initialPrimaryStyle);
        setSecondaryStyle(initialSecondaryStyle);
        setAuthorTags(resolveAuthorTags(initialTags));
    }, [initialPrimaryStyle, initialSecondaryStyle, initialTags, open]);

    useEffect(() => {
        let active = true;
        if (!open) {
            return () => {
                active = false;
            };
        }

        setLoadStatus('running');
        myAvatarRepository
            .getAvailableAvatarStyles({ endpoint })
            .then((styles) => {
                if (!active) {
                    return;
                }
                setAvailableStyles(styles);
                setLoadStatus('ready');
            })
            .catch((error) => {
                if (!active) {
                    return;
                }
                setLoadStatus('error');
                toast.error(error instanceof Error ? error.message : 'Failed to load avatar styles.');
            });

        return () => {
            active = false;
        };
    }, [endpoint, open]);

    const styleIdByName = useMemo(() => {
        const map = new Map();
        for (const style of availableStyles) {
            const name = normalizeStyleName(style?.styleName);
            if (name) {
                map.set(name, normalizeStyleName(style?.id));
            }
        }
        return map;
    }, [availableStyles]);

    const styleNames = useMemo(() => {
        const names = new Set([initialPrimaryStyle, initialSecondaryStyle].filter(Boolean));
        for (const style of availableStyles) {
            const name = normalizeStyleName(style?.styleName);
            if (name) {
                names.add(name);
            }
        }
        return Array.from(names);
    }, [availableStyles, initialPrimaryStyle, initialSecondaryStyle]);

    async function saveStyles() {
        if (!avatarId) {
            return;
        }

        const authTarget = {
            currentUserId,
            currentEndpoint: endpoint || ''
        };

        if (!authTarget.currentUserId || !isRuntimeAuthTarget(authTarget)) {
            return;
        }

        const nextTags = buildTags(initialTags, authorTags);
        if (
            initialPrimaryStyle === primaryStyle &&
            initialSecondaryStyle === secondaryStyle &&
            arraysMatch(initialTags, nextTags)
        ) {
            onOpenChange(false);
            return;
        }

        setSaving(true);
        try {
            const params = { tags: nextTags };
            const hasPrimaryStyleParam = applyStyleParam(
                params,
                'primaryStyle',
                primaryStyle,
                initialPrimaryStyle,
                styleIdByName
            );
            const hasSecondaryStyleParam = applyStyleParam(
                params,
                'secondaryStyle',
                secondaryStyle,
                initialSecondaryStyle,
                styleIdByName
            );
            if (!hasPrimaryStyleParam || !hasSecondaryStyleParam) {
                toast.error('Selected avatar style is not available.');
                return;
            }

            const savedAvatar = await myAvatarRepository.saveAvatar({
                avatarId,
                endpoint,
                params
            });
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            onSaved?.(savedAvatar);
            toast.success('Avatar styles updated.');
            onOpenChange(false);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update avatar styles.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Set Avatar Styles</DialogTitle>
                    <DialogDescription>{avatar?.name || avatarId || 'Avatar'}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Primary style</Label>
                        <Select
                            value={primaryStyle || CLEAR_STYLE_VALUE}
                            onValueChange={(value) =>
                                setPrimaryStyle(value === CLEAR_STYLE_VALUE ? '' : value)
                            }>
                            <SelectTrigger>
                                <SelectValue placeholder="Select style" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={CLEAR_STYLE_VALUE}>None</SelectItem>
                                {styleNames.map((styleName) => (
                                    <SelectItem key={styleName} value={styleName}>
                                        {styleName}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Secondary style</Label>
                        <Select
                            value={secondaryStyle || CLEAR_STYLE_VALUE}
                            onValueChange={(value) =>
                                setSecondaryStyle(value === CLEAR_STYLE_VALUE ? '' : value)
                            }>
                            <SelectTrigger>
                                <SelectValue placeholder="Select style" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={CLEAR_STYLE_VALUE}>None</SelectItem>
                                {styleNames.map((styleName) => (
                                    <SelectItem key={styleName} value={styleName}>
                                        {styleName}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Author tags</Label>
                        <Textarea
                            value={authorTags}
                            onChange={(event) => setAuthorTags(event.target.value)}
                            rows={3}
                            placeholder="comma,separated,tags"
                        />
                    </div>
                    {loadStatus === 'error' ? (
                        <div className="text-sm text-muted-foreground">
                            Style list could not be loaded. Unknown style selections will be preserved.
                        </div>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="button" disabled={saving || loadStatus === 'running'} onClick={() => void saveStyles()}>
                        {saving || loadStatus === 'running' ? (
                            <LoaderCircleIcon className="size-4 animate-spin" />
                        ) : null}
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
