import { Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { WorldProfileRecord } from '@/domain/entities/world';
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
import { Input } from '@/ui/shadcn/input';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { Textarea } from '@/ui/shadcn/textarea';

import { CONTENT_TAG_OPTIONS, contentTagsCsv } from './contentTags';

const FEATURE_TAGS = [
    ['emoji', 'feature_emoji_disabled', 'dialog.gallery_icons.emoji'],
    ['stickers', 'feature_stickers_disabled', 'dialog.gallery_icons.stickers'],
    ['pedestals', 'feature_pedestals_disabled', 'dialog.world.tags.pedestals'],
    ['prints', 'feature_prints_disabled', 'dialog.gallery_icons.prints'],
    ['drones', 'feature_drones_disabled', 'dialog.inventory.drones'],
    ['props', 'feature_props_disabled', 'dialog.inventory.items']
] as const;

const THIRD_PERSON_DISABLED_TAG = 'feature_third_person_view_disabled';

type FeatureTagKey = (typeof FEATURE_TAGS)[number][0];

export interface WorldDetailsDraft {
    name: string;
    description: string;
    capacity: string | number;
    recommendedCapacity: string | number;
    previewYoutubeId: string;
}

export type WorldTagsDraft = Record<FeatureTagKey, boolean> & {
    authorTags: string;
    contentTags: string;
    debugAllowed: boolean;
    avatarScalingEnabled: boolean;
    focusViewEnabled: boolean;
    thirdPersonEnabled: boolean;
};

interface WorldEditorDialogProps<T> {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    world: WorldProfileRecord | null;
    saving?: boolean;
    onSave: (value: T) => void;
}

const EXPLICIT_TAGS = new Set([
    'debug_allowed',
    'feature_avatar_scaling_disabled',
    'feature_focus_view_disabled',
    THIRD_PERSON_DISABLED_TAG,
    ...CONTENT_TAG_OPTIONS.map(({ value }) => value),
    ...FEATURE_TAGS.map(([, tag]) => tag)
]);

function isManagedWorldTag(tag: string) {
    return (
        tag.startsWith('author_tag_') ||
        tag.startsWith('content_') ||
        EXPLICIT_TAGS.has(tag)
    );
}

function pushUnique(tags: string[], tag: string) {
    if (tag && !tags.includes(tag)) {
        tags.push(tag);
    }
}

function worldContentTagsFromCsv(
    value: unknown,
    baseTags: readonly string[] = []
): string[] {
    const originalTags = Array.isArray(baseTags) ? baseTags.map(String) : [];
    return Array.from(
        new Set(
            String(value || '')
                .split(',')
                .map((entry) => {
                    const rawTag = entry.trim();
                    if (!rawTag) {
                        return '';
                    }
                    const originalTag = originalTags.find(
                        (tag) =>
                            tag.startsWith('content_') &&
                            tag.slice('content_'.length) === rawTag
                    );
                    if (originalTag) {
                        return originalTag;
                    }
                    const tagName = rawTag.replace(/^content_/, '');
                    return tagName ? `content_${tagName}` : '';
                })
                .filter(Boolean)
        )
    );
}

function createWorldTagsDraft(tags: readonly string[] = []): WorldTagsDraft {
    const values = Array.isArray(tags) ? tags.map(String) : [];
    const draft: WorldTagsDraft = {
        authorTags: '',
        contentTags: '',
        debugAllowed: values.includes('debug_allowed'),
        avatarScalingEnabled: !values.includes(
            'feature_avatar_scaling_disabled'
        ),
        focusViewEnabled: !values.includes('feature_focus_view_disabled'),
        thirdPersonEnabled: !values.includes(THIRD_PERSON_DISABLED_TAG),
        emoji: !values.includes('feature_emoji_disabled'),
        stickers: !values.includes('feature_stickers_disabled'),
        pedestals: !values.includes('feature_pedestals_disabled'),
        prints: !values.includes('feature_prints_disabled'),
        drones: !values.includes('feature_drones_disabled'),
        props: !values.includes('feature_props_disabled')
    };
    draft.authorTags = values
        .filter((tag) => tag.startsWith('author_tag_'))
        .map((tag) => tag.slice('author_tag_'.length))
        .join(',');
    draft.contentTags = contentTagsCsv(values);
    return draft;
}

function buildWorldTags(
    draft: WorldTagsDraft,
    baseTags: readonly string[] = []
) {
    const tags = Array.isArray(baseTags)
        ? baseTags.map(String).filter((tag) => tag && !isManagedWorldTag(tag))
        : [];
    for (const tag of String(draft.authorTags || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)) {
        pushUnique(tags, `author_tag_${tag}`);
    }
    for (const tag of worldContentTagsFromCsv(draft.contentTags, baseTags)) {
        pushUnique(tags, tag);
    }
    if (draft.debugAllowed) {
        pushUnique(tags, 'debug_allowed');
    }
    if (!draft.avatarScalingEnabled) {
        pushUnique(tags, 'feature_avatar_scaling_disabled');
    }
    if (!draft.focusViewEnabled) {
        pushUnique(tags, 'feature_focus_view_disabled');
    }
    if (!draft.thirdPersonEnabled) {
        pushUnique(tags, THIRD_PERSON_DISABLED_TAG);
    }
    for (const [key, tag] of FEATURE_TAGS) {
        if (!draft[key]) {
            pushUnique(tags, tag);
        }
    }
    return tags;
}

function createWorldDetailsDraft(
    world: WorldProfileRecord | null
): WorldDetailsDraft {
    return {
        name: world?.name || '',
        description: world?.description || '',
        capacity: world?.capacity || '',
        recommendedCapacity: world?.recommendedCapacity || '',
        previewYoutubeId: world?.previewYoutubeId || ''
    };
}

function WorldDetailsDialog({
    open,
    onOpenChange,
    world,
    saving = false,
    onSave
}: WorldEditorDialogProps<WorldDetailsDraft>) {
    const { t } = useTranslation();

    const [draft, setDraft] = useState(() => createWorldDetailsDraft(world));

    useEffect(() => {
        if (open) {
            setDraft(createWorldDetailsDraft(world));
        }
    }, [open, world]);

    function updateDraft(patch: Partial<WorldDetailsDraft>) {
        setDraft((current) => ({ ...current, ...patch }));
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="grid max-h-[calc(100vh-4rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.world.description.edit_world_details')}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'dialog.world.action.update_world_name_description_capacity_and_preview'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="-mx-1 min-h-0 px-1">
                    <FieldGroup className="gap-4 pb-3">
                        <Field>
                            <FieldLabel htmlFor="world-details-name">
                                {t('dialog.world.info.name')}
                            </FieldLabel>
                            <Input
                                id="world-details-name"
                                value={draft.name}
                                disabled={saving}
                                onChange={(event) =>
                                    updateDraft({ name: event.target.value })
                                }
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="world-details-description">
                                {t('dialog.world.info.description')}
                            </FieldLabel>
                            <Textarea
                                id="world-details-description"
                                rows={5}
                                value={draft.description}
                                disabled={saving}
                                className="field-sizing-fixed max-h-56 min-h-32 resize-y overflow-y-auto"
                                onChange={(event) =>
                                    updateDraft({
                                        description: event.target.value
                                    })
                                }
                            />
                        </Field>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field>
                                <FieldLabel htmlFor="world-details-capacity">
                                    {t('dialog.world.info.capacity')}
                                </FieldLabel>
                                <Input
                                    id="world-details-capacity"
                                    type="number"
                                    min="1"
                                    inputMode="numeric"
                                    value={draft.capacity}
                                    disabled={saving}
                                    onChange={(event) =>
                                        updateDraft({
                                            capacity: event.target.value
                                        })
                                    }
                                />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="world-details-recommended-capacity">
                                    {t(
                                        'dialog.world.label.recommended_capacity'
                                    )}
                                </FieldLabel>
                                <Input
                                    id="world-details-recommended-capacity"
                                    type="number"
                                    min="1"
                                    inputMode="numeric"
                                    value={draft.recommendedCapacity}
                                    disabled={saving}
                                    onChange={(event) =>
                                        updateDraft({
                                            recommendedCapacity:
                                                event.target.value
                                        })
                                    }
                                />
                            </Field>
                        </div>
                        <Field>
                            <FieldLabel htmlFor="world-details-preview">
                                {t('dialog.world.label.youtube_preview')}
                            </FieldLabel>
                            <Input
                                id="world-details-preview"
                                value={draft.previewYoutubeId}
                                disabled={saving}
                                onChange={(event) =>
                                    updateDraft({
                                        previewYoutubeId: event.target.value
                                    })
                                }
                            />
                        </Field>
                    </FieldGroup>
                </ScrollArea>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={() => onOpenChange?.(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={saving}
                        onClick={() => onSave?.(draft)}
                    >
                        {t('common.actions.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function WorldTagsDialog({
    open,
    onOpenChange,
    world,
    saving = false,
    onSave
}: WorldEditorDialogProps<string[]>) {
    const { t } = useTranslation();

    const [draft, setDraft] = useState(() => createWorldTagsDraft(world?.tags));

    useEffect(() => {
        if (open) {
            setDraft(createWorldTagsDraft(world?.tags));
        }
    }, [open, world?.id, world?.tags]);

    function updateDraft(patch: Partial<WorldTagsDraft>) {
        setDraft((current) => ({ ...current, ...patch }));
    }

    const selectedContentTags = worldContentTagsFromCsv(
        draft.contentTags,
        world?.tags
    );
    const selectedContentTagsSet = new Set(selectedContentTags);

    function toggleContentTag(tag: string) {
        const nextTags = new Set(selectedContentTags);
        if (nextTags.has(tag)) {
            nextTags.delete(tag);
        } else {
            nextTags.add(tag);
        }
        updateDraft({ contentTags: contentTagsCsv(Array.from(nextTags)) });
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.world.label.world_tags')}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'dialog.world.action.edit_managed_content_author_and_feature_tags_for_this_world'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup className="gap-3">
                    <Field orientation="horizontal">
                        <Checkbox
                            id="world-tag-avatar-scaling-enabled"
                            checked={draft.avatarScalingEnabled}
                            disabled={saving}
                            onCheckedChange={(checked) =>
                                updateDraft({
                                    avatarScalingEnabled: checked === true
                                })
                            }
                        />
                        <FieldLabel htmlFor="world-tag-avatar-scaling-enabled">
                            {t('dialog.world.action.enable_avatar_scaling')}
                        </FieldLabel>
                    </Field>
                    <Field orientation="horizontal">
                        <Checkbox
                            id="world-tag-focus-view-enabled"
                            checked={draft.focusViewEnabled}
                            disabled={saving}
                            onCheckedChange={(checked) =>
                                updateDraft({
                                    focusViewEnabled: checked === true
                                })
                            }
                        />
                        <FieldLabel htmlFor="world-tag-focus-view-enabled">
                            {t('dialog.world.action.enable_focus_view')}
                        </FieldLabel>
                    </Field>
                    <Field orientation="horizontal">
                        <Checkbox
                            id="world-tag-third-person-enabled"
                            checked={draft.thirdPersonEnabled}
                            disabled={saving}
                            onCheckedChange={(checked) =>
                                updateDraft({
                                    thirdPersonEnabled: checked === true
                                })
                            }
                        />
                        <FieldLabel htmlFor="world-tag-third-person-enabled">
                            {t('dialog.world.action.enable_third_person_view')}
                        </FieldLabel>
                    </Field>
                    <Field orientation="horizontal">
                        <Checkbox
                            id="world-tag-debug-allowed"
                            checked={draft.debugAllowed}
                            disabled={saving}
                            onCheckedChange={(checked) =>
                                updateDraft({ debugAllowed: checked === true })
                            }
                        />
                        <FieldLabel htmlFor="world-tag-debug-allowed">
                            {t('dialog.world.action.enable_debugging')}
                        </FieldLabel>
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="world-owner-author-tags">
                            {t('dialog.world.label.author_tags')}
                        </FieldLabel>
                        <Textarea
                            id="world-owner-author-tags"
                            rows={2}
                            value={draft.authorTags}
                            disabled={saving}
                            className="resize-none"
                            onChange={(event) =>
                                updateDraft({ authorTags: event.target.value })
                            }
                        />
                    </Field>
                    <FieldSet>
                        <FieldLegend variant="label">
                            {t('dialog.world.label.content_tags')}
                        </FieldLegend>
                        <FieldGroup
                            data-slot="checkbox-group"
                            className="grid grid-cols-2 gap-2"
                        >
                            {CONTENT_TAG_OPTIONS.map((option) => (
                                <Field
                                    key={option.value}
                                    orientation="horizontal"
                                >
                                    <Checkbox
                                        id={`world-content-tag-${option.value}`}
                                        checked={selectedContentTagsSet.has(
                                            option.value
                                        )}
                                        disabled={saving}
                                        onCheckedChange={() =>
                                            toggleContentTag(option.value)
                                        }
                                    />
                                    <FieldLabel
                                        htmlFor={`world-content-tag-${option.value}`}
                                    >
                                        {t(option.labelKey)}
                                    </FieldLabel>
                                </Field>
                            ))}
                        </FieldGroup>
                        <Field>
                            <FieldLabel
                                htmlFor="world-owner-content-tags"
                                className="sr-only"
                            >
                                {t('dialog.world.label.raw_content_tags')}
                            </FieldLabel>
                            <Textarea
                                id="world-owner-content-tags"
                                rows={2}
                                value={draft.contentTags}
                                disabled={saving}
                                className="resize-none"
                                placeholder="horror,gore,violence,adult,sex"
                                onChange={(event) =>
                                    updateDraft({
                                        contentTags: event.target.value
                                    })
                                }
                            />
                        </Field>
                    </FieldSet>
                    <FieldSet>
                        <FieldLegend variant="label">
                            {t('dialog.world.label.default_content_settings')}
                        </FieldLegend>
                        <FieldGroup
                            data-slot="checkbox-group"
                            className="grid grid-cols-2 gap-2"
                        >
                            {FEATURE_TAGS.map(([key, , labelKey]) => (
                                <Field key={key} orientation="horizontal">
                                    <Checkbox
                                        id={`world-feature-tag-${key}`}
                                        checked={draft[key]}
                                        disabled={saving}
                                        onCheckedChange={(checked) =>
                                            updateDraft({
                                                [key]: checked === true
                                            })
                                        }
                                    />
                                    <FieldLabel
                                        htmlFor={`world-feature-tag-${key}`}
                                    >
                                        {t(labelKey)}
                                    </FieldLabel>
                                </Field>
                            ))}
                        </FieldGroup>
                    </FieldSet>
                </FieldGroup>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={saving}
                        onClick={() => onOpenChange?.(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={saving}
                        onClick={() =>
                            onSave?.(buildWorldTags(draft, world?.tags))
                        }
                    >
                        {t('common.actions.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function WorldAllowedDomainsDialog({
    open,
    onOpenChange,
    world,
    saving = false,
    onSave
}: WorldEditorDialogProps<string[]>) {
    const { t } = useTranslation();

    const [urlList, setUrlList] = useState<string[]>([]);

    useEffect(() => {
        if (open) {
            setUrlList(Array.isArray(world?.urlList) ? world.urlList : []);
        }
    }, [open, world?.id, world?.urlList]);

    function updateDomain(index: number, value: string) {
        setUrlList((current) =>
            current.map((domain, currentIndex) =>
                currentIndex === index ? value : domain
            )
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.allowed_video_player_domains.header')}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'dialog.world.label.manage_domains_allowed_for_this_world_s_video_player'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup className="gap-2">
                    {urlList.map((domain, index) => (
                        <Field key={index}>
                            <FieldLabel
                                htmlFor={`world-allowed-domain-${index}`}
                                className="sr-only"
                            >
                                {t('dialog.world.label.allowed_domain')}{' '}
                                {index + 1}
                            </FieldLabel>
                            <InputGroup>
                                <InputGroupInput
                                    id={`world-allowed-domain-${index}`}
                                    value={domain}
                                    disabled={saving}
                                    onChange={(event) =>
                                        updateDomain(index, event.target.value)
                                    }
                                />
                                <InputGroupAddon align="inline-end">
                                    <InputGroupButton
                                        type="button"
                                        size="icon-xs"
                                        disabled={saving}
                                        aria-label={t(
                                            'accessibility.remove_domain',
                                            { number: index + 1 }
                                        )}
                                        onClick={() =>
                                            setUrlList((current) =>
                                                current.filter(
                                                    (_, currentIndex) =>
                                                        currentIndex !== index
                                                )
                                            )
                                        }
                                    >
                                        <Trash2Icon data-icon="inline-start" />
                                    </InputGroupButton>
                                </InputGroupAddon>
                            </InputGroup>
                        </Field>
                    ))}
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={saving}
                        onClick={() =>
                            setUrlList((current) => [...current, ''])
                        }
                    >
                        {t('dialog.world.action.add_domain')}
                    </Button>
                </FieldGroup>
                <DialogFooter>
                    <Button
                        type="button"
                        disabled={saving}
                        onClick={() =>
                            onSave?.(
                                urlList
                                    .map((value) => value.trim())
                                    .filter(Boolean)
                            )
                        }
                    >
                        {t('common.actions.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export { WorldAllowedDomainsDialog, WorldDetailsDialog, WorldTagsDialog };
