import { Fragment } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator
} from '@/ui/shadcn/breadcrumb.jsx';
import { AvatarDialogContent } from '@/components/dialogs/AvatarDialogContent.jsx';
import { GroupDialogContent } from '@/components/dialogs/GroupDialogContent.jsx';
import { UserDialogContent } from '@/components/dialogs/UserDialogContent.jsx';
import { WorldDialogContent } from '@/components/dialogs/WorldDialogContent.jsx';

import { useDialogStore } from '@/state/dialogStore.js';

export function DialogHost() {
    const activeDialog = useDialogStore((state) => state.activeDialog);
    const breadcrumbs = useDialogStore((state) => state.breadcrumbs);
    const closeDialog = useDialogStore((state) => state.closeDialog);
    const popToBreadcrumb = useDialogStore((state) => state.popToBreadcrumb);

    const dialogKind = activeDialog?.kind || '';
    const dialogPayload = activeDialog?.payload || null;
    const isUserDialog = dialogKind === 'user';
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
        <Dialog open={Boolean(activeDialog)} onOpenChange={(open) => !open && closeDialog()}>
            <DialogContent showCloseButton={false} className="flex max-h-[90vh] w-[calc(100vw-2rem)] !max-w-[calc(100vw-2rem)] flex-col overflow-hidden sm:w-[65rem] sm:!max-w-[65rem]">
                <DialogHeader className="sr-only">
                    <DialogTitle>{activeDialog?.title ?? defaultTitle}</DialogTitle>
                    <DialogDescription>
                        {activeDialog?.description ?? defaultDescription}
                    </DialogDescription>
                </DialogHeader>
                {breadcrumbs.length > 1 ? (
                    <Breadcrumb>
                        <BreadcrumbList>
                            {breadcrumbs.map((crumb, index) => (
                                <Fragment key={`${crumb.key ?? crumb.label}-${index}`}>
                                    <BreadcrumbItem>
                                        {index < breadcrumbs.length - 1 ? (
                                            <BreadcrumbLink
                                                asChild={false}
                                                className="cursor-pointer"
                                                onClick={() => popToBreadcrumb(index)}>
                                                {crumb.label ?? crumb.title ?? `Step ${index + 1}`}
                                            </BreadcrumbLink>
                                        ) : (
                                            <BreadcrumbPage>
                                                {crumb.label ?? crumb.title ?? `Step ${index + 1}`}
                                            </BreadcrumbPage>
                                        )}
                                    </BreadcrumbItem>
                                    {index < breadcrumbs.length - 1 ? (
                                        <BreadcrumbSeparator />
                                    ) : null}
                                </Fragment>
                            ))}
                        </BreadcrumbList>
                        </Breadcrumb>
                    ) : null}
                {isUserDialog ? (
                    <UserDialogContent
                        userId={activeDialog?.entityId}
                        seedData={dialogPayload?.seedData ?? null}
                    />
                ) : isWorldDialog ? (
                    <WorldDialogContent
                        worldId={activeDialog?.entityId}
                        seedData={dialogPayload?.seedData ?? null}
                        initialAction={dialogPayload?.initialAction ?? ''}
                        initialActionNonce={dialogPayload?.initialActionNonce ?? 0}
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
                    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                        {activeDialog?.body ?? 'Unsupported dialog type.'}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
