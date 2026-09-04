import { ArrowLeftIcon } from 'lucide-react';
import { Fragment, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { OWNER_USER_ID } from '@/shared/constants/user';
import { useDialogStore } from '@/state/dialogStore';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator
} from '@/ui/shadcn/breadcrumb';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Spinner } from '@/ui/shadcn/spinner';

const AvatarDialogContent = lazy(() =>
    import('@/components/dialogs/AvatarDialogContent').then((module) => ({
        default: module.AvatarDialogContent
    }))
);
const GroupDialogContent = lazy(() =>
    import('@/components/dialogs/GroupDialogContent').then((module) => ({
        default: module.GroupDialogContent
    }))
);
const UserDialogContent = lazy(() =>
    import('@/components/dialogs/UserDialogContent').then((module) => ({
        default: module.UserDialogContent
    }))
);
const WorldDialogContent = lazy(() =>
    import('@/components/dialogs/WorldDialogContent').then((module) => ({
        default: module.WorldDialogContent
    }))
);

export function DialogHost() {
    const { t } = useTranslation();
    const activeDialog = useDialogStore((state) => state.activeDialog);
    const breadcrumbs = useDialogStore((state) => state.breadcrumbs);
    const closeDialog = useDialogStore((state) => state.closeDialog);
    const popToBreadcrumb = useDialogStore((state) => state.popToBreadcrumb);

    const currentBreadcrumbIndex = breadcrumbs.length - 1;
    const dialogKind = activeDialog?.kind || '';
    const dialogPayload = activeDialog?.payload || null;
    const isUserDialog = dialogKind === 'user';
    const isOwnerDialog =
        isUserDialog && activeDialog?.entityId === OWNER_USER_ID;
    const isWorldDialog = dialogKind === 'world';
    const isAvatarDialog = dialogKind === 'avatar';
    const isGroupDialog = dialogKind === 'group';
    const defaultTitle = isUserDialog
        ? 'User'
        : isWorldDialog
          ? 'World'
          : isAvatarDialog
            ? 'Avatar'
            : isGroupDialog
              ? 'Group'
              : 'Dialog host';
    const defaultDescription = isUserDialog
        ? 'Live user profile summary from the current session and VRChat API.'
        : isWorldDialog
          ? 'Live world profile summary from the current session and VRChat API.'
          : isAvatarDialog
            ? 'Live avatar profile summary from the current session, local cache, and VRChat API.'
            : isGroupDialog
              ? 'Live group profile summary from the current session and VRChat API.'
              : 'Unsupported dialog type.';

    return (
        <Dialog
            open={Boolean(activeDialog)}
            onOpenChange={(open) => !open && closeDialog()}
        >
            <DialogContent
                showCloseButton={false}
                className={cn(
                    'flex max-h-[90vh] w-[calc(100vw-2rem)] !max-w-[calc(100vw-2rem)] flex-col overflow-hidden',
                    isUserDialog ||
                        isWorldDialog ||
                        isGroupDialog ||
                        isAvatarDialog
                        ? 'sm:w-[min(96vw,72rem)] sm:!max-w-[min(96vw,72rem)]'
                        : 'sm:w-[65rem] sm:!max-w-[65rem]',
                    isOwnerDialog && 'owner-dialog'
                )}
            >
                <DialogHeader className="sr-only">
                    <DialogTitle>
                        {activeDialog?.title ?? defaultTitle}
                    </DialogTitle>
                    <DialogDescription>
                        {activeDialog?.description ?? defaultDescription}
                    </DialogDescription>
                </DialogHeader>
                {currentBreadcrumbIndex > 0 ? (
                    <div className="flex min-w-0 items-center gap-1.5">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('common.actions.back')}
                            onClick={() =>
                                popToBreadcrumb(currentBreadcrumbIndex - 1)
                            }
                        >
                            <ArrowLeftIcon data-icon="inline-start" />
                        </Button>
                        <Breadcrumb className="min-w-0">
                            <BreadcrumbList>
                                {breadcrumbs.map((crumb, index) => (
                                    <Fragment
                                        key={`${crumb.key ?? crumb.label}-${index}`}
                                    >
                                        <BreadcrumbItem>
                                            {index < currentBreadcrumbIndex ? (
                                                <BreadcrumbLink
                                                    className="cursor-pointer"
                                                    onClick={() =>
                                                        popToBreadcrumb(index)
                                                    }
                                                >
                                                    {crumb.label ??
                                                        crumb.title ??
                                                        `Step ${index + 1}`}
                                                </BreadcrumbLink>
                                            ) : (
                                                <BreadcrumbPage>
                                                    {crumb.label ??
                                                        crumb.title ??
                                                        `Step ${index + 1}`}
                                                </BreadcrumbPage>
                                            )}
                                        </BreadcrumbItem>
                                        {index < currentBreadcrumbIndex ? (
                                            <BreadcrumbSeparator />
                                        ) : null}
                                    </Fragment>
                                ))}
                            </BreadcrumbList>
                        </Breadcrumb>
                    </div>
                ) : null}
                <Suspense
                    fallback={<Spinner className="mx-auto my-8 size-6" />}
                >
                    {isUserDialog ? (
                        <UserDialogContent
                            key={`user:${activeDialog?.entityId ?? ''}:${
                                activeDialog?.openNonce ?? 0
                            }`}
                            userId={activeDialog?.entityId}
                            seedData={dialogPayload?.seedData ?? null}
                            initialAction={dialogPayload?.initialAction ?? ''}
                            openNonce={activeDialog?.openNonce ?? 0}
                        />
                    ) : isWorldDialog ? (
                        <WorldDialogContent
                            worldId={activeDialog?.entityId}
                            seedData={dialogPayload?.seedData ?? null}
                            initialAction={dialogPayload?.initialAction ?? ''}
                            openNonce={activeDialog?.openNonce ?? 0}
                            initialActionNonce={
                                dialogPayload?.initialActionNonce ?? 0
                            }
                            initialNewInstanceDefaults={
                                dialogPayload?.initialNewInstanceDefaults ??
                                null
                            }
                        />
                    ) : isAvatarDialog ? (
                        <AvatarDialogContent
                            avatarId={activeDialog?.entityId}
                            seedData={dialogPayload?.seedData ?? null}
                        />
                    ) : isGroupDialog ? (
                        <GroupDialogContent
                            groupId={activeDialog?.entityId}
                            seedData={dialogPayload?.seedData ?? null}
                        />
                    ) : (
                        <div className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
                            {activeDialog?.body ?? 'Unsupported dialog type.'}
                        </div>
                    )}
                </Suspense>
            </DialogContent>
        </Dialog>
    );
}
