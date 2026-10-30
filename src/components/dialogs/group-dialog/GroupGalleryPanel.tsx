import {
    ImageIcon,
    ImagePlusIcon,
    PencilIcon,
    PlusIcon,
    Trash2Icon
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
import type {
    GroupGalleryPhotoRow,
    GroupProfileRecord
} from '@/domain/entities/group';
import { Badge } from '@/ui/shadcn/badge';
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
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { Textarea } from '@/ui/shadcn/textarea';

import {
    getGroupRowImage,
    getGroupRowLabel,
    getGroupRowRawImage
} from './groupDialogUtils';
import {
    canDeleteGalleryImage,
    canManageGallery,
    canSubmitToGallery,
    groupGalleryAccess,
    groupGalleryVisibility
} from './groupGalleries';
import { GroupGalleryImageField } from './GroupGalleryImageField';
import { GroupListState } from './GroupListState';
import { useGroupGalleryEditor } from './useGroupGalleryEditor';

export function GroupGalleryPanel({
    group,
    rows,
    loading,
    error,
    currentUserId,
    onPreviewImage,
    onGalleriesChanged,
    onImagesChanged
}: {
    group: GroupProfileRecord;
    rows: GroupGalleryPhotoRow[];
    loading: boolean;
    error: string;
    currentUserId: string | null;
    onPreviewImage: (url: string, title: string) => void;
    onGalleriesChanged: () => void;
    onImagesChanged: () => void;
}) {
    const { t } = useTranslation();
    const editor = useGroupGalleryEditor({
        groupId: group.id,
        onGalleriesChanged,
        onImagesChanged
    });
    const access = groupGalleryAccess(group, currentUserId);
    const galleries = (group.galleries ?? []).filter((gallery) => gallery.id);
    const [selectedGallery, setSelectedGallery] = useState('');
    const activeGallery = galleries.some(
        (gallery) => gallery.id === selectedGallery
    )
        ? selectedGallery
        : (galleries[0]?.id ?? '');

    const createButton = access.manageAll ? (
        <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto flex-none"
            disabled={editor.saving}
            onClick={editor.openCreate}
        >
            <PlusIcon />
            {t('dialog.group.gallery.create')}
        </Button>
    ) : null;

    let content;
    if (loading) {
        content = (
            <GroupListState title={t('dialog.group.gallery.header')} loading />
        );
    } else if (error) {
        content = (
            <GroupListState
                title={t('dialog.group.gallery.header')}
                error={error}
            />
        );
    } else if (!galleries.length) {
        content = (
            <>
                {createButton ? (
                    <div className="flex">{createButton}</div>
                ) : null}
                <GroupListState title={t('dialog.group.gallery.header')} />
            </>
        );
    } else {
        content = (
            <Tabs
                value={activeGallery}
                onValueChange={setSelectedGallery}
                className="gap-2"
            >
                <div className="flex items-center gap-2">
                    <TabsList className="max-w-full justify-start overflow-x-auto">
                        {galleries.map((gallery) => (
                            <TabsTrigger
                                key={gallery.id}
                                value={gallery.id}
                                className="flex-none px-3"
                            >
                                <span className="font-bold">
                                    {gallery.name || gallery.id}
                                </span>
                                <span className="text-muted-foreground ml-1.5 text-xs">
                                    {
                                        rows.filter(
                                            (row) =>
                                                row.$galleryId === gallery.id
                                        ).length
                                    }
                                </span>
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {createButton}
                </div>
                {galleries.map((gallery) => {
                    const galleryRows = rows.filter(
                        (row) => row.$galleryId === gallery.id
                    );
                    const manageable = canManageGallery(access, gallery);
                    return (
                        <TabsContent
                            key={gallery.id}
                            value={gallery.id}
                            className="m-0"
                        >
                            <div className="flex flex-wrap items-center gap-2 px-2 py-1">
                                <span className="text-muted-foreground min-w-0 flex-1 text-sm">
                                    {gallery.description}
                                </span>
                                <Badge variant="outline">
                                    {t(
                                        `dialog.group.gallery.visibility_${groupGalleryVisibility(gallery)}`
                                    )}
                                </Badge>
                                {canSubmitToGallery(access, gallery) ? (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        disabled={editor.saving}
                                        onClick={() =>
                                            editor.openAddImage(gallery)
                                        }
                                    >
                                        <ImagePlusIcon />
                                        {t('dialog.group.gallery.add_image')}
                                    </Button>
                                ) : null}
                                {manageable ? (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        disabled={editor.saving}
                                        onClick={() => editor.openEdit(gallery)}
                                    >
                                        <PencilIcon />
                                        {t('dialog.group.gallery.edit')}
                                    </Button>
                                ) : null}
                                {access.manageAll ? (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="text-destructive"
                                        disabled={editor.saving}
                                        onClick={() => {
                                            void editor.removeGallery(gallery);
                                        }}
                                    >
                                        <Trash2Icon />
                                        {t('dialog.group.gallery.delete')}
                                    </Button>
                                ) : null}
                            </div>
                            {galleryRows.length ? (
                                <div className="grid max-h-[60vh] gap-4 overflow-y-auto p-1 pt-2 sm:grid-cols-2 lg:grid-cols-3">
                                    {galleryRows.map((row, index) => {
                                        const image = getGroupRowImage(
                                            row,
                                            'photos'
                                        );
                                        const label = getGroupRowLabel(row);
                                        return (
                                            <div
                                                key={`${row.id || label}:${index}`}
                                                className="group/photo relative"
                                            >
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    className="h-auto w-full flex-col items-stretch overflow-hidden rounded-md border p-0 text-left text-sm"
                                                    onClick={() =>
                                                        onPreviewImage(
                                                            getGroupRowRawImage(
                                                                row
                                                            ),
                                                            label
                                                        )
                                                    }
                                                >
                                                    {image ? (
                                                        <FadeInImage
                                                            src={image}
                                                            alt={label}
                                                            className="max-h-52 w-full object-contain"
                                                        />
                                                    ) : (
                                                        <div className="bg-muted flex h-52 w-full items-center justify-center">
                                                            <ImageIcon className="text-muted-foreground" />
                                                        </div>
                                                    )}
                                                </Button>
                                                {canDeleteGalleryImage(
                                                    access,
                                                    gallery,
                                                    row
                                                ) ? (
                                                    <Button
                                                        type="button"
                                                        size="icon-sm"
                                                        variant="secondary"
                                                        className="text-destructive absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover/photo:opacity-100 focus-visible:opacity-100"
                                                        aria-label={t(
                                                            'dialog.group.gallery.delete_image'
                                                        )}
                                                        disabled={editor.saving}
                                                        onClick={() => {
                                                            void editor.removeImage(
                                                                row
                                                            );
                                                        }}
                                                    >
                                                        <Trash2Icon />
                                                    </Button>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <GroupListState
                                    title={t('dialog.group.gallery.header')}
                                />
                            )}
                        </TabsContent>
                    );
                })}
            </Tabs>
        );
    }

    const form = editor.form;
    return (
        <>
            {content}
            <Dialog
                open={Boolean(form)}
                onOpenChange={(open) => {
                    if (!open) {
                        editor.closeForm();
                    }
                }}
            >
                {form ? (
                    <DialogContent className="sm:max-w-lg">
                        <DialogHeader>
                            <DialogTitle>
                                {t(
                                    form.galleryId
                                        ? 'dialog.group.gallery.edit'
                                        : 'dialog.group.gallery.create'
                                )}
                            </DialogTitle>
                            <DialogDescription>
                                {group.name || group.id}
                            </DialogDescription>
                        </DialogHeader>
                        <FieldGroup className="gap-4">
                            <Field>
                                <FieldLabel htmlFor="group-gallery-name">
                                    {t('dialog.group.gallery.name')}
                                </FieldLabel>
                                <Input
                                    id="group-gallery-name"
                                    value={form.name}
                                    maxLength={64}
                                    disabled={editor.saving}
                                    onChange={(event) =>
                                        editor.setForm({
                                            ...form,
                                            name: event.target.value
                                        })
                                    }
                                />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="group-gallery-description">
                                    {t('dialog.group.gallery.description')}
                                </FieldLabel>
                                <Textarea
                                    id="group-gallery-description"
                                    rows={3}
                                    value={form.description}
                                    maxLength={512}
                                    disabled={editor.saving}
                                    className="resize-none"
                                    onChange={(event) =>
                                        editor.setForm({
                                            ...form,
                                            description: event.target.value
                                        })
                                    }
                                />
                            </Field>
                            <Field
                                orientation="horizontal"
                                data-disabled={editor.saving}
                            >
                                <Checkbox
                                    id="group-gallery-members-only"
                                    checked={form.membersOnly}
                                    disabled={editor.saving}
                                    onCheckedChange={(checked) =>
                                        editor.setForm({
                                            ...form,
                                            membersOnly: checked === true
                                        })
                                    }
                                />
                                <FieldLabel htmlFor="group-gallery-members-only">
                                    {t('dialog.group.gallery.members_only')}
                                </FieldLabel>
                            </Field>
                        </FieldGroup>
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="secondary"
                                disabled={editor.saving}
                                onClick={editor.closeForm}
                            >
                                {t('common.actions.cancel')}
                            </Button>
                            <Button
                                type="button"
                                disabled={editor.saving || !form.name.trim()}
                                onClick={() => {
                                    void editor.submit(form);
                                }}
                            >
                                {t('common.actions.save')}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                ) : null}
            </Dialog>
            <Dialog
                open={Boolean(editor.imageGallery)}
                onOpenChange={(open) => {
                    if (!open) {
                        editor.closeImage();
                    }
                }}
            >
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>
                            {t('dialog.group.gallery.add_image')}
                        </DialogTitle>
                        <DialogDescription>
                            {editor.imageGallery?.name ||
                                editor.imageGallery?.id}
                        </DialogDescription>
                    </DialogHeader>
                    <GroupGalleryImageField
                        id="group-gallery-add-image"
                        open={Boolean(editor.imageGallery)}
                        imageId={editor.imageFileId}
                        disabled={editor.saving}
                        onChange={editor.setImageFileId}
                    />
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={editor.saving}
                            onClick={editor.closeImage}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                        <Button
                            type="button"
                            disabled={
                                editor.saving || !editor.imageFileId.trim()
                            }
                            onClick={() => {
                                void editor.addImage();
                            }}
                        >
                            {t('dialog.group.gallery.add_image')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
