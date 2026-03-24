import childProcess from 'node:child_process';
const runWithOutput = async (
    cmd: string,
    args: string[],
    opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
) => {
    const timeoutMs = opts?.timeoutMs ?? 20_000;
    const env = opts?.env ?? process.env;
    return await new Promise<{ code: number; output: string }>((resolve) => {
        const proc = childProcess.spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env });

        let out = '';
        proc.stdout?.on('data', (d) => (out += d.toString('utf8')));
        proc.stderr?.on('data', (d) => (out += d.toString('utf8')));

        const timer = setTimeout(() => {
            try {
                proc.kill('SIGKILL');
            } catch {
                // ignore
            }
            resolve({ code: 124, output: out });
        }, timeoutMs);

        proc.on('error', (err) => {
            clearTimeout(timer);
            out += `\n[spawn error] ${String(err)}\n`;
            resolve({ code: 127, output: out });
        });

        proc.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code: code ?? 0, output: out });
        });
    });
};

export default runWithOutput;