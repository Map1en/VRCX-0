import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';

import { DataTableScrollArea } from '@/components/data-table/DataTableView';
import {
    PageBackButton,
    PageBody,
    PageDescription,
    PageFooter,
    PageHeader,
    PageScaffold,
    PageTitle,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold';
import { FadeInImage } from '@/components/media/FadeInImage';
import {
    openAvatarDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService';
import {
    cancelFavoriteImport,
    clearFavoriteImportRows,
    closeFavoriteImportDialog,
    getFavoriteImportTypeConfig,
    importFavoriteImportRows,
    openFavoriteImportDialog,
    processFavoriteImportList
} from '@/services/favoriteImportService';
import { useFavoriteImportStore } from '@/state/favoriteImportStore';
import type { FavoriteImportRow } from '@/state/favoriteImportStore';
import { useFavoriteStore } from '@/state/favoriteStore';
import { Button } from '@/ui/shadcn/button';
import { Progress, ProgressLabel, ProgressValue } from '@/ui/shadcn/progress';
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
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

type ImportKind = 'world' | 'avatar' | 'friend';
type ImportLocation = 'remote' | 'local';

const BACK_ROUTE: Record<ImportKind, { path: string; titleKey: string }> = {
    world: {
        path: '/favorites/worlds',
        titleKey: 'app.routes.favorite_worlds'
    },
    avatar: {
        path: '/favorites/avatars',
        titleKey: 'app.routes.favorite_avatars'
    },
    friend: {
        path: '/favorites/friends',
        titleKey: 'app.routes.favorite_friends'
    }
};

function normalizeKind(value: unknown): ImportKind | null {
    return value === 'world' || value === 'avatar' || value === 'friend'
        ? value
        : null;
}

function rowText(row: FavoriteImportRow, key: string): string {
    const value = row[key];
    return typeof value === 'string' ? value : String(value ?? '');
}

function getRowName(kind: ImportKind, row: FavoriteImportRow): string {
    if (kind === 'friend') {
        return (
            rowText(row, 'displayName') || rowText(row, 'username') || row.id
        );
    }
    return rowText(row, 'name') || row.id;
}

function getRowDetail(kind: ImportKind, row: FavoriteImportRow): string {
    if (kind === 'friend') {
        return (
            rowText(row, 'statusDescription') ||
            rowText(row, 'status') ||
            rowText(row, 'username')
        );
    }
    return rowText(row, 'authorName') || rowText(row, 'authorId');
}

function getRowImage(row: FavoriteImportRow): string {
    return (
        rowText(row, 'thumbnailImageUrl') ||
        rowText(row, 'imageUrl') ||
        rowText(row, 'currentAvatarThumbnailImageUrl') ||
        rowText(row, 'currentAvatarImageUrl') ||
        rowText(row, 'userIcon') ||
        rowText(row, 'profilePicOverride')
    );
}

function openRowDialog(kind: ImportKind, row: FavoriteImportRow): void {
    if (kind === 'avatar') {
        openAvatarDialog({ avatarId: row.id, seedData: row });
    } else if (kind === 'world') {
        openWorldDialog({ worldId: row.id, seedData: row });
    } else if (kind === 'friend') {
        openUserDialog({ userId: row.id });
    }
}

export function FavoriteImportPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const params = useParams();
    const kind = normalizeKind(params.kind);

    useEffect(() => {
        if (!kind) {
            return undefined;
        }
        openFavoriteImportDialog({ type: kind });
        return () => {
            closeFavoriteImportDialog();
        };
    }, [kind]);

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
    const setInput = useFavoriteImportStore((state) => state.setInput);
    const setRemoteGroupName = useFavoriteImportStore(
        (state) => state.setRemoteGroupName
    );
    const setLocalGroupName = useFavoriteImportStore(
        (state) => state.setLocalGroupName
    );
    const removeRow = useFavoriteImportStore((state) => state.removeRow);
    const setErrors = useFavoriteImportStore((state) => state.setErrors);

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

    const [location, setLocation] = useState<ImportLocation>('remote');

    const activeKind = kind ?? 'world';
    const config = getFavoriteImportTypeConfig(activeKind);

    const { remoteGroups, localGroups } = useMemo(() => {
        if (activeKind === 'avatar') {
            return {
                remoteGroups: favoriteAvatarGroups,
                localGroups: localAvatarFavoriteGroups
            };
        }
        if (activeKind === 'world') {
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
        activeKind,
        favoriteAvatarGroups,
        favoriteFriendGroups,
        favoriteWorldGroups,
        localAvatarFavoriteGroups,
        localFriendFavoriteGroups,
        localWorldFavoriteGroups
    ]);

    const label = config?.label || 'Favorite';

    const detectedCount = useMemo(() => {
        if (!config) {
            return 0;
        }
        const matches = input.match(config.regex) ?? [];
        const detected = new Set(matches);
        for (const row of rows) {
            detected.delete(row.id);
        }
        return detected.size;
    }, [config, input, rows]);

    const groupOptions = useMemo(
        () =>
            location === 'remote'
                ? remoteGroups.map((group) => ({
                      key: `${group.type}:${group.name}`,
                      value: group.name,
                      label: `${group.displayName || group.name} (${group.count}/${group.capacity})`,
                      disabled:
                          group.count != null &&
                          group.capacity != null &&
                          group.count >= group.capacity
                  }))
                : localGroups.map((group) => ({
                      key: group,
                      value: group,
                      label: group,
                      disabled: false
                  })),
        [location, remoteGroups, localGroups]
    );

    const selectedGroup =
        location === 'remote' ? remoteGroupName : localGroupName;

    const activeTotal = progressTotal || importProgressTotal;
    const activeDone = progressTotal ? progress : importProgress;
    const progressLabel = progressTotal
        ? t('dialog.favorite_import.status.processing')
        : t('dialog.favorite_import.status.importing');
    const progressValue =
        activeTotal > 0 ? Math.round((activeDone / activeTotal) * 100) : null;

    function handleLocationChange(next: string[]) {
        const value = next[0];
        if (value !== 'remote' && value !== 'local') {
            return;
        }
        if (value === location) {
            return;
        }
        setLocation(value);
        if (value === 'remote') {
            setRemoteGroupName('');
        } else {
            setLocalGroupName('');
        }
    }

    function handleGroupChange(value: string | null) {
        if (location === 'remote') {
            setRemoteGroupName(value ?? '');
        } else {
            setLocalGroupName(value ?? '');
        }
    }

    if (!kind) {
        return <Navigate to="/favorites/worlds" replace />;
    }

    const backRoute = BACK_ROUTE[kind];

    return (
        <PageScaffold className="favorite-import-page">
            <PageToolbar>
                <PageToolbarRow className="items-center">
                    <PageBackButton
                        label={t(backRoute.titleKey)}
                        onClick={() => navigate(backRoute.path)}
                    />
                    <PageHeader className="min-w-0 p-0">
                        <PageTitle>
                            {label} {t('dialog.favorite_import.action.import')}
                        </PageTitle>
                        <PageDescription>
                            {t(
                                'dialog.favorite_import.description.paste_exported_ids_process_the_list_then_import_to_a_vrchat_or_local_favorite_group'
                            )}
                        </PageDescription>
                    </PageHeader>
                </PageToolbarRow>
            </PageToolbar>

            <PageBody className="flex-row gap-3 max-lg:flex-col">
                <div className="flex w-80 shrink-0 flex-col gap-2 max-lg:w-full">
                    <Textarea
                        className="min-h-40 flex-1 resize-none font-mono text-xs max-lg:min-h-32"
                        placeholder={t(
                            'dialog.favorite_import.placeholder.paste_ids'
                        )}
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                    />
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground text-sm tabular-nums">
                            {loading
                                ? null
                                : t(
                                      'dialog.favorite_import.dynamic.detected_count',
                                      { count: detectedCount }
                                  )}
                        </span>
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
                                disabled={detectedCount === 0}
                                onClick={() => {
                                    processFavoriteImportList();
                                }}
                            >
                                {t('dialog.favorite_import.label.process_list')}
                            </Button>
                        )}
                    </div>
                    {loading ? (
                        <Progress value={progressValue}>
                            <ProgressLabel className="text-muted-foreground text-sm font-normal">
                                {progressLabel}
                            </ProgressLabel>
                            <ProgressValue>
                                {() => `${activeDone} / ${activeTotal}`}
                            </ProgressValue>
                        </Progress>
                    ) : null}
                    {errors ? (
                        <div className="flex max-h-40 min-h-0 flex-col gap-1">
                            <Button
                                size="xs"
                                variant="secondary"
                                className="self-start"
                                onClick={() => setErrors('')}
                            >
                                {t(
                                    'dialog.favorite_import.action.clear_errors'
                                )}
                            </Button>
                            <pre className="bg-muted/30 min-h-0 flex-1 overflow-auto rounded-md border p-2 text-xs whitespace-pre-wrap">
                                {errors}
                            </pre>
                        </div>
                    ) : null}
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
                    <DataTableScrollArea className="[scrollbar-gutter:stable]">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-16">
                                        {t(
                                            'dialog.favorite_import.label.image'
                                        )}
                                    </TableHead>
                                    <TableHead>
                                        {t('dialog.favorite_import.label.name')}
                                    </TableHead>
                                    <TableHead>
                                        {t(
                                            'dialog.favorite_import.label.detail'
                                        )}
                                    </TableHead>
                                    <TableHead>ID</TableHead>
                                    <TableHead className="w-36 text-right">
                                        {t(
                                            'dialog.favorite_import.label.actions'
                                        )}
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.length > 0 ? (
                                    rows.map((row) => (
                                        <TableRow
                                            key={row.id}
                                            className="animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none"
                                        >
                                            <TableCell>
                                                {getRowImage(row) ? (
                                                    <FadeInImage
                                                        alt=""
                                                        src={getRowImage(row)}
                                                        className="size-10 rounded object-cover"
                                                        fallback={
                                                            <div className="bg-muted size-10 rounded" />
                                                        }
                                                    />
                                                ) : (
                                                    <div className="bg-muted size-10 rounded" />
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {getRowName(activeKind, row)}
                                            </TableCell>
                                            <TableCell className="max-w-72 truncate">
                                                {getRowDetail(activeKind, row)}
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
                                                            openRowDialog(
                                                                activeKind,
                                                                row
                                                            )
                                                        }
                                                    >
                                                        {t(
                                                            'common.actions.open'
                                                        )}
                                                    </Button>
                                                    <Button
                                                        size="xs"
                                                        variant="ghost"
                                                        onClick={() =>
                                                            removeRow(row.id)
                                                        }
                                                    >
                                                        {t(
                                                            'dialog.favorite_import.action.exclude'
                                                        )}
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
                                            {t(
                                                'dialog.favorite_import.empty.no_parsed'
                                            )}{' '}
                                            {label.toLowerCase()}{' '}
                                            {t(
                                                'dialog.favorite_import.label.rows_yet'
                                            )}
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </DataTableScrollArea>
                </div>
            </PageBody>

            <PageFooter className="pt-3">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground text-sm">
                        {t('dialog.favorite_import.label.import_to')}
                    </span>
                    <ToggleGroup
                        variant="outline"
                        size="sm"
                        value={[location]}
                        onValueChange={handleLocationChange}
                    >
                        <ToggleGroupItem value="remote">VRChat</ToggleGroupItem>
                        <ToggleGroupItem value="local">
                            {t('dialog.favorite_import.label.local')}
                        </ToggleGroupItem>
                    </ToggleGroup>
                    <Select
                        value={selectedGroup}
                        onValueChange={handleGroupChange}
                        items={groupOptions}
                    >
                        <SelectTrigger size="sm" className="min-w-52">
                            <SelectValue
                                placeholder={t(
                                    'dialog.favorite_import.label.select_group'
                                )}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {groupOptions.map((option) => (
                                    <SelectItem
                                        key={option.key}
                                        value={option.value}
                                        disabled={option.disabled}
                                    >
                                        {option.label}
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
                        {t('dialog.favorite_import.action.clear_table')}
                    </Button>
                    <Button
                        size="sm"
                        disabled={
                            rows.length === 0 || loading || !selectedGroup
                        }
                        onClick={() => {
                            importFavoriteImportRows();
                        }}
                    >
                        {t('view.favorite.import')}
                    </Button>
                </div>
            </PageFooter>
        </PageScaffold>
    );
}
