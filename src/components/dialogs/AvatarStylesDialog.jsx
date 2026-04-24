import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { avatarProfileRepository } from '@/repositories/index.js';
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
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Textarea } from '@/ui/shadcn/textarea';

const noneValue = '__none__';

function normalizeTagName(value, prefix) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(new RegExp(`^${prefix}`), '');
    return normalized ? `${prefix}${normalized}` : '';
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

export function AvatarStylesDialog({
    open,
    avatar,
    endpoint,
    onOpenChange,
    onSavedCurrentAvatar
}) {
    const { t } = useTranslation();

    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [styles, setStyles] = useState([]);
    const [primaryStyle, setPrimaryStyle] = useState('');
    const [secondaryStyle, setSecondaryStyle] = useState('');
    const [authorTags, setAuthorTags] = useState('');
    const stylesByName = useMemo(
        () =>
            new Map(
                styles
                    .filter((style) => style?.styleName && style?.id)
                    .map((style) => [style.styleName, style.id])
            ),
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
        avatarProfileRepository
            .getAvatarStyles({ endpoint })
            .then((rows) => {
                if (active) {
                    setStyles(rows);
                }
            })
            .catch((error) => {
                if (active) {
                    setStyles([]);
                    toast.error(
                        error instanceof Error
                            ? error.message
                            : t(
                                  'dialog.avatar_owner_edit_dialogs.generated_toast.failed_to_load_avatar_styles'
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
    }, [avatar, endpoint, open]);

    async function save() {
        if (saving || loading || !avatar?.id) {
            return;
        }

        const remainingTags = Array.isArray(avatar.tags)
            ? avatar.tags.filter((tag) => !tag.startsWith('author_tag_'))
            : [];
        const nextAuthorTags = authorTagsFromCsv(authorTags);
        const primaryStyleId = primaryStyle
            ? stylesByName.get(primaryStyle) || primaryStyle
            : '';
        const secondaryStyleId = secondaryStyle
            ? stylesByName.get(secondaryStyle) || secondaryStyle
            : '';

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
            onSavedCurrentAvatar?.(
                response.json && typeof response.json === 'object'
                    ? response.json
                    : {
                          ...avatar,
                          styles: {
                              primary: primaryStyle,
                              secondary: secondaryStyle
                          },
                          tags: [...remainingTags, ...nextAuthorTags]
                      }
            );
            toast.success(
                t(
                    'dialog.avatar.generated.avatar_styles_and_author_tags_updated'
                )
            );
            onOpenChange(false);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.avatar_owner_edit_dialogs.generated_toast.failed_to_update_avatar_styles_and_author_tags'
                      )
            );
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[min(92vw,25rem)]">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.avatar.actions.change_styles_author_tags')}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'dialog.avatar.generated.set_avatar_style_metadata_and_author_tags'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <Field>
                        <FieldLabel>
                            {t('dialog.set_avatar_styles.primary_style')}
                        </FieldLabel>
                        <Select
                            value={primaryStyle || noneValue}
                            disabled={loading}
                            onValueChange={(value) =>
                                setPrimaryStyle(
                                    value === noneValue ? '' : value
                                )
                            }
                        >
                            <SelectTrigger>
                                <SelectValue
                                    placeholder={t(
                                        'dialog.avatar.generated.select_style'
                                    )}
                                />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value={noneValue}>
                                        {t('dialog.avatar.generated.none')}
                                    </SelectItem>
                                    {styles.map((style) => (
                                        <SelectItem
                                            key={style.id || style.styleName}
                                            value={style.styleName}
                                        >
                                            {style.styleName}
                                        </SelectItem>
                                    ))}
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
                            disabled={loading}
                            onValueChange={(value) =>
                                setSecondaryStyle(
                                    value === noneValue ? '' : value
                                )
                            }
                        >
                            <SelectTrigger>
                                <SelectValue
                                    placeholder={t(
                                        'dialog.avatar.generated.select_style'
                                    )}
                                />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value={noneValue}>
                                        {t('dialog.avatar.generated.none')}
                                    </SelectItem>
                                    {styles.map((style) => (
                                        <SelectItem
                                            key={style.id || style.styleName}
                                            value={style.styleName}
                                        >
                                            {style.styleName}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="avatar-owner-author-tags">
                            {t('dialog.world.info.author_tags')}
                        </FieldLabel>
                        <Textarea
                            id="avatar-owner-author-tags"
                            rows={2}
                            className="resize-none"
                            value={authorTags}
                            onChange={(event) =>
                                setAuthorTags(event.target.value)
                            }
                        />
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
                        disabled={saving || loading}
                        onClick={() => void save()}
                    >
                        {t('common.actions.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
