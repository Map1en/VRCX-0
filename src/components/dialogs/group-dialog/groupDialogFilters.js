export function getGroupDialogTabs(t) {
    return [
        { value: 'info', label: t('dialog.group.info.header') },
        {
            value: 'instance-history',
            label: t('dialog.previous_instances.header')
        },
        { value: 'posts', label: t('dialog.group.posts.header') },
        { value: 'members', label: t('dialog.group.members.header') },
        { value: 'photos', label: t('dialog.group.gallery.header') },
        { value: 'json', label: t('dialog.group.json.header') }
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
