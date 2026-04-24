import { useMemo } from 'react';

import { useTranslation } from 'react-i18next';
import {
    openAvatarDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';
import {
    cancelFavoriteImport,
    clearFavoriteImportRows,
    getFavoriteImportTypeConfig,
    importFavoriteImportRows,
    processFavoriteImportList
} from '@/services/favoriteImportService.js';
import { useFavoriteImportStore } from '@/state/favoriteImportStore.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table';
import { Textarea } from '@/ui/shadcn/textarea';

function getRowName(type, row) {
    if (type === 'friend') {
        return row.displayName || row.username || row.id;
    }
    return row.name || row.id;
}

function getRowDetail(type, row) {
    if (type === 'friend') {
        return row.statusDescription || row.status || row.username || '';
    }
    return row.authorName || row.authorId || '';
}

function getRowImage(row) {
    return (
        row.thumbnailImageUrl ||
        row.imageUrl ||
        row.currentAvatarThumbnailImageUrl ||
        row.currentAvatarImageUrl ||
        row.userIcon ||
        row.profilePicOverride ||
        ''
    );
}

function openRowDialog(type, row) {
    if (type === 'avatar') {
        openAvatarDialog({ avatarId: row.id, seedData: row });
    } else if (type === 'world') {
        openWorldDialog({ worldId: row.id, seedData: row });
    } else if (type === 'friend') {
        openUserDialog({ userId: row.id });
    }
}

export function FavoriteImportHost() {
    const { t } = useTranslation();

    const open = useFavoriteImportStore((state) => state.open);
    const type = useFavoriteImportStore((state) => state.type);
    const input = useFavoriteImportStore((state) => state.input);
    const rows = useFavoriteImportStore((state) => state.rows);
    const loading = useFavoriteImportStore((state) => state.loading);
    const progress = useFavoriteImportStore((state) => state.progress);
    const progressTotal = useFavoriteImportStore(
        (state) => state.progressTotal
    );
    const importProgress = useFavoriteImportStore(
        (state) => state.importProgress
    );
    const importProgressTotal = useFavoriteImportStore(
        (state) => state.importProgressTotal
    );
    const errors = useFavoriteImportStore((state) => state.errors);
    const remoteGroupName = useFavoriteImportStore(
        (state) => state.remoteGroupName
    );
    const localGroupName = useFavoriteImportStore(
        (state) => state.localGroupName
    );
    const closeDialog = useFavoriteImportStore((state) => state.closeDialog);
    const setInput = useFavoriteImportStore((state) => state.setInput);
    const setRemoteGroupName = useFavoriteImportStore(
        (state) => state.setRemoteGroupName
    );
    const setLocalGroupName = useFavoriteImportStore(
        (state) => state.setLocalGroupName
    );
    const removeRow = useFavoriteImportStore((state) => state.removeRow);
    const setErrors = useFavoriteImportStore((state) => state.setErrors);
    const config = getFavoriteImportTypeConfig(type);
    const favoriteAvatarGroups = useFavoriteStore(
        (state) => state.favoriteAvatarGroups
    );
    const favoriteWorldGroups = useFavoriteStore(
        (state) => state.favoriteWorldGroups
    );
    const favoriteFriendGroups = useFavoriteStore(
        (state) => state.favoriteFriendGroups
    );
    const localAvatarFavoriteGroups = useFavoriteStore(
        (state) => state.localAvatarFavoriteGroups
    );
    const localWorldFavoriteGroups = useFavoriteStore(
        (state) => state.localWorldFavoriteGroups
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state) => state.localFriendFavoriteGroups
    );
    const { remoteGroups, localGroups } = useMemo(() => {
        if (type === 'avatar') {
            return {
                remoteGroups: favoriteAvatarGroups,
                localGroups: localAvatarFavoriteGroups
            };
        }
        if (type === 'world') {
            return {
                remoteGroups: favoriteWorldGroups,
                localGroups: localWorldFavoriteGroups
            };
        }
        return {
            remoteGroups: favoriteFriendGroups,
            localGroups: localFriendFavoriteGroups
        };
    }, [
        favoriteAvatarGroups,
        favoriteFriendGroups,
        favoriteWorldGroups,
        localAvatarFavoriteGroups,
        localFriendFavoriteGroups,
        localWorldFavoriteGroups,
        type
    ]);
    const label = config?.label || 'Favorite';

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => !nextOpen && closeDialog()}
        >
            <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{label} {t('dialog.favorite_import.generated.import')}</DialogTitle>
                    <DialogDescription>
                        {t('dialog.favorite_import.generated.paste_exported_ids_process_the_list_then_import_to_a_vrchat_')}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-center justify-between gap-3">
                    <div className="text-muted-foreground text-sm">
                        {progressTotal > 0
                            ? `Processing ${progress} / ${progressTotal}`
                            : importProgressTotal > 0
                              ? `Importing ${importProgress} / ${importProgressTotal}`
                              : `${rows.length} parsed item(s)`}
                    </div>
                    <div className="flex items-center gap-2">
                        {loading ? (
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={cancelFavoriteImport}
                            >
                                {t('common.actions.cancel')}
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                disabled={!input.trim()}
                                onClick={() => void processFavoriteImportList()}
                            >
                                {t('dialog.favorite_import.generated.process_list')}
                            </Button>
                        )}
                    </div>
                </div>

                <Textarea
                    rows={8}
                    className="min-h-40 resize-none"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Select
                            value={remoteGroupName}
                            onValueChange={(value) => setRemoteGroupName(value)}
                        >
                            <SelectTrigger size="sm" className="min-w-48">
                                <SelectValue placeholder={t('dialog.favorite_import.generated.vrchat_group')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {remoteGroups.map((group) => (
                                        <SelectItem
                                            key={`${group.type}:${group.name}`}
                                            value={group.name}
                                            disabled={
                                                group.count >= group.capacity
                                            }
                                        >
                                            {group.displayName || group.name} (
                                            {group.count}/{group.capacity})
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>

                        <Select
                            value={localGroupName}
                            onValueChange={(value) => setLocalGroupName(value)}
                        >
                            <SelectTrigger size="sm" className="min-w-48">
                                <SelectValue placeholder={t('dialog.favorite_import.generated.local_group')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {localGroups.map((group) => (
                                        <SelectItem key={group} value={group}>
                                            {group}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="secondary"
                            disabled={rows.length === 0}
                            onClick={clearFavoriteImportRows}
                        >
                            {t('dialog.favorite_import.generated.clear_table')}
                        </Button>
                        <Button
                            size="sm"
                            disabled={
                                rows.length === 0 ||
                                loading ||
                                (!remoteGroupName && !localGroupName)
                            }
                            onClick={() => void importFavoriteImportRows()}
                        >
                            {t('view.favorite.import')}
                        </Button>
                    </div>
                </div>

                {errors ? (
                    <div className="flex flex-col gap-2">
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setErrors('')}
                        >
                            {t('dialog.favorite_import.generated.clear_errors')}
                        </Button>
                        <pre className="bg-muted/30 max-h-40 overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap">
                            {errors}
                        </pre>
                    </div>
                ) : null}

                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-16">{t('dialog.favorite_import.generated.image')}</TableHead>
                                <TableHead>{t('dialog.favorite_import.generated.name')}</TableHead>
                                <TableHead>{t('dialog.favorite_import.generated.detail')}</TableHead>
                                <TableHead>ID</TableHead>
                                <TableHead className="w-36 text-right">
                                    {t('dialog.favorite_import.generated.actions')}
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.length > 0 ? (
                                rows.map((row) => (
                                    <TableRow key={row.id}>
                                        <TableCell>
                                            {getRowImage(row) ? (
                                                <img
                                                    alt=""
                                                    src={getRowImage(row)}
                                                    className="size-10 rounded object-cover"
                                                />
                                            ) : (
                                                <div className="bg-muted size-10 rounded" />
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {getRowName(type, row)}
                                        </TableCell>
                                        <TableCell className="max-w-72 truncate">
                                            {getRowDetail(type, row)}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {row.id}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    size="xs"
                                                    variant="secondary"
                                                    onClick={() =>
                                                        openRowDialog(type, row)
                                                    }
                                                >
                                                    {t('common.actions.open')}
                                                </Button>
                                                <Button
                                                    size="xs"
                                                    variant="ghost"
                                                    onClick={() =>
                                                        removeRow(row.id)
                                                    }
                                                >
                                                    {t('common.actions.delete')}
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell
                                        colSpan={5}
                                        className="text-muted-foreground h-24 text-center"
                                    >
                                        {t('dialog.favorite_import.generated.no_parsed')} {label.toLowerCase()} {t('dialog.favorite_import.generated.rows_yet')}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </DialogContent>
        </Dialog>
    );
}
