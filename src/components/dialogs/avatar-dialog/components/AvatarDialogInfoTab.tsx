import type { TFunction } from 'i18next';
import { isValidElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { PlatformFileAnalysis } from '@/domain/entities/world';
import { formatDateFilter, timeToText } from '@/lib/dateTime';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import type { EconomyListingRecord } from '@/repositories/vrchatEconomyRepository';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';

import {
    EntityDialogTabContent,
    EntityInfoBlock,
    EntityInfoGrid,
    EntityMemoTextarea
} from '../../EntityDialogScaffold';
import type {
    AvatarPlatformInfo,
    AvatarTagGroups,
    AvatarViewRecord
} from '../avatarDialogTypes';
import { AvatarDialogListings } from './AvatarDialogListings';
import { AvatarDialogTagList } from './AvatarDialogTagList';

const EMPTY_VALUE = '\u2014';

const PLATFORM_ROWS = [
    { key: 'pc', label: 'pc_performance', analysisKey: 'standalonewindows' },
    { key: 'android', label: 'android_performance', analysisKey: 'android' },
    { key: 'ios', label: 'ios_performance', analysisKey: 'ios' }
] as const;

function getAttributes(
    avatar: AvatarViewRecord,
    hasImposter: boolean,
    imposterVersion: string,
    t: TFunction
): string[] {
    const styles = [avatar.styles?.primary, avatar.styles?.secondary]
        .filter(Boolean)
        .join(' / ');
    return [
        hasImposter
            ? `${t('dialog.avatar.tags.impostor')}${imposterVersion ? ` v${imposterVersion}` : ''}`
            : '',
        styles ? `${t('view.favorite.avatars.styles')} ${styles}` : '',
        avatar.unityPackageUrl || avatar.unityPackage?.url
            ? t('dialog.avatar.tags.future_proofing')
            : '',
        avatar.tags.some((tag) => /quest/i.test(tag))
            ? t('dialog.avatar.tags.fallback')
            : ''
    ].filter(Boolean);
}

export function AvatarDialogInfoTab({
    avatar,
    memo,
    detail,
    tags,
    platformInfo,
    fileAnalysis,
    hasImposter,
    imposterVersion,
    listings,
    avatarUrl,
    onOpenAuthor,
    onSaveMemo
}: {
    avatar: AvatarViewRecord;
    memo: string;
    detail: ReactNode;
    tags: AvatarTagGroups;
    platformInfo: AvatarPlatformInfo;
    fileAnalysis: PlatformFileAnalysis;
    hasImposter: boolean;
    imposterVersion: string;
    listings: EconomyListingRecord[];
    avatarUrl: string;
    onOpenAuthor(): void;
    onSaveMemo(value: string): void | Promise<void>;
}) {
    const { t } = useTranslation();

    const { localTags, contentTags, authorTags, otherTags } = tags;
    const attributes = getAttributes(avatar, hasImposter, imposterVersion, t);

    return (
        <EntityDialogTabContent value="info" forceMount>
            <EntityInfoGrid>
                {detail ? (
                    <Alert className="col-span-full">
                        <AlertDescription>
                            {isValidElement(detail)
                                ? detail
                                : userFacingErrorMessage(
                                      detail,
                                      t('common.error.failed_to_load_data')
                                  )}
                        </AlertDescription>
                    </Alert>
                ) : null}
                <AvatarDialogListings
                    listings={listings}
                    productId={
                        typeof avatar.productId === 'string'
                            ? avatar.productId
                            : ''
                    }
                    avatarUrl={avatarUrl}
                />
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
                    <span className="block truncate text-sm leading-snug font-medium">
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
                {PLATFORM_ROWS.filter(
                    ({ key }) => platformInfo?.[key]?.platform
                ).map(({ key, label, analysisKey }) => {
                    const rating = platformInfo[key].performanceRating;
                    return (
                        <EntityInfoBlock
                            key={key}
                            label={t(`dialog.avatar.info.${label}`)}
                            value={
                                [
                                    rating
                                        ? t(
                                              `dialog.avatar.performance.ranks.${rating}`,
                                              { defaultValue: rating }
                                          )
                                        : '',
                                    fileAnalysis[analysisKey]?._fileSize
                                ]
                                    .filter(Boolean)
                                    .join(' · ') || EMPTY_VALUE
                            }
                        />
                    );
                })}
                {attributes.length ? (
                    <EntityInfoBlock
                        label={t('dialog.avatar.info.attributes')}
                        full
                    >
                        <AvatarDialogTagList tags={attributes} />
                    </EntityInfoBlock>
                ) : null}
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
