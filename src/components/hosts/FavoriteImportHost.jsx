import { useMemo } from 'react';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select.jsx';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table.jsx';
import { Textarea } from '@/ui/shadcn/textarea.jsx';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFavoriteImportStore } from '@/state/favoriteImportStore.js';
import {
    cancelFavoriteImport,
    clearFavoriteImportRows,
    getFavoriteImportTypeConfig,
    importFavoriteImportRows,
    processFavoriteImportList
} from '@/services/favoriteImportService.js';
import {
    openAvatarDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';

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
    const open = useFavoriteImportStore((state) => state.open);
    const type = useFavoriteImportStore((state) => state.type);
    const input = useFavoriteImportStore((state) => state.input);
    const rows = useFavoriteImportStore((state) => state.rows);
    const loading = useFavoriteImportStore((state) => state.loading);
    const progress = useFavoriteImportStore((state) => state.progress);
    const progressTotal = useFavoriteImportStore((state) => state.progressTotal);
    const importProgress = useFavoriteImportStore((state) => state.importProgress);
    const importProgressTotal = useFavoriteImportStore((state) => state.importProgressTotal);
    const errors = useFavoriteImportStore((state) => state.errors);
    const remoteGroupName = useFavoriteImportStore((state) => state.remoteGroupName);
    const localGroupName = useFavoriteImportStore((state) => state.localGroupName);
    const closeDialog = useFavoriteImportStore((state) => state.closeDialog);
    const setInput = useFavoriteImportStore((state) => state.setInput);
    const setRemoteGroupName = useFavoriteImportStore((state) => state.setRemoteGroupName);
    const setLocalGroupName = useFavoriteImportStore((state) => state.setLocalGroupName);
    const removeRow = useFavoriteImportStore((state) => state.removeRow);
    const setErrors = useFavoriteImportStore((state) => state.setErrors);
    const config = getFavoriteImportTypeConfig(type);
    const favoriteAvatarGroups = useFavoriteStore((state) => state.favoriteAvatarGroups);
    const favoriteWorldGroups = useFavoriteStore((state) => state.favoriteWorldGroups);
    const favoriteFriendGroups = useFavoriteStore((state) => state.favoriteFriendGroups);
    const localAvatarFavoriteGroups = useFavoriteStore((state) => state.localAvatarFavoriteGroups);
    const localWorldFavoriteGroups = useFavoriteStore((state) => state.localWorldFavoriteGroups);
    const localFriendFavoriteGroups = useFavoriteStore((state) => state.localFriendFavoriteGroups);
    const { remoteGroups, localGroups } = useMemo(
        () => {
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
        },
        [
            favoriteAvatarGroups,
            favoriteFriendGroups,
            favoriteWorldGroups,
            localAvatarFavoriteGroups,
            localFriendFavoriteGroups,
            localWorldFavoriteGroups,
            type
        ]
    );
    const label = config?.label || 'Favorite';

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && closeDialog()}>
            <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{label} import</DialogTitle>
                    <DialogDescription>
                        Paste exported IDs, process the list, then import to a VRChat favorite
                        group or a local favorite group.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-center justify-between gap-3">
                    <div className="text-sm text-muted-foreground">
                        {progressTotal > 0
                            ? `Processing ${progress} / ${progressTotal}`
                            : importProgressTotal > 0
                                ? `Importing ${importProgress} / ${importProgressTotal}`
                                : `${rows.length} parsed item(s)`}
                    </div>
                    <div className="flex items-center gap-2">
                        {loading ? (
                            <Button size="sm" variant="secondary" onClick={cancelFavoriteImport}>
                                Cancel
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                disabled={!input.trim()}
                                onClick={() => void processFavoriteImportList()}>
                                Process list
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
                            onValueChange={(value) => setRemoteGroupName(value)}>
                            <SelectTrigger size="sm" className="min-w-48">
                                <SelectValue placeholder="VRChat group" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {remoteGroups.map((group) => (
                                        <SelectItem
                                            key={`${group.type}:${group.name}`}
                                            value={group.name}
                                            disabled={group.count >= group.capacity}>
                                            {group.displayName || group.name} ({group.count}/
                                            {group.capacity})
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>

                        <Select
                            value={localGroupName}
                            onValueChange={(value) => setLocalGroupName(value)}>
                            <SelectTrigger size="sm" className="min-w-48">
                                <SelectValue placeholder="Local group" />
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
                            onClick={clearFavoriteImportRows}>
                            Clear table
                        </Button>
                        <Button
                            size="sm"
                            disabled={
                                rows.length === 0 ||
                                loading ||
                                (!remoteGroupName && !localGroupName)
                            }
                            onClick={() => void importFavoriteImportRows()}>
                            Import
                        </Button>
                    </div>
                </div>

                {errors ? (
                    <div className="space-y-2">
                        <Button size="sm" variant="secondary" onClick={() => setErrors('')}>
                            Clear errors
                        </Button>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
                            {errors}
                        </pre>
                    </div>
                ) : null}

                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-16">Image</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Detail</TableHead>
                                <TableHead>ID</TableHead>
                                <TableHead className="w-36 text-right">Actions</TableHead>
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
                                                    className="h-10 w-10 rounded object-cover"
                                                />
                                            ) : (
                                                <div className="h-10 w-10 rounded bg-muted" />
                                            )}
                                        </TableCell>
                                        <TableCell>{getRowName(type, row)}</TableCell>
                                        <TableCell className="max-w-72 truncate">
                                            {getRowDetail(type, row)}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">{row.id}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    size="xs"
                                                    variant="secondary"
                                                    onClick={() => openRowDialog(type, row)}>
                                                    Open
                                                </Button>
                                                <Button
                                                    size="xs"
                                                    variant="ghost"
                                                    onClick={() => removeRow(row.id)}>
                                                    Delete
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell
                                        colSpan={5}
                                        className="h-24 text-center text-muted-foreground">
                                        No parsed {label.toLowerCase()} rows yet.
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
