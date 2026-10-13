import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { alertsEnabled } from "@/lib/market-data";
import { sendWeeklyNewsSummary, sendSignUpEmail, checkStockAlerts, checkInactiveUsers } from "@/lib/inngest/functions";
import {
    taiwanCloseSync1430,
    taiwanCloseSync1800,
    taiwanHistorySync,
} from "@/lib/inngest/taiwan";

const taiwanAutoSyncEnabled = process.env.TAIWAN_AUTO_SYNC_ENABLED === 'true';
const taiwanHistoryEnabled = process.env.TAIWAN_HISTORY_ENABLED === 'true';

export const { GET, POST, PUT } = serve({
    client: inngest,
    // Price alerts are an OpenStock Cloud feature, so the checker only runs where they are on
    functions: [
        sendSignUpEmail,
        sendWeeklyNewsSummary,
        checkInactiveUsers,
        ...(alertsEnabled ? [checkStockAlerts] : []),
        ...(taiwanAutoSyncEnabled ? [taiwanCloseSync1430, taiwanCloseSync1800] : []),
        ...(taiwanHistoryEnabled ? [taiwanHistorySync] : []),
    ],
})