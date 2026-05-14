import * as vscode from 'vscode';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// === Task Terminal Output Capture ===
const _taskOutputBuffers = new Map<string, string>();
const MAX_BUFFER_CHARS = 200_000;
let _captureInitialized = false;
let _terminalDataDisposable: vscode.Disposable | null = null;
let _terminalCloseDisposable: vscode.Disposable | null = null;

// Maps task label → terminal name (populated via onDidStartTask + onDidOpenTerminal)
const _taskToTerminal = new Map<string, string>();
// Queue of recently started task labels waiting to be matched to a terminal
const _pendingTaskLabels: Array<{ label: string; time: number }> = [];

function _stripAnsi(str: string): string {
    return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function _normalizeOutput(raw: string): string {
    let text = _stripAnsi(raw);
    // Handle carriage-return progress lines: keep only the last segment per line
    text = text.replace(/[^\n]*\r(?!\n)/g, '');
    return text;
}

interface TerminalMatch {
    name: string | null;
    ambiguous: boolean;
    candidates?: string[];
}

function _findTaskTerminal(label: string): TerminalMatch {
    // 1. Check explicit task→terminal mapping first (most accurate)
    const mapped = _taskToTerminal.get(label);
    if (mapped && _taskOutputBuffers.has(mapped)) {
        return { name: mapped, ambiguous: false };
    }

    const candidates: string[] = [];
    // Exact match patterns covering all known VS Code task terminal naming styles
    const exactPatterns = [
        `Task - ${label}`,
        `Task: ${label}`,
        `Task — ${label}`, // em-dash variant seen on some systems
        label,
    ];
    for (const [name] of _taskOutputBuffers) {
        if (exactPatterns.includes(name)) {
            return { name, ambiguous: false };
        }
        if (name.includes(label) || label.includes(name)) {
            candidates.push(name);
        }
    }
    if (candidates.length === 1) {
        return { name: candidates[0], ambiguous: false };
    }
    if (candidates.length > 1) {
        return { name: null, ambiguous: true, candidates };
    }
    return { name: null, ambiguous: false };
}

function _initCapture(): void {
    if (_captureInitialized) { return; }
    _captureInitialized = true;

    try {
        if (typeof vscode.window.onDidWriteTerminalData !== 'function') {
            return;
        }

        // Track task starts so we can associate them with terminals
        vscode.tasks.onDidStartTask(e => {
            const label = e.execution.task.name;
            _pendingTaskLabels.push({ label, time: Date.now() });
            // Expire entries older than 10s
            const cutoff = Date.now() - 10_000;
            while (_pendingTaskLabels.length > 0 && _pendingTaskLabels[0].time < cutoff) {
                _pendingTaskLabels.shift();
            }
        });

        // When a terminal opens shortly after a task starts, link them
        vscode.window.onDidOpenTerminal(terminal => {
            if (_pendingTaskLabels.length === 0) { return; }
            const now = Date.now();
            // Match the oldest pending task whose start is within 5s of now
            const idx = _pendingTaskLabels.findIndex(t => now - t.time < 5_000);
            if (idx !== -1) {
                const { label } = _pendingTaskLabels.splice(idx, 1)[0];
                _taskToTerminal.set(label, terminal.name);
            }
        });

        // Capture ALL terminal writes — matching happens at read time
        _terminalDataDisposable = vscode.window.onDidWriteTerminalData(e => {
            const name = e.terminal.name;
            let buf = _taskOutputBuffers.get(name) || '';
            buf += e.data;
            if (buf.length > MAX_BUFFER_CHARS) {
                buf = buf.slice(-MAX_BUFFER_CHARS);
            }
            _taskOutputBuffers.set(name, buf);
        });

        _terminalCloseDisposable = vscode.window.onDidCloseTerminal(t => {
            const name = t.name;
            // Keep buffer for 60s after terminal closes so read_task_output still works
            setTimeout(() => {
                if (_taskOutputBuffers.has(name)) {
                    _taskOutputBuffers.delete(name);
                }
            }, 60_000);
        });
    } catch {
        // Proposed API not available — degrade gracefully
        _captureInitialized = false;
    }
}

/**
 * Registers MCP task-related tools with the server.
 * @param server MCP server instance
 */
export function registerTaskTools(server: McpServer): void {
    // Initialize output capture
    _initCapture();

    // List available tasks
    server.tool(
        'list_tasks_code',
        `List all available VS Code tasks defined in tasks.json and by extensions.

        WHEN TO USE: Discovering available build, test, and dev tasks before running them.
        Returns task labels, types, sources, and groups.`,
        {},
        async (): Promise<CallToolResult> => {
            try {
                const tasks = await vscode.tasks.fetchTasks();
                const taskList = tasks.map(t => ({
                    label: t.name,
                    source: t.source,
                    group: t.group
                        ? (typeof t.group === 'string' ? t.group : t.group.id)
                        : undefined,
                    detail: t.detail || undefined,
                }));
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify(taskList, null, 2),
                    }],
                };
            } catch (error) {
                throw new Error(
                    `Failed to list tasks: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    );

    // Run a task by label
    server.tool(
        'run_task_code',
        `Run a VS Code task by its label (as defined in tasks.json or by extensions).

        WHEN TO USE: Running build tasks, dev servers, test suites, Docker commands, or any task
        defined in the project's tasks.json — just like pressing Ctrl+Shift+P > "Tasks: Run Task".

        The task runs in its own VS Code terminal with the configured presentation settings.
        For background/watch tasks, the tool returns immediately after starting.
        For finite tasks, it waits for completion and returns the exit code.`,
        {
            label: z.string().describe(
                'The label of the task to run (e.g., "dev: api-core", "docker: compose up")'
            ),
            waitForExit: z.boolean().optional().default(false).describe(
                'If true, wait for the task to finish and return exit code. ' +
                'If false (default), start the task and return immediately. ' +
                'Use false for background/watch tasks.'
            ),
        },
        async ({ label, waitForExit = false }): Promise<CallToolResult> => {
            try {
                const tasks = await vscode.tasks.fetchTasks();
                const task = tasks.find(t => t.name === label);
                if (!task) {
                    const available = tasks.map(t => t.name).join(', ');
                    throw new Error(
                        `Task "${label}" not found. Available tasks: ${available}`
                    );
                }

                const execution = await vscode.tasks.executeTask(task);

                if (!waitForExit) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: `Task "${label}" started successfully.`,
                        }],
                    };
                }

                // Wait for the task to finish
                const exitCode = await new Promise<number | string>(resolve => {
                    const timeout = setTimeout(() => {
                        resolve('timeout (60s)');
                    }, 60_000);

                    const disposable = vscode.tasks.onDidEndTaskProcess(e => {
                        if (e.execution === execution) {
                            clearTimeout(timeout);
                            disposable.dispose();
                            resolve(e.exitCode !== undefined ? e.exitCode : 'unknown' as string);
                        }
                    });
                });

                return {
                    content: [{
                        type: 'text' as const,
                        text: `Task "${label}" finished with exit code: ${exitCode}`,
                    }],
                };
            } catch (error) {
                throw new Error(
                    `Failed to run task "${label}": ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    );

    // Terminate a running task
    server.tool(
        'terminate_task_code',
        `Terminate a running VS Code task by its label.

        WHEN TO USE: Stopping background/watch tasks like dev servers, watchers, or long-running processes.`,
        {
            label: z.string().describe('The label of the running task to terminate'),
        },
        async ({ label }): Promise<CallToolResult> => {
            try {
                const executions = vscode.tasks.taskExecutions;
                const execution = executions.find(e => e.task.name === label);
                if (!execution) {
                    const running = executions.map(e => e.task.name).join(', ') || '(none)';
                    throw new Error(
                        `No running task "${label}" found. Running tasks: ${running}`
                    );
                }
                execution.terminate();
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Task "${label}" terminated.`,
                    }],
                };
            } catch (error) {
                throw new Error(
                    `Failed to terminate task "${label}": ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    );

    // Read task terminal output
    server.tool(
        'read_task_output_code',
        `Read the terminal output of a running or recently-finished VS Code task.

        WHEN TO USE: Checking build output, reading dev server logs, debugging task failures, monitoring task progress.
        Returns the last N lines of terminal output for the specified task.
        Output capture starts when the task is launched AFTER the MCP server starts.
        Only task terminals (prefixed "Task -") are captured.`,
        {
            label: z.string().describe(
                'The label of the task whose output to read (e.g., "dev: api-core")'
            ),
            tailLines: z.number().optional().default(50).describe(
                'Number of lines from the end to return (default: 50). Use -1 for all captured output.'
            ),
        },
        async ({ label, tailLines = 50 }): Promise<CallToolResult> => {
            try {
                if (typeof vscode.window.onDidWriteTerminalData !== 'function') {
                    throw new Error(
                        'read_task_output_code requires the onDidWriteTerminalData API which is not available ' +
                        'in this VS Code version. Try VS Code 1.93+ or VS Code Insiders with the ' +
                        'terminalDataWriteEvent proposed API enabled.'
                    );
                }

                const match = _findTaskTerminal(label);

                if (match.ambiguous) {
                    throw new Error(
                        `Multiple terminals match "${label}": ${match.candidates!.join(', ')}. ` +
                        'Please use a more specific label.'
                    );
                }

                if (!match.name) {
                    const available = [..._taskOutputBuffers.keys()];
                    if (available.length === 0) {
                        throw new Error(
                            'No task output captured yet. Output capture only works for tasks started ' +
                            `AFTER the MCP server. Try re-running the task "${label}" and then reading its output.`
                        );
                    }
                    throw new Error(
                        `No output found for task "${label}". Captured terminals: ${available.join(', ')}`
                    );
                }

                const rawOutput = _taskOutputBuffers.get(match.name) || '';
                const cleanOutput = _normalizeOutput(rawOutput);

                const lines = cleanOutput.split('\n');
                const totalLines = lines.length;
                const showAll = tailLines === -1;
                const slicedLines = showAll ? lines : lines.slice(-tailLines);
                const truncated = !showAll && totalLines > tailLines;

                const header = [
                    `Terminal: ${match.name}`,
                    `Buffer: ${rawOutput.length} chars`,
                    `Lines: ${totalLines} total${truncated ? `, showing last ${slicedLines.length}` : ''}`,
                ].join('\n');

                return {
                    content: [{
                        type: 'text' as const,
                        text: `${header}\n\n${slicedLines.join('\n')}`,
                    }],
                };
            } catch (error) {
                throw new Error(
                    `Failed to read task output: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    );

    // Clear captured task output
    server.tool(
        'clear_task_output_code',
        `Clear the captured terminal output buffer for a task, or all tasks.

        WHEN TO USE: Freeing memory, clearing stale output before re-running a task, or for privacy.`,
        {
            label: z.string().optional().describe(
                'Task label to clear. If omitted, clears ALL captured task output.'
            ),
        },
        async ({ label }): Promise<CallToolResult> => {
            try {
                if (!label) {
                    const count = _taskOutputBuffers.size;
                    _taskOutputBuffers.clear();
                    return {
                        content: [{
                            type: 'text' as const,
                            text: `Cleared output buffers for ${count} terminal(s).`,
                        }],
                    };
                }

                const match = _findTaskTerminal(label);
                if (match.ambiguous) {
                    throw new Error(
                        `Multiple terminals match "${label}": ${match.candidates!.join(', ')}. ` +
                        'Please use a more specific label.'
                    );
                }
                if (!match.name) {
                    throw new Error(`No captured output found for task "${label}".`);
                }

                _taskOutputBuffers.delete(match.name);
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Cleared output buffer for terminal "${match.name}".`,
                    }],
                };
            } catch (error) {
                throw new Error(
                    `Failed to clear task output: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    );
}
