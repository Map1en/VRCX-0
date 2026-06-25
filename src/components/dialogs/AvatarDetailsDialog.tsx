import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    authorTagsCsv,
    authorTagsFromCsv,
    styleName,
    tagsKey
} from '@/components/dialogs/avatarDetailsModel';
import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import { normalizeString } from '@/shared/utils/string';
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
import { Input } from '@/ui/shadcn/input';
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

const noneValue = '__none__';

function hasOwn(object: any, key: any) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

export function AvatarDetailsDialog({
    open,
    avatar,
    endpoint,
    onOpenChange,
    onSavedCurrentAvatar
}: any) {
    const { t } = useTranslation();

    const avatarId = normalizeString(avatar?.id);
    const initialName = typeof avatar?.name === 'string' ? avatar.name : '';
    const initialDescription =
        typeof avatar?.description === 'string' ? avatar.description : '';
    const initialPrimaryStyle = normalizeString(avatar?.styles?.primary);
    const initialSecondaryStyle = normalizeString(avatar?.styles?.secondary);
    const initialTags = useMemo(
        () => (Array.isArray(avatar?.tags) ? avatar.tags : []),
        [avatar]
    );
    const initialAuthorTags = useMemo(
        () => authorTagsFromCsv(authorTagsCsv(initialTags)),
        [initialTags]
    );

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);
    const [loadStatus, setLoadStatus] = useState('idle');
    const [styles, setStyles] = useState<any[]>([]);
    const [primaryStyle, setPrimaryStyle] = useState('');
    const [secondaryStyle, setSecondaryStyle] = useState('');
    const [authorTags, setAuthorTags] = useState('');

    const stylesByName = useMemo(() => {
        const map = new Map();
        for (const style of styles) {
            const nameValue = styleName(style);
            const idValue = normalizeString(style?.id);
            if (nameValue && idValue) {
                map.set(nameValue, idValue);
            }
        }
        return map;
    }, [styles]);

    const styleNames = useMemo(() => {
        const names = new Set(
            [initialPrimaryStyle, initialSecondaryStyle].filter(Boolean)
        );
        for (const style of styles) {
            const nameValue = styleName(style);
            if (nameValue) {
                names.add(nameValue);
            }
        }
        return Array.from(names);
    }, [initialPrimaryStyle, initialSecondaryStyle, styles]);

    useEffect(() => {
        if (!open) {
            setName('');
            setDescription('');
            setPrimaryStyle('');
            setSecondaryStyle('');
            setAuthorTags('');
            setStyles([]);
            setLoadStatus('idle');
            setSaving(false);
            return;
        }

        setName(initialName);
        setDescription(initialDescription);
        setPrimaryStyle(initialPrimaryStyle);
        setSecondaryStyle(initialSecondaryStyle);
        setAuthorTags(authorTagsCsv(initialTags));
    }, [
        initialDescription,
        initialName,
        initialPrimaryStyle,
        initialSecondaryStyle,
        initialTags,
        open
    ]);

    useEffect(() => {
        let active = true;
        if (!open || !avatarId) {
            return () => {
                active = false;
            };
        }

        setLoadStatus('running');
        avatarProfileRepository
            .getAvatarStyles({ endpoint })
            .then((rows: any) => {
                if (active) {
                    setStyles(Array.isArray(rows) ? rows : []);
                    setLoadStatus('ready');
                }
            })
            .catch((error: any) => {
                if (active) {
                    setStyles([]);
                    setLoadStatus('error');
                    toast.error(
                        error instanceof Error
                            ? error.message
                            : t(
                                  'dialog.avatar.toast.failed_to_load_avatar_styles'
                              )
                    );
                }
            });

        return () => {
            active = false;
        };
    }, [avatarId, endpoint, open, t]);

    async function save() {
        if (saving || loadStatus === 'running' || !avatarId) {
            return;
        }

        const params: any = { id: avatarId };
        const nextAuthorTags = authorTagsFromCsv(authorTags);
        const authorTagsChanged =
            tagsKey(initialAuthorTags) !== tagsKey(nextAuthorTags);

        if (name !== initialName) {
            params.name = name;
        }
        if (description !== initialDescription) {
            params.description = description;
        }
        if (primaryStyle !== initialPrimaryStyle) {
            params.primaryStyle = primaryStyle
                ? stylesByName.get(primaryStyle) || primaryStyle
                : '';
        }
        if (secondaryStyle !== initialSecondaryStyle) {
            params.secondaryStyle = secondaryStyle
                ? stylesByName.get(secondaryStyle) || secondaryStyle
                : '';
        }
        if (authorTagsChanged) {
            const remainingTags = initialTags.filter(
                (tag: any) =>
                    typeof tag === 'string' && !tag.startsWith('author_tag_')
            );
            params.tags = [...remainingTags, ...nextAuthorTags];
        }

        if (Object.keys(params).length === 1) {
            onOpenChange(false);
            return;
        }

        const fallbackAvatar: any = {
            ...avatar,
            ...(hasOwn(params, 'name') ? { name } : {}),
            ...(hasOwn(params, 'description') ? { description } : {}),
            ...(hasOwn(params, 'tags') ? { tags: params.tags } : {}),
            styles:
                hasOwn(params, 'primaryStyle') ||
                hasOwn(params, 'secondaryStyle')
                    ? {
                          ...(avatar?.styles || {}),
                          ...(hasOwn(params, 'primaryStyle')
                              ? { primary: primaryStyle }
                              : {}),
                          ...(hasOwn(params, 'secondaryStyle')
                              ? { secondary: secondaryStyle }
                              : {})
                      }
                    : avatar?.styles
        };

        setSaving(true);
        try {
            const response = await avatarProfileRepository.saveAvatar({
                avatarId,
                endpoint,
                params
            });
            onSavedCurrentAvatar?.(
                response.json && typeof response.json === 'object'
                    ? response.json
                    : fallbackAvatar
            );
            toast.success(t('dialog.avatar.success.avatar_details_updated'));
            onOpenChange(false);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.avatar.toast.failed_to_update_avatar_details')
            );
        } finally {
            setSaving(false);
        }
    }

    const controlsDisabled = saving || loadStatus === 'running';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[min(92vw,38rem)]">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.avatar.actions.edit_details')}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'dialog.avatar.description.edit_avatar_details_description'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <Field>
                        <FieldLabel htmlFor="avatar-details-name">
                            {t('dialog.avatar.info.name')}
                        </FieldLabel>
                        <Input
                            id="avatar-details-name"
                            value={name}
                            disabled={saving}
                            onChange={(event: any) =>
                                setName(event.target.value)
                            }
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="avatar-details-description">
                            {t('dialog.avatar.info.description')}
                        </FieldLabel>
                        <Textarea
                            id="avatar-details-description"
                            rows={4}
                            value={description}
                            disabled={saving}
                            className="resize-none"
                            onChange={(event: any) =>
                                setDescription(event.target.value)
                            }
                        />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                            <FieldLabel>
                                {t('dialog.set_avatar_styles.primary_style')}
                            </FieldLabel>
                            <Select
                                value={primaryStyle || noneValue}
                                disabled={controlsDisabled}
                                onValueChange={(value: any) =>
                                    setPrimaryStyle(
                                        value === noneValue ? '' : value
                                    )
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue
                                        placeholder={t(
                                            'dialog.avatar.action.select_style'
                                        )}
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectItem value={noneValue}>
                                            {t('dialog.avatar.label.none')}
                                        </SelectItem>
                                        {styleNames.map(
                                            (styleNameValue: any) => (
                                                <SelectItem
                                                    key={styleNameValue}
                                                    value={styleNameValue}
                                                >
                                                    {styleNameValue}
                                                </SelectItem>
                                            )
                                        )}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field>
                            <FieldLabel>
                                {t('dialog.set_avatar_styles.secondary_style')}
                            </FieldLabel>
                            <Select
                                value={secondaryStyle || noneValue}
                                disabled={controlsDisabled}
                                onValueChange={(value: any) =>
                                    setSecondaryStyle(
                                        value === noneValue ? '' : value
                                    )
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue
                                        placeholder={t(
                                            'dialog.avatar.action.select_style'
                                        )}
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectItem value={noneValue}>
                                            {t('dialog.avatar.label.none')}
                                        </SelectItem>
                                        {styleNames.map(
                                            (styleNameValue: any) => (
                                                <SelectItem
                                                    key={styleNameValue}
                                                    value={styleNameValue}
                                                >
                                                    {styleNameValue}
                                                </SelectItem>
                                            )
                                        )}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                    </div>
                    <Field>
                        <FieldLabel htmlFor="avatar-details-author-tags">
                            {t('dialog.world.info.author_tags')}
                        </FieldLabel>
                        <Textarea
                            id="avatar-details-author-tags"
                            rows={2}
                            className="resize-none"
                            value={authorTags}
                            disabled={saving}
                            placeholder="tag_one,tag_two"
                            onChange={(event: any) =>
                                setAuthorTags(event.target.value)
                            }
                        />
                        {loadStatus === 'error' ? (
                            <FieldDescription>
                                {t(
                                    'dialog.avatar.error.style_list_unavailable'
                                )}
                            </FieldDescription>
                        ) : null}
                    </Field>
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
                        disabled={controlsDisabled}
                        onClick={() => {
                            save();
                        }}
                    >
                        {controlsDisabled ? (
                            <Spinner data-icon="inline-start" />
                        ) : null}
                        {t('common.actions.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
