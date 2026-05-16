// @ts-nocheck
import { isValidElement } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateFilter, timeToText } from '@/lib/dateTime.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';

import {
    EntityDialogTabContent,
    EntityInfoBlock,
    EntityInfoGrid,
    EntityMemoTextarea
} from '../../EntityDialogScaffold';
import { AvatarDialogTagList } from './AvatarDialogTagList';

const EMPTY_VALUE = '\u2014';

function getPlatformSummary(platformInfo) {
    return [
        platformInfo?.pc?.platform
            ? `PC ${platformInfo.pc.performanceRating || ''}`
            : '',
        platformInfo?.android?.platform
            ? `Android ${platformInfo.android.performanceRating || ''}`
            : '',
        platformInfo?.ios?.platform
            ? `iOS ${platformInfo.ios.performanceRating || ''}`
            : ''
    ]
        .filter(Boolean)
        .join(', ');
}

export function AvatarDialogInfoTab({
    avatar,
    memo,
    detail,
    tags,
    platformInfo,
    onOpenAuthor,
    onSaveMemo
}) {
    const { t } = useTranslation();

    const { localTags, contentTags, authorTags, otherTags } = tags;
    const platformSummary = getPlatformSummary(platformInfo);

    return (
        <EntityDialogTabContent value="info" forceMount>
            <EntityInfoGrid>
                {detail ? (
                    <Alert className="w-full">
                        <AlertDescription>
                            {isValidElement(detail)
                                ? detail
                                : userFacingErrorMessage(
                                      detail,
                                      'The requested data could not be loaded.'
                                  )}
                        </AlertDescription>
                    </Alert>
                ) : null}
                <EntityMemoTextarea
                    label={t('dialog.avatar.info.memo')}
                    value={memo}
                    placeholder={t('dialog.avatar.info.memo_placeholder')}
                    onSave={onSaveMemo}
                />
                <EntityInfoBlock
                    label={t('table.import.author')}
                    onClick={avatar.authorId ? onOpenAuthor : undefined}
                >
                    <span className="block truncate text-xs">
                        {avatar.authorName || EMPTY_VALUE}
                    </span>
                </EntityInfoBlock>
                <EntityInfoBlock
                    label={t('dialog.avatar.info.created_at')}
                    value={
                        avatar.created_at || avatar.createdAt
                            ? formatDateFilter(
                                  avatar.created_at || avatar.createdAt,
                                  'long'
                              )
                            : EMPTY_VALUE
                    }
                />
                <EntityInfoBlock
                    label={t('dialog.avatar.info.last_updated')}
                    value={
                        avatar.updated_at || avatar.updatedAt
                            ? formatDateFilter(
                                  avatar.updated_at || avatar.updatedAt,
                                  'long'
                              )
                            : EMPTY_VALUE
                    }
                />
                <EntityInfoBlock
                    label={t('dialog.avatar.info.version')}
                    value={
                        avatar.version ? String(avatar.version) : EMPTY_VALUE
                    }
                />
                <EntityInfoBlock
                    label={t('dialog.avatar.info.time_spent')}
                    value={
                        avatar.$timeSpent
                            ? timeToText(avatar.$timeSpent)
                            : EMPTY_VALUE
                    }
                />
                <EntityInfoBlock label={t('dialog.avatar.info.platform')} full>
                    <span className="block text-xs whitespace-normal">
                        {platformSummary || EMPTY_VALUE}
                    </span>
                </EntityInfoBlock>
                {localTags.length ? (
                    <EntityInfoBlock
                        label={t('dialog.avatar.label.local_tags')}
                        full
                    >
                        <AvatarDialogTagList
                            tags={localTags.map((entry) => entry.tag)}
                        />
                    </EntityInfoBlock>
                ) : null}
                {contentTags.length ? (
                    <EntityInfoBlock label={t('dialog.avatar.info.tags')} full>
                        <AvatarDialogTagList
                            tags={contentTags}
                            trimPrefix="content_"
                        />
                    </EntityInfoBlock>
                ) : null}
                {authorTags.length ? (
                    <EntityInfoBlock
                        label={t('dialog.world.info.author_tags')}
                        full
                    >
                        <AvatarDialogTagList
                            tags={authorTags}
                            trimPrefix="author_tag_"
                        />
                    </EntityInfoBlock>
                ) : null}
                {otherTags.length ? (
                    <EntityInfoBlock
                        label={t('dialog.avatar.label.vrchat_tags')}
                        full
                    >
                        <AvatarDialogTagList tags={otherTags} />
                    </EntityInfoBlock>
                ) : null}
            </EntityInfoGrid>
        </EntityDialogTabContent>
    );
}
