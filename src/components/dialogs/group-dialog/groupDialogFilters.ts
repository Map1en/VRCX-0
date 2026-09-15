import type { TFunction } from 'i18next';

import type { EntityRecord } from '@/domain/entities/shared';

import type { EntityDialogTab } from '../EntityDialogScaffold';

export function getGroupDialogTabs(t: TFunction): EntityDialogTab[] {
    return [
        { value: 'overview', label: t('dialog.group.overview.header') },
        { value: 'events', label: t('dialog.group.events.header') },
        { value: 'posts', label: t('dialog.group.posts.header') },
        { value: 'members', label: t('dialog.group.members.header') },
        { value: 'photos', label: t('dialog.group.gallery.header') },
        {
            value: 'instance-history',
            label: t('dialog.previous_instances.header')
        },
        { value: 'json', label: t('dialog.group.json.header') }
    ];
}

export function filterGroupPosts(posts: EntityRecord[], queryValue: string) {
    const query = queryValue.trim().toLowerCase();
    if (!query) {
        return posts;
    }
    return posts.filter((post) =>
        [post.title, post.text, post.authorId].some((value) =>
            String(value || '')
                .toLowerCase()
                .includes(query)
        )
    );
}
