import { useEffect, useState } from 'react';
import { Trash2Icon } from 'lucide-react';

import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Textarea } from '@/ui/shadcn/textarea';

const CONTENT_TAGS = [
    ['contentHorror', 'content_horror', 'Horror'],
    ['contentGore', 'content_gore', 'Gore'],
    ['contentViolence', 'content_violence', 'Violence'],
    ['contentAdult', 'content_adult', 'Adult'],
    ['contentSex', 'content_sex', 'Sex']
];

const FEATURE_TAGS = [
    ['emoji', 'feature_emoji_disabled', 'Emoji'],
    ['stickers', 'feature_stickers_disabled', 'Stickers'],
    ['pedestals', 'feature_pedestals_disabled', 'Pedestals'],
    ['prints', 'feature_prints_disabled', 'Prints'],
    ['drones', 'feature_drones_disabled', 'Drones'],
    ['props', 'feature_props_disabled', 'Items'],
    ['thirdPerson', 'feature_third_person_view_disabled', 'Third Person']
];

const EXPLICIT_TAGS = new Set([
    'debug_allowed',
    'feature_avatar_scaling_disabled',
    'feature_focus_view_disabled',
    ...CONTENT_TAGS.map(([, tag]) => tag),
    ...FEATURE_TAGS.map(([, tag]) => tag)
]);

function isManagedWorldTag(tag) {
    return tag.startsWith('author_tag_') || tag.startsWith('content_') || EXPLICIT_TAGS.has(tag);
}

function pushUnique(tags, tag) {
    if (tag && !tags.includes(tag)) {
        tags.push(tag);
    }
}

function createWorldTagsDraft(tags = []) {
    const values = Array.isArray(tags) ? tags.map(String) : [];
    const draft = {
        authorTags: '',
        contentTags: '',
        debugAllowed: values.includes('debug_allowed'),
        avatarScalingDisabled: values.includes('feature_avatar_scaling_disabled'),
        focusViewDisabled: values.includes('feature_focus_view_disabled'),
        contentHorror: values.includes('content_horror'),
        contentGore: values.includes('content_gore'),
        contentViolence: values.includes('content_violence'),
        contentAdult: values.includes('content_adult'),
        contentSex: values.includes('content_sex'),
        emoji: !values.includes('feature_emoji_disabled'),
        stickers: !values.includes('feature_stickers_disabled'),
        pedestals: !values.includes('feature_pedestals_disabled'),
        prints: !values.includes('feature_prints_disabled'),
        drones: !values.includes('feature_drones_disabled'),
        props: !values.includes('feature_props_disabled'),
        thirdPerson: !values.includes('feature_third_person_view_disabled')
    };
    draft.authorTags = values
        .filter((tag) => tag.startsWith('author_tag_'))
        .map((tag) => tag.slice('author_tag_'.length))
        .join(',');
    draft.contentTags = values
        .filter((tag) => tag.startsWith('content_') && !CONTENT_TAGS.some(([, fixedTag]) => fixedTag === tag))
        .map((tag) => tag.slice('content_'.length))
        .join(',');
    return draft;
}

function buildWorldTags(draft, baseTags = []) {
    const tags = Array.isArray(baseTags)
        ? baseTags.map(String).filter((tag) => tag && !isManagedWorldTag(tag))
        : [];
    for (const tag of String(draft.authorTags || '').split(',').map((value) => value.trim()).filter(Boolean)) {
        pushUnique(tags, `author_tag_${tag}`);
    }
    for (const tag of String(draft.contentTags || '').split(',').map((value) => value.trim()).filter(Boolean)) {
        if (!['horror', 'gore', 'violence', 'adult', 'sex'].includes(tag)) {
            pushUnique(tags, `content_${tag}`);
        }
    }
    for (const [key, tag] of CONTENT_TAGS) {
        if (draft[key]) {
            pushUnique(tags, tag);
        }
    }
    if (draft.debugAllowed) {
        pushUnique(tags, 'debug_allowed');
    }
    if (draft.avatarScalingDisabled) {
        pushUnique(tags, 'feature_avatar_scaling_disabled');
    }
    if (draft.focusViewDisabled) {
        pushUnique(tags, 'feature_focus_view_disabled');
    }
    for (const [key, tag] of FEATURE_TAGS) {
        if (!draft[key]) {
            pushUnique(tags, tag);
        }
    }
    return tags;
}

function WorldTagsDialog({ open, onOpenChange, world, saving = false, onSave }) {
    const [draft, setDraft] = useState(() => createWorldTagsDraft(world?.tags));

    useEffect(() => {
        if (open) {
            setDraft(createWorldTagsDraft(world?.tags));
        }
    }, [open, world?.id, world?.tags]);

    function updateDraft(patch) {
        setDraft((current) => ({ ...current, ...patch }));
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>World Tags</DialogTitle>
                </DialogHeader>
                <FieldGroup className="gap-3">
                    <Field orientation="horizontal">
                        <Checkbox id="world-tag-avatar-scaling-disabled" checked={draft.avatarScalingDisabled} disabled={saving} onCheckedChange={(checked) => updateDraft({ avatarScalingDisabled: checked === true })} />
                        <FieldLabel htmlFor="world-tag-avatar-scaling-disabled">Avatar scaling disabled</FieldLabel>
                    </Field>
                    <Field orientation="horizontal">
                        <Checkbox id="world-tag-focus-view-disabled" checked={draft.focusViewDisabled} disabled={saving} onCheckedChange={(checked) => updateDraft({ focusViewDisabled: checked === true })} />
                        <FieldLabel htmlFor="world-tag-focus-view-disabled">Focus view disabled</FieldLabel>
                    </Field>
                    <Field orientation="horizontal">
                        <Checkbox id="world-tag-debug-allowed" checked={draft.debugAllowed} disabled={saving} onCheckedChange={(checked) => updateDraft({ debugAllowed: checked === true })} />
                        <FieldLabel htmlFor="world-tag-debug-allowed">Enable debugging</FieldLabel>
                    </Field>
                    <Field>
                        <FieldLabel>Author tags</FieldLabel>
                        <Textarea rows={2} value={draft.authorTags} disabled={saving} className="resize-none" onChange={(event) => updateDraft({ authorTags: event.target.value })} />
                    </Field>
                    <Field>
                        <FieldLabel>Content tags</FieldLabel>
                        <div className="grid grid-cols-2 gap-2">
                            {CONTENT_TAGS.map(([key, , label]) => (
                                <Field key={key} orientation="horizontal">
                                    <Checkbox id={`world-content-tag-${key}`} checked={draft[key]} disabled={saving} onCheckedChange={(checked) => updateDraft({ [key]: checked === true })} />
                                    <FieldLabel htmlFor={`world-content-tag-${key}`}>{label}</FieldLabel>
                                </Field>
                            ))}
                        </div>
                        <Textarea rows={2} value={draft.contentTags} disabled={saving} className="resize-none" onChange={(event) => updateDraft({ contentTags: event.target.value })} />
                    </Field>
                    <Field>
                        <FieldLabel>Default content settings</FieldLabel>
                        <div className="grid grid-cols-2 gap-2">
                            {FEATURE_TAGS.map(([key, , label]) => (
                                <Field key={key} orientation="horizontal">
                                    <Checkbox id={`world-feature-tag-${key}`} checked={draft[key]} disabled={saving} onCheckedChange={(checked) => updateDraft({ [key]: checked === true })} />
                                    <FieldLabel htmlFor={`world-feature-tag-${key}`}>{label}</FieldLabel>
                                </Field>
                            ))}
                        </div>
                    </Field>
                </FieldGroup>
                <DialogFooter>
                    <Button type="button" variant="secondary" disabled={saving} onClick={() => onOpenChange?.(false)}>Cancel</Button>
                    <Button type="button" disabled={saving} onClick={() => onSave?.(buildWorldTags(draft, world?.tags))}>Save</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function WorldAllowedDomainsDialog({ open, onOpenChange, world, saving = false, onSave }) {
    const [urlList, setUrlList] = useState([]);

    useEffect(() => {
        if (open) {
            setUrlList(Array.isArray(world?.urlList) ? world.urlList : []);
        }
    }, [open, world?.id, world?.urlList]);

    function updateDomain(index, value) {
        setUrlList((current) => current.map((domain, currentIndex) => currentIndex === index ? value : domain));
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Allowed Video Player Domains</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-2">
                    {urlList.map((domain, index) => (
                        <div key={index} className="flex items-center gap-2">
                            <Input value={domain} disabled={saving} onChange={(event) => updateDomain(index, event.target.value)} />
                            <Button type="button" variant="ghost" size="icon-sm" disabled={saving} onClick={() => setUrlList((current) => current.filter((_, currentIndex) => currentIndex !== index))}>
                                <Trash2Icon data-icon="inline-start" />
                            </Button>
                        </div>
                    ))}
                    <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => setUrlList((current) => [...current, ''])}>
                        Add domain
                    </Button>
                </div>
                <DialogFooter>
                    <Button type="button" disabled={saving} onClick={() => onSave?.(urlList.map((value) => value.trim()).filter(Boolean))}>
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export { WorldAllowedDomainsDialog, WorldTagsDialog };
