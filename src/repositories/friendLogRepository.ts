import {
    commands,
    type FriendLogCurrentOutput
} from '@/platform/tauri/bindings';

export interface FriendLogCurrentRow {
    userId: string;
    displayName: string;
    trustLevel: string;
    friendNumber: number;
}

type FriendLogSourceRow = FriendLogCurrentOutput;

function normalizeFriendLogRow(row: FriendLogSourceRow): FriendLogCurrentRow {
    return {
        userId: row.userId,
        displayName: row.displayName,
        trustLevel: row.trustLevel || 'Visitor',
        friendNumber: row.friendNumber
    };
}

async function getFriendLogCurrent(
    userId: string
): Promise<FriendLogCurrentRow[]> {
    const rows = await commands.appFriendLogCurrentList(userId.trim());

    return rows.map(normalizeFriendLogRow).filter((row) => row.userId.trim());
}

const friendLogRepository = {
    getFriendLogCurrent
};

export default friendLogRepository;
