import { useState } from 'react';
import { toast } from 'sonner';

import { groupProfileRepository } from '@/repositories/index.js';

export function useGroupDialogPosts({
    confirm,
    currentEndpoint,
    group,
    loadTab,
    onPostsSaved,
    setRemoteData,
    setRemoteStatus,
    t
}) {
    const [postEditor, setPostEditor] = useState(null);
    const [postEditorSubmitting, setPostEditorSubmitting] = useState(false);

    function createGroupPost() {
        setPostEditor({
            mode: 'create',
            post: null,
            title: '',
            text: '',
            sendNotification: true,
            visibility: 'group',
            roleIds: [],
            imageId: ''
        });
    }

    async function submitGroupPost(form) {
        if (!form || postEditorSubmitting) {
            return;
        }
        const title = String(form.title || '').trim();
        const text = String(form.text || '').trim();
        if (!title || !text) {
            toast.warning(
                t('dialog.group.generated.title_and_text_are_required')
            );
            return;
        }

        setPostEditorSubmitting(true);
        try {
            const roleIds =
                form.visibility === 'group' && Array.isArray(form.roleIds)
                    ? form.roleIds
                    : [];
            if (form.mode === 'edit') {
                await groupProfileRepository.editGroupPost({
                    groupId: group.id,
                    postId: form.post?.id,
                    endpoint: currentEndpoint,
                    params: {
                        title,
                        text,
                        visibility: form.visibility || 'group',
                        roleIds,
                        sendNotification: Boolean(form.sendNotification),
                        imageId: form.imageId || null
                    }
                });
            } else {
                await groupProfileRepository.createGroupPost({
                    groupId: group.id,
                    endpoint: currentEndpoint,
                    params: {
                        title,
                        text,
                        sendNotification: Boolean(form.sendNotification),
                        visibility: form.visibility || 'group',
                        roleIds,
                        imageId: form.imageId || null
                    }
                });
            }
            setRemoteStatus((current) => ({ ...current, posts: '' }));
            await loadTab('posts', { force: true });
            onPostsSaved?.();
            setPostEditor(null);
            toast.success(
                form.mode === 'edit'
                    ? t('dialog.group.generated_toast.group_post_updated')
                    : t('dialog.group.generated_toast.group_post_created')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.group.generated_toast.failed_to_save_group_post'
                      )
            );
        } finally {
            setPostEditorSubmitting(false);
        }
    }

    function editGroupPost(post) {
        setPostEditor({
            mode: 'edit',
            post,
            title: post?.title || '',
            text: post?.text || '',
            sendNotification: Boolean(post?.sendNotification),
            visibility: post?.visibility || 'group',
            roleIds: Array.isArray(post?.roleIds) ? post.roleIds : [],
            imageId: post?.imageId || ''
        });
    }

    async function deleteGroupPost(post) {
        const result = await confirm({
            title: t('dialog.group.generated_modal.delete_group_post'),
            description: post?.title || group.name || 'Group',
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        try {
            await groupProfileRepository.deleteGroupPost({
                groupId: group.id,
                postId: post.id,
                endpoint: currentEndpoint
            });
            setRemoteData((current) => ({
                ...current,
                posts: current.posts.filter((row) => row.id !== post.id)
            }));
            toast.success(t('dialog.group.generated.group_post_deleted'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.group.generated_toast.failed_to_delete_group_post'
                      )
            );
        }
    }

    return {
        createGroupPost,
        deleteGroupPost,
        editGroupPost,
        postEditor,
        postEditorSubmitting,
        setPostEditor,
        submitGroupPost
    };
}
