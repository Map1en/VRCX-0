export function getGroupDialogTabs(t) {
    return [
        { value: 'info', label: t('dialog.group.moderation_tabs.info') },
        {
            value: 'instance-history',
            label: t('dialog.group.moderation_tabs.instance_history')
        },
        { value: 'posts', label: t('dialog.group.moderation_tabs.posts') },
        { value: 'members', label: t('dialog.group.moderation_tabs.members') },
        { value: 'photos', label: t('dialog.group.moderation_tabs.photos') },
        { value: 'json', label: t('dialog.group.moderation_tabs.json') }
    ];
}

export function filterGroupPosts(posts, queryValue) {
    const query = queryValue.trim().toLowerCase();
    if (!query) {
        return posts;
    }
    return posts.filter((post) =>
        [post?.title, post?.text, post?.authorId].some((value) =>
            String(value || '')
                .toLowerCase()
                .includes(query)
        )
    );
}

export function filterGroupMembers(members, queryValue) {
    const query = queryValue.trim().toLowerCase();
    if (!query) {
        return members;
    }
    return members.filter((member) =>
        [
            member?.user?.displayName,
            member?.displayName,
            member?.userId,
            member?.user?.id
        ].some((value) =>
            String(value || '')
                .toLowerCase()
                .includes(query)
        )
    );
}
