import { ShieldUserIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { hasGroupModerationPermission } from '@/components/dialogs/group-dialog/groupDialogUtils';
import { GroupModerationWorkspace } from '@/components/dialogs/group-dialog/GroupModerationWorkspace';
import { GroupModerationGroupIcon } from '@/components/hosts/tools-dialogs/group-moderation/GroupModerationGroupIcon';
import { useModeratableGroups } from '@/components/hosts/tools-dialogs/group-moderation/useModeratableGroups';
import {
    EmptyState,
    LoadingState,
    PageBody,
    PageHeader,
    PageScaffold,
    PageTitle
} from '@/components/layout/PageScaffold';
import { FadeInImage } from '@/components/media/FadeInImage';
import type { GroupProfileRecord } from '@/domain/entities/profileEntities';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import type { UserGroupsOverviewGroup } from '@/platform/tauri/bindings';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { ScrollArea } from '@/ui/shadcn/scroll-area';

type ProfileStatus = 'idle' | 'loading' | 'ready' | 'error';

function GroupModerationRail({
    activeGroupId,
    groups,
    onSelectGroup,
    status,
    error,
    permissionsDegraded,
    onRetry
}: {
    activeGroupId: string;
    groups: UserGroupsOverviewGroup[];
    onSelectGroup: (groupId: string) => void;
    status: ProfileStatus;
    error: string;
    permissionsDegraded: boolean;
    onRetry: () => void;
}) {
    const { t } = useTranslation();

    return (
        <div className="bg-muted/30 flex h-full w-60 shrink-0 flex-col border-r">
            <div className="shrink-0 px-3 py-2.5">
                <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                    {t('host.tools_dialogs.group_moderation.rail_title')}
                </span>
            </div>
            {permissionsDegraded ? (
                <p className="text-muted-foreground px-3 pb-2 text-xs">
                    {t(
                        'host.tools_dialogs.group_moderation.permissions_degraded'
                    )}
                </p>
            ) : null}
            {status === 'loading' ? (
                <LoadingState
                    variant="panel"
                    className="flex-1"
                    label={t('host.tools_dialogs.group_moderation.loading')}
                />
            ) : status === 'error' ? (
                <EmptyState
                    variant="panel"
                    className="flex-1"
                    description={error}
                >
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={onRetry}
                    >
                        {t('common.action.retry')}
                    </Button>
                </EmptyState>
            ) : groups.length ? (
                <ScrollArea className="flex-1">
                    <div className="flex flex-col gap-1 p-1.5">
                        {groups.map((group) => (
                            <Button
                                key={group.groupId}
                                type="button"
                                variant="ghost"
                                className={cn(
                                    'h-auto justify-start gap-2.5 px-2.5 py-2',
                                    group.groupId === activeGroupId &&
                                        'bg-accent text-accent-foreground'
                                )}
                                onClick={() => onSelectGroup(group.groupId)}
                            >
                                <GroupModerationGroupIcon group={group} />
                                <span className="min-w-0 flex-1 text-left">
                                    <span className="block truncate text-sm font-semibold">
                                        {group.name || group.groupId}
                                    </span>
                                    {typeof group.memberCount === 'number' ? (
                                        <span className="text-muted-foreground block truncate text-xs">
                                            {t(
                                                'host.tools_dialogs.group_moderation.member_count',
                                                { count: group.memberCount }
                                            )}
                                        </span>
                                    ) : null}
                                </span>
                            </Button>
                        ))}
                    </div>
                </ScrollArea>
            ) : (
                <EmptyState
                    variant="panel"
                    className="flex-1"
                    title={t('host.tools_dialogs.group_moderation.empty_title')}
                    description={t(
                        'host.tools_dialogs.group_moderation.empty_description'
                    )}
                />
            )}
        </div>
    );
}

function GroupModerationMain({
    endpoint,
    groupId,
    profile,
    status,
    error,
    onRetry
}: {
    endpoint: string;
    groupId: string;
    profile: GroupProfileRecord | null;
    status: ProfileStatus;
    error: string;
    onRetry: () => void;
}) {
    const { t } = useTranslation();

    if (!groupId) {
        return (
            <EmptyState
                className="flex-1"
                title={t(
                    'host.tools_dialogs.group_moderation.select_a_group_title'
                )}
                description={t(
                    'host.tools_dialogs.group_moderation.select_a_group_description'
                )}
            />
        );
    }

    if (status === 'loading') {
        return (
            <LoadingState
                className="flex-1"
                label={t('host.tools_dialogs.group_moderation.loading')}
            />
        );
    }

    if (status === 'error' || !profile) {
        return (
            <EmptyState
                className="flex-1"
                description={
                    error ||
                    t(
                        'host.tools_dialogs.toast.failed_to_open_group_moderation'
                    )
                }
            >
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onRetry}
                >
                    {t('common.action.retry')}
                </Button>
            </EmptyState>
        );
    }

    const iconUrl = profile.iconUrl
        ? convertFileUrlToImageUrl(profile.iconUrl, 128)
        : '';
    const canModerate = hasGroupModerationPermission(profile);

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
            <PageHeader className="mb-3 flex-row items-center gap-3 p-0">
                <span className="bg-muted flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border">
                    {iconUrl ? (
                        <FadeInImage
                            src={iconUrl}
                            alt=""
                            className="size-full object-cover"
                            fallback={
                                <ShieldUserIcon className="text-muted-foreground size-4" />
                            }
                        />
                    ) : (
                        <ShieldUserIcon className="text-muted-foreground size-4" />
                    )}
                </span>
                <div className="min-w-0">
                    <PageTitle className="truncate">
                        {profile.name || profile.id}
                    </PageTitle>
                    {canModerate ? (
                        <p className="text-muted-foreground truncate text-xs tabular-nums">
                            {t(
                                'host.tools_dialogs.group_moderation.member_online_count',
                                {
                                    members: profile.memberCount,
                                    online: profile.onlineMemberCount
                                }
                            )}
                        </p>
                    ) : null}
                </div>
            </PageHeader>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <GroupModerationWorkspace group={profile} endpoint={endpoint} />
            </div>
        </div>
    );
}

export function GroupModerationPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { groupId = '' } = useParams();
    const currentUserId =
        useRuntimeStore((state) => state.auth.currentUserId) || '';
    const endpoint =
        useRuntimeStore((state) => state.auth.currentUserEndpoint) || '';

    const {
        status: listStatus,
        error: listError,
        groups,
        permissionsDegraded,
        reload: reloadList
    } = useModeratableGroups({ currentUserId, endpoint });

    const [profileStatus, setProfileStatus] = useState<ProfileStatus>('idle');
    const [profileError, setProfileError] = useState('');
    const [profile, setProfile] = useState<GroupProfileRecord | null>(null);
    const [profileReloadToken, setProfileReloadToken] = useState(0);

    useEffect(() => {
        if (!groupId) {
            setProfile(null);
            setProfileStatus('idle');
            setProfileError('');
            return;
        }

        let active = true;
        setProfileStatus('loading');
        setProfileError('');
        groupProfileRepository
            .getGroupProfile({ groupId })
            .then((nextProfile) => {
                if (!active) {
                    return;
                }
                setProfile(nextProfile);
                setProfileStatus('ready');
            })
            .catch((requestError: unknown) => {
                if (!active) {
                    return;
                }
                setProfileStatus('error');
                setProfileError(
                    userFacingErrorMessage(
                        requestError,
                        t(
                            'host.tools_dialogs.toast.failed_to_open_group_moderation'
                        )
                    )
                );
            });

        return () => {
            active = false;
        };
    }, [groupId, endpoint, profileReloadToken, t]);

    return (
        <PageScaffold className="group-moderation" flushBottom>
            <PageBody className="min-h-0 flex-1 flex-row gap-0 overflow-hidden">
                <GroupModerationRail
                    activeGroupId={groupId}
                    groups={groups}
                    status={listStatus}
                    error={listError}
                    permissionsDegraded={permissionsDegraded}
                    onRetry={reloadList}
                    onSelectGroup={(nextGroupId) =>
                        navigate(`/tools/group-moderation/${nextGroupId}`)
                    }
                />
                <GroupModerationMain
                    endpoint={endpoint}
                    groupId={groupId}
                    profile={profile}
                    status={profileStatus}
                    error={profileError}
                    onRetry={() => setProfileReloadToken((value) => value + 1)}
                />
            </PageBody>
        </PageScaffold>
    );
}
