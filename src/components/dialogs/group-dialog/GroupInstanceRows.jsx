import { PlayIcon } from 'lucide-react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { LocationWorld } from '@/components/LocationWorld.jsx';
import { userImage } from '@/lib/entityMedia.js';
import { openUserDialog, openWorldDialog } from '@/services/dialogService.js';
import { tryOpenLaunchLocation } from '@/services/directAccessService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { Button } from '@/ui/shadcn/button';

import { EntityInfoBlock } from '../EntityDialogScaffold.jsx';
import { firstArray, firstText } from './groupDialogUtils.js';

function getInstanceLocation(instance) {
    const directLocation =
        instance?.location || instance?.tag || instance?.$location?.tag;
    if (directLocation) {
        return directLocation;
    }
    const worldId = instance?.worldId || instance?.world?.id;
    const instanceId = instance?.instanceId || instance?.id || instance?.name;
    return worldId && instanceId ? `${worldId}:${instanceId}` : '';
}

function getInstanceTitle(instance) {
    return instance?.world?.name || instance?.worldName || instance?.name || '';
}

function getInstanceOwnerId(instance) {
    return firstText(
        instance?.ownerUserId,
        instance?.owner_user_id,
        instance?.ownerId,
        instance?.owner_id,
        instance?.creatorUserId,
        instance?.creator_user_id,
        instance?.userId,
        instance?.user_id,
        instance?.ownerUser?.id,
        instance?.ownerUser?.userId,
        instance?.owner?.id,
        instance?.owner?.userId,
        instance?.creatorUser?.id,
        instance?.creatorUser?.userId,
        instance?.user?.id,
        instance?.user?.userId,
        instance?.$location?.userId,
        instance?.$location?.user_id
    );
}

function getInstanceOwnerName(instance) {
    return firstText(
        instance?.ownerUser?.displayName,
        instance?.ownerUser?.username,
        instance?.owner?.displayName,
        instance?.owner?.username,
        instance?.creatorUser?.displayName,
        instance?.creatorUser?.username,
        instance?.user?.displayName,
        instance?.user?.username,
        instance?.ownerName,
        instance?.owner_name,
        instance?.ownerDisplayName,
        instance?.owner_display_name
    );
}

function getInstanceUsers(instance) {
    const users = firstArray(
        instance?.users,
        instance?.players,
        instance?.playerList,
        instance?.userList,
        instance?.ref?.users,
        instance?.ref?.players
    );
    if (users.length) {
        return users;
    }
    const usersById = instance?.usersById || instance?.ref?.usersById;
    return usersById && typeof usersById === 'object'
        ? Object.values(usersById)
        : [];
}

export function GroupInstanceRows({ instances, currentUserId, endpoint = '' }) {
    const { t } = useTranslation();

    if (!instances.length) {
        return null;
    }

    async function launch(location) {
        if (!location) {
            return;
        }
        try {
            const opened = await tryOpenLaunchLocation(
                location,
                parseLocation(location).shortName || '',
                endpoint
            );
            if (opened) {
                toast.success(
                    t('dialog.group.generated.vrchat_launch_request_sent')
                );
                return;
            }
            openWorldDialog({
                worldId: parseLocation(location).worldId || location
            });
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.group.generated_toast.failed_to_launch_instance'
                      )
            );
        }
    }

    return (
        <EntityInfoBlock label={t('dialog.group.generated.instances')} full>
            <div className="mt-1 flex flex-col gap-2">
                {instances.map((instance, index) => {
                    const location = getInstanceLocation(instance);
                    const parsedLocation = parseLocation(location);
                    const users = getInstanceUsers(instance);
                    return (
                        <div
                            key={`${location || getInstanceTitle(instance)}:${index}`}
                            className="w-full"
                        >
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                                {location ? (
                                    <span className="text-muted-foreground min-w-0 truncate text-xs">
                                        <LocationWorld
                                            locationObject={{
                                                ...instance,
                                                ...(instance.ref || {}),
                                                tag: location,
                                                location
                                            }}
                                            currentUserId={currentUserId}
                                            worldDialogShortName={
                                                parsedLocation.shortName || ''
                                            }
                                            grouphint={
                                                instance.groupName ||
                                                instance.group?.name ||
                                                ''
                                            }
                                            instanceOwner={getInstanceOwnerId(
                                                instance
                                            )}
                                            instanceOwnerName={getInstanceOwnerName(
                                                instance
                                            )}
                                            playerCount={
                                                instance.playerCount ??
                                                instance.userCount ??
                                                instance.occupants ??
                                                users.length
                                            }
                                            capacity={
                                                instance.capacity ??
                                                instance.ref?.capacity ??
                                                undefined
                                            }
                                            hint={getInstanceTitle(instance)}
                                        />
                                    </span>
                                ) : null}
                                {location ? (
                                    <Button
                                        type="button"
                                        size="icon-sm"
                                        variant="ghost"
                                        aria-label="Launch instance"
                                        onClick={() => void launch(location)}
                                    >
                                        <PlayIcon data-icon="inline-start" />
                                    </Button>
                                ) : null}
                            </div>
                            {users.length ? (
                                <div className="mt-1 flex flex-wrap items-start">
                                    {users.map((user, userIndex) => (
                                        <Button
                                            key={`${user?.id || user?.userId || user?.displayName || 'user'}:${userIndex}`}
                                            type="button"
                                            variant="ghost"
                                            className="box-border h-auto w-44 justify-start p-1.5 text-left text-sm"
                                            onClick={() => {
                                                const userId =
                                                    user?.id ||
                                                    user?.userId ||
                                                    user?.user_id ||
                                                    user?.user?.id ||
                                                    user?.user?.userId;
                                                if (userId) {
                                                    openUserDialog({
                                                        userId,
                                                        title:
                                                            user?.displayName ||
                                                            user?.user
                                                                ?.displayName ||
                                                            undefined,
                                                        seedData:
                                                            user?.user || user
                                                    });
                                                }
                                            }}
                                        >
                                            <img
                                                src={userImage(
                                                    user,
                                                    true,
                                                    '64'
                                                )}
                                                alt=""
                                                className="mr-2.5 size-9 shrink-0 rounded-full object-cover"
                                            />
                                            <span className="min-w-0 flex-1 overflow-hidden">
                                                <span className="block truncate leading-5 font-medium">
                                                    {user?.displayName ||
                                                        user?.display_name ||
                                                        user?.username ||
                                                        user?.user
                                                            ?.displayName ||
                                                        user?.user?.username ||
                                                        'User'}
                                                </span>
                                                <span className="text-muted-foreground block truncate text-xs">
                                                    {user?.location ===
                                                    'traveling'
                                                        ? 'traveling'
                                                        : user?.status ||
                                                          user?.user?.status ||
                                                          ''}
                                                </span>
                                            </span>
                                        </Button>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </EntityInfoBlock>
    );
}
