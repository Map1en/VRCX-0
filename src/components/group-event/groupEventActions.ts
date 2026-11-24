import type { TFunction } from 'i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import vrchatToolsRepository from '@/repositories/vrchatToolsRepository';
import type { GroupCalendarEventRecord } from '@/repositories/vrchatToolsRepository';
import { copyTextToClipboard } from '@/services/clipboardService';
import {
    openCalendarFile,
    saveCalendarFile
} from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import { vrchatGroupCalendarUrl } from '@/shared/constants/vrchatWebUrls';

import { getEventGroupId, getEventId } from './groupEventFormat';

async function getCalendarIcs(event: GroupCalendarEventRecord, t: TFunction) {
    const groupId = getEventGroupId(event);
    const eventId = getEventId(event);
    if (!groupId || !eventId) {
        return '';
    }
    try {
        const content = await vrchatToolsRepository.getGroupCalendarIcs({
            groupId,
            eventId
        });
        const normalizedContent = String(content || '')
            .replace(/^﻿/, '')
            .trimStart();
        if (!normalizedContent.startsWith('BEGIN:VCALENDAR')) {
            toast.add({
                type: 'error',
                title: t(
                    'dialog.tools.error.failed_to_download_ics_file_invalid_icalendar_content'
                )
            });
            return '';
        }
        return normalizedContent;
    } catch (error) {
        toast.add({
            type: 'error',
            title: userFacingErrorMessage(
                error,
                t('host.tools_dialogs.toast.failed_to_download_ics_file')
            )
        });
        return '';
    }
}

export async function openCalendarEvent(
    event: GroupCalendarEventRecord,
    t: TFunction
) {
    const content = await getCalendarIcs(event, t);
    if (content) {
        await openCalendarFile(content);
    }
}

export async function downloadEventIcs(
    event: GroupCalendarEventRecord,
    t: TFunction
) {
    const content = await getCalendarIcs(event, t);
    if (!content) {
        return;
    }
    const eventId = getEventId(event);
    const fileName = `${eventId || 'group-event'}.ics`;
    try {
        await saveCalendarFile(fileName, content);
    } catch (error) {
        toast.add({
            type: 'error',
            title: userFacingErrorMessage(
                error,
                t('host.tools_dialogs.toast.failed_to_save_ics_file')
            )
        });
    }
}

export async function copyEventLink(
    event: GroupCalendarEventRecord,
    t: TFunction
) {
    const groupId = getEventGroupId(event);
    const eventId = getEventId(event);
    if (!groupId || !eventId) {
        return;
    }
    await copyTextToClipboard(vrchatGroupCalendarUrl(groupId, eventId), {
        successMessage: t('dialog.group_calendar.event_card.copied_event_link'),
        errorMessage: (error) =>
            userFacingErrorMessage(
                error,
                t('host.tools_dialogs.toast.failed_to_copy_event_link')
            )
    });
}
