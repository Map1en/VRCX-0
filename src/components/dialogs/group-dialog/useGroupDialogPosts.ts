import type { TFunction } from 'i18next';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';

import type {
    EntityRecord,
    GroupProfileRecord
} from '@/domain/entities/profileEntities';
import groupProfileRepository from '@/repositories/groupProfileRepository';

import type { GroupRemoteData, GroupRemoteStatus } from './groupDialogTypes';

export type GroupPostForm = {
    mode: 'create' | 'edit';
    post: EntityRecord | null;
    title: string;
    text: string;
    sendNotification: boolean;
    visibility: string;
    roleIds: string[];
    imageId: string;
};

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

interface UseGroupDialogPostsInput {
    confirm: (options: {
        title: string;
        description: string;
        confirmText: string;
        cancelText: string;
        destructive: boolean;
    }) => Promise<{ ok: boolean }>;
    currentEndpoint: string;
    group: GroupProfileRecord;
    loadTab: (tab: string, options?: { force?: boolean }) => Promise<void>;
    onPostsSaved: () => void;
    setRemoteData: Dispatch<SetStateAction<GroupRemoteData>>;
    setRemoteStatus: Dispatch<SetStateAction<GroupRemoteStatus>>;
    t: TFunction;
}

export function useGroupDialogPosts({
    confirm,
    currentEndpoint,
    group,
    loadTab,
    onPostsSaved,
    setRemoteData,
    setRemoteStatus,
    t
}: UseGroupDialogPostsInput) {
    const [postEditor, setPostEditor] = useState<GroupPostForm | null>(null);
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

    async function submitGroupPost(form: GroupPostForm) {
        if (!form || postEditorSubmitting) {
            return;
        }
        const title = String(form.title || '').trim();
        const text = String(form.text || '').trim();
        if (!title || !text) {
            toast.warning(t('dialog.group.error.title_and_text_are_required'));
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
                    ? t('dialog.group.toast.group_post_updated')
                    : t('dialog.group.toast.group_post_created')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.group.toast.failed_to_save_group_post')
            );
        } finally {
            setPostEditorSubmitting(false);
        }
    }

    function editGroupPost(post: EntityRecord) {
        setPostEditor({
            mode: 'edit',
            post,
            title: text(post.title),
            text: text(post.text),
            sendNotification: Boolean(post?.sendNotification),
            visibility: text(post.visibility) || 'group',
            roleIds: Array.isArray(post.roleIds)
                ? post.roleIds.filter(
                      (roleId): roleId is string => typeof roleId === 'string'
                  )
                : [],
            imageId: text(post.imageId)
        });
    }

    async function deleteGroupPost(post: EntityRecord) {
        const result = await confirm({
            title: t('dialog.group.modal.delete_group_post'),
            description: text(post.title) || group.name || 'Group',
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
            toast.success(t('dialog.group.success.group_post_deleted'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.group.toast.failed_to_delete_group_post')
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
