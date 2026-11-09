import { FlaskConicalIcon, SearchXIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, LoadingState } from '@/components/layout/PageScaffold';
import { formatDateFilter } from '@/lib/dateTime';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { commands } from '@/platform/tauri/bindings';
import type { LocalTestAvatarOutput } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { formatBytes } from '@/shared/utils/formatBytes';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

type LoadState =
    | { status: 'loading' }
    | { status: 'ready'; avatars: LocalTestAvatarOutput[] }
    | { status: 'error'; error: unknown };

export function LocalTestAvatarsButton() {
    const { t } = useTranslation();
    const vrchatPathUnavailable = useRuntimeStore(
        (state) =>
            state.hostCapabilities.vrchatPathDiscovery?.available === false
    );
    const [open, setOpen] = useState(false);

    if (vrchatPathUnavailable) {
        return null;
    }

    return (
        <>
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setOpen(true)}
            >
                <FlaskConicalIcon data-icon="inline-start" />
                {t('view.my_avatars.action.open_local_test_avatars')}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-xl">
                    {open ? <LocalTestAvatarsDialogBody /> : null}
                </DialogContent>
            </Dialog>
        </>
    );
}

function LocalTestAvatarsDialogBody() {
    const { t } = useTranslation();
    const [loadState, setLoadState] = useState<LoadState>({
        status: 'loading'
    });
    const [searchQuery, setSearchQuery] = useState('');
    const [deletingFileName, setDeletingFileName] = useState('');

    useEffect(() => {
        let active = true;
        commands
            .appLocalTestAvatarsList()
            .then((avatars) => {
                if (active) {
                    setLoadState({ status: 'ready', avatars });
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    setLoadState({ status: 'error', error });
                }
            });
        return () => {
            active = false;
        };
    }, []);

    async function handleDelete(avatar: LocalTestAvatarOutput) {
        const result = await useModalStore.getState().confirm({
            title: t('view.my_avatars.modal.delete_local_test_avatar', {
                value: avatar.name
            }),
            description: t(
                'view.my_avatars.modal.delete_local_test_avatar_description'
            ),
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        setDeletingFileName(avatar.fileName);
        try {
            await commands.appLocalTestAvatarDelete(avatar.fileName);
            setLoadState((current) =>
                current.status === 'ready'
                    ? {
                          status: 'ready',
                          avatars: current.avatars.filter(
                              (item) => item.fileName !== avatar.fileName
                          )
                      }
                    : current
            );
        } catch (error) {
            toast.add({
                type: 'error',
                title: t(
                    'view.my_avatars.toast.failed_to_delete_local_test_avatar'
                ),
                description: userFacingErrorMessage(error)
            });
        } finally {
            setDeletingFileName('');
        }
    }

    const normalizedQuery = searchQuery.trim().toLowerCase();
    const avatars =
        loadState.status === 'ready'
            ? loadState.avatars.filter((avatar) =>
                  avatar.name.toLowerCase().includes(normalizedQuery)
              )
            : [];
    const hasAvatars =
        loadState.status === 'ready' && loadState.avatars.length > 0;

    return (
        <>
            <DialogHeader>
                <DialogTitle>
                    {t('view.my_avatars.label.local_test_avatars')}
                </DialogTitle>
                <DialogDescription>
                    {t('view.my_avatars.label.local_test_avatars_description')}
                </DialogDescription>
            </DialogHeader>

            {hasAvatars ? (
                <Input
                    type="search"
                    value={searchQuery}
                    placeholder={t('common.actions.search')}
                    onChange={(event) => setSearchQuery(event.target.value)}
                />
            ) : null}

            {loadState.status === 'loading' ? (
                <LoadingState variant="panel" />
            ) : loadState.status === 'error' ? (
                <EmptyState
                    variant="panel"
                    title={t(
                        'view.my_avatars.error.local_test_avatars_failed_to_load'
                    )}
                    description={userFacingErrorMessage(loadState.error)}
                />
            ) : !hasAvatars ? (
                <EmptyState
                    variant="panel"
                    icon={FlaskConicalIcon}
                    title={t('view.my_avatars.empty.no_local_test_avatars')}
                    description={t(
                        'view.my_avatars.empty.local_test_avatars_hint'
                    )}
                />
            ) : avatars.length === 0 ? (
                <EmptyState
                    variant="panel"
                    icon={SearchXIcon}
                    title={t(
                        'view.my_avatars.empty.no_local_test_avatars_match_the_search'
                    )}
                />
            ) : (
                <ul className="-mx-1 flex max-h-[60vh] flex-col gap-1 overflow-y-auto px-1">
                    {avatars.map((avatar) => (
                        <li
                            key={avatar.fileName}
                            className="flex items-center gap-3 rounded-lg border px-3 py-2"
                        >
                            <div className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-sm font-medium">
                                    {avatar.name}
                                </span>
                                <span className="text-muted-foreground text-xs">
                                    {[
                                        formatBytes(avatar.size),
                                        avatar.modifiedAt
                                            ? formatDateFilter(
                                                  avatar.modifiedAt,
                                                  'long'
                                              )
                                            : ''
                                    ]
                                        .filter(Boolean)
                                        .join(' · ')}
                                </span>
                            </div>
                            <HintTooltip label={t('common.actions.delete')}>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    disabled={Boolean(deletingFileName)}
                                    onClick={() => {
                                        void handleDelete(avatar);
                                    }}
                                >
                                    {deletingFileName === avatar.fileName ? (
                                        <Spinner />
                                    ) : (
                                        <Trash2Icon />
                                    )}
                                </Button>
                            </HintTooltip>
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}
