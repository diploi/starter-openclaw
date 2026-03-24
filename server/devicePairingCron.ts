import fs from 'node:fs';
import { gatewaySettings } from './constants.ts';
import { log } from 'node:console';
import ensureDir from './utils/ensureDir.ts';
import runWithOutput from './utils/runWithOutput.ts';

const { configPath, statePath, workspacePath, openclawScriptPath } = gatewaySettings;

const JOB_CONFIG_PATH = '/app/cron/device-pairing-auto-approve.json';
const STATE_PATH = '/app/cron/device-pairing-auto-approve.state.json';
const DEFAULT_INTERVAL_SECONDS = 30;
const DEFAULT_MAX_APPROVALS_PER_RUN = 20;

type Logger = (...args: unknown[]) => void;

type CronJob = {
    id?: string;
    enabled?: boolean;
    intervalSeconds?: number;
    maxApprovalsPerRun?: number;
};

type PairingState = {
    lastCheckedAt: string | null;
    lastSeenRequestIds: string[];
    lastApprovedRequestIds: string[];
    lastError: string | null;
};

type PairingRequest = {
    pending: Array<{
        requestId: string;
        deviceId: string;
        [key: string]: unknown;
    }>;
    paired: Array<{ [key: string]: unknown }>;
}

const openclawEnv = () => ({
    ...process.env,
    OPENCLAW_CONFIG_PATH: configPath,
    OPENCLAW_STATE_DIR: statePath,
    OPENCLAW_WORKSPACE_DIR: workspacePath,
});


const defaultState = (): PairingState => ({
    lastCheckedAt: null,
    lastSeenRequestIds: [],
    lastApprovedRequestIds: [],
    lastError: null,
});

const writeState = (state: PairingState) => {
    try {
        ensureDir(STATE_PATH);
        fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch {
        // best-effort
    }
};

const updateState = (patch: Partial<PairingState>) => {
    const next = {
        ...defaultState(),
        ...patch,
    };
    writeState(next);
};

const loadJob = (): Required<Pick<CronJob, 'enabled' | 'intervalSeconds' | 'maxApprovalsPerRun'>> => {
    try {
        log('[pairing-cron] loading job config');
        const raw = fs.readFileSync(JOB_CONFIG_PATH, 'utf8').trim();
        const job = (raw ? JSON.parse(raw) : {}) as CronJob;
        const intervalSeconds =
            typeof job?.intervalSeconds === 'number' && Number.isFinite(job.intervalSeconds) && job.intervalSeconds > 0
                ? Math.floor(job.intervalSeconds)
                : DEFAULT_INTERVAL_SECONDS;
        const maxApprovalsPerRun =
            typeof job?.maxApprovalsPerRun === 'number' && Number.isFinite(job.maxApprovalsPerRun) && job.maxApprovalsPerRun > 0
                ? Math.floor(job.maxApprovalsPerRun)
                : DEFAULT_MAX_APPROVALS_PER_RUN;
        return {
            enabled: job?.enabled !== false,
            intervalSeconds,
            maxApprovalsPerRun,
        };
    } catch {
        log('[pairing-cron] error loading job config');
        return {
            enabled: true,
            intervalSeconds: DEFAULT_INTERVAL_SECONDS,
            maxApprovalsPerRun: DEFAULT_MAX_APPROVALS_PER_RUN,
        };
    }
};

const ensureJobConfig = () => {
    try {
        fs.accessSync(JOB_CONFIG_PATH, fs.constants.F_OK);
    } catch {
        log('[pairing-cron] job config not found, creating default');

        ensureDir(JOB_CONFIG_PATH);
        const initial: Required<Pick<CronJob, 'enabled' | 'intervalSeconds' | 'maxApprovalsPerRun'>> = {
            enabled: true,
            intervalSeconds: DEFAULT_INTERVAL_SECONDS,
            maxApprovalsPerRun: DEFAULT_MAX_APPROVALS_PER_RUN,
        };
        fs.writeFileSync(JOB_CONFIG_PATH, `${JSON.stringify(initial, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    }
};


const runOpenclaw = async (args: string[]) => {
    const env = openclawEnv();
    let result = await runWithOutput('openclaw', args, { timeoutMs: 15_000, env });
    if (result.code === 127) {
        result = await runWithOutput('node', [openclawScriptPath, ...args], { timeoutMs: 15_000, env });
    }
    return result;
};

const parseRequestIds = (output: PairingRequest): string[] => {
    const ids = new Set<string>();
    const pendings = output?.pending ?? [];
    const pairs = output?.paired ?? [];
    if (!pendings.length) {
        return [];
    }

    for (const item of pendings) {
        ids.add(item.requestId);
    }

    log('[pairing-cron] extracted request IDs:', [...ids]);

    return [...ids];
};

const listPairingRequests = async (): Promise<string[]> => {
    let result = await runOpenclaw(['devices', 'list', '--json']);
    if (result.code !== 0) {
        result = await runOpenclaw(['devices', 'list']);
    }
    if (result.code !== 0) {
        throw new Error(`openclaw devices list failed (exit ${result.code}): ${result.output}`);
    }
    const raw = result.output.trim();
    const formattedRaw = JSON.parse(
        raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)
    );
    return parseRequestIds(formattedRaw as unknown as PairingRequest);
};

const approveRequest = async (requestId: string): Promise<void> => {
    log(`[pairing-cron] approving request ${requestId}`);
    const result = await runOpenclaw(['devices', 'approve', requestId]);
    if (result.code !== 0) {
        throw new Error(`openclaw devices approve ${requestId} failed (exit ${result.code}): ${result.output}`);
    }
};

export const startDevicePairingCron = (log: Logger): (() => void) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let stopped = false;

    const schedule = (delayMs: number) => {
        if (stopped) return;
        timer = setTimeout(() => {
            void tick();
        }, delayMs);
    };

    const tick = async () => {
        log('[pairing-cron] tick');
        if (stopped || running) return;
        running = true;

        try {
            const job = loadJob();
            if (!job.enabled) {
                updateState({
                    lastCheckedAt: new Date().toISOString(),
                    lastSeenRequestIds: [],
                    lastApprovedRequestIds: [],
                    lastError: null,
                });
                schedule(job.intervalSeconds * 1000);
                return;
            }

            const requestIds = await listPairingRequests();

            log(`[pairing-cron] found ${requestIds.length} pending request(s)`, requestIds.join(', '));

            updateState({
                lastCheckedAt: new Date().toISOString(),
                lastSeenRequestIds: requestIds,
                lastApprovedRequestIds: [],
                lastError: null,
            });

            const capped = requestIds.slice(0, job.maxApprovalsPerRun);
            const approved: string[] = [];

            for (const requestId of capped) {
                await approveRequest(requestId);
                approved.push(requestId);
            }

            if (approved.length > 0) {
                log(`[pairing-cron] approved ${approved.length} request(s):`, approved.join(', '));
            }

            log('[pairing-cron] tick complete');

            updateState({
                lastCheckedAt: new Date().toISOString(),
                lastSeenRequestIds: requestIds,
                lastApprovedRequestIds: approved,
                lastError: null,
            });

            schedule(job.intervalSeconds * 1000);
        } catch (err) {
            const nextInterval = loadJob().intervalSeconds;
            const message = String(err);
            log('[pairing-cron] error:', message);
            updateState({
                lastCheckedAt: new Date().toISOString(),
                lastSeenRequestIds: [],
                lastApprovedRequestIds: [],
                lastError: message,
            });
            schedule(nextInterval * 1000);
        } finally {
            running = false;
        }
    };

    ensureJobConfig();
    log('[pairing-cron] started');
    schedule(5000);

    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        log('[pairing-cron] stopped');
    };
};
