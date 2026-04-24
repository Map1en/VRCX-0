import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { myAvatarRepository } from '@/repositories/index.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Button } from '@/ui/shadcn/button';
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
    FieldDescription,
    FieldGroup,
    FieldLabel
} from '@/ui/shadcn/field';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Spinner } from '@/ui/shadcn/spinner';
import { Textarea } from '@/ui/shadcn/textarea';

const CLEAR_STYLE_VALUE = '__clear__';

function normalizeStyleName(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function resolveAuthorTags(tags) {
    return (Array.isArray(tags) ? tags : [])
        .filter(
            (tag) => typeof tag === 'string' && tag.startsWith('author_tag_')
        )
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
    if (
        !Array.isArray(left) ||
        !Array.isArray(right) ||
        left.length !== right.length
    ) {
        return false;
    }

    return left.every((entry, index) => entry === right[index]);
}

function applyStyleParam(
    params,
    key,
    styleName,
    initialStyleName,
    styleIdByName
) {
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
    const { t } = useTranslation();

    const avatarId = normalizeStyleName(avatar?.id);
    const initialPrimaryStyle = normalizeStyleName(avatar?.styles?.primary);
    const initialSecondaryStyle = normalizeStyleName(avatar?.styles?.secondary);
    const initialTags = useMemo(
        () => (Array.isArray(avatar?.tags) ? avatar.tags : []),
        [avatar]
    );
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
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.my_avatars.generated_toast.failed_to_load_avatar_styles')
                );
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
        const names = new Set(
            [initialPrimaryStyle, initialSecondaryStyle].filter(Boolean)
        );
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
                toast.error(t('view.my_avatars.generated.selected_avatar_style_is_not_available'));
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
            toast.success(t('view.my_avatars.generated.avatar_styles_updated'));
            onOpenChange(false);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.my_avatars.generated_toast.failed_to_update_avatar_styles')
            );
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('dialog.set_avatar_styles.header')}</DialogTitle>
                    <DialogDescription>
                        {avatar?.name || avatarId || 'Avatar'}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <Field>
                        <FieldLabel>{t('view.my_avatars.generated.primary_style')}</FieldLabel>
                        <Select
                            value={primaryStyle || CLEAR_STYLE_VALUE}
                            onValueChange={(value) =>
                                setPrimaryStyle(
                                    value === CLEAR_STYLE_VALUE ? '' : value
                                )
                            }
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('view.my_avatars.generated.select_style')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value={CLEAR_STYLE_VALUE}>
                                        {t('view.my_avatars.generated.none')}
                                    </SelectItem>
                                    {styleNames.map((styleName) => (
                                        <SelectItem
                                            key={styleName}
                                            value={styleName}
                                        >
                                            {styleName}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field>
                        <FieldLabel>{t('view.my_avatars.generated.secondary_style')}</FieldLabel>
                        <Select
                            value={secondaryStyle || CLEAR_STYLE_VALUE}
                            onValueChange={(value) =>
                                setSecondaryStyle(
                                    value === CLEAR_STYLE_VALUE ? '' : value
                                )
                            }
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('view.my_avatars.generated.select_style')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value={CLEAR_STYLE_VALUE}>
                                        {t('view.my_avatars.generated.none')}
                                    </SelectItem>
                                    {styleNames.map((styleName) => (
                                        <SelectItem
                                            key={styleName}
                                            value={styleName}
                                        >
                                            {styleName}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="avatar-styles-author-tags">
                            {t('view.my_avatars.generated.author_tags')}
                        </FieldLabel>
                        <Textarea
                            id="avatar-styles-author-tags"
                            value={authorTags}
                            onChange={(event) =>
                                setAuthorTags(event.target.value)
                            }
                            rows={3}
                            placeholder="comma,separated,tags"
                        />
                    </Field>
                    {loadStatus === 'error' ? (
                        <FieldDescription>
                            {t('view.my_avatars.generated.style_list_could_not_be_loaded_unknown_style_selections_will')}
                        </FieldDescription>
                    ) : null}
                </FieldGroup>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={saving || loadStatus === 'running'}
                        onClick={() => void saveStyles()}
                    >
                        {saving || loadStatus === 'running' ? (
                            <Spinner data-icon="inline-start" />
                        ) : null}
                        {t('common.actions.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
