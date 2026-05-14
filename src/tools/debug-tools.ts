import * as vscode from 'vscode';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as path from 'path';

/**
 * Convert a workspace-relative or absolute path to a vscode.Uri
 */
function resolveFileUri(filePath: string): vscode.Uri {
    if (path.isAbsolute(filePath)) {
        return vscode.Uri.file(filePath);
    }
    if (!vscode.workspace.workspaceFolders) {
        throw new Error('No workspace folder is open');
    }
    return vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, filePath);
}

/**
 * Registers MCP debug-related tools with the server
 * @param server MCP server instance
 */
export function registerDebugTools(server: McpServer): void {

    // ── list_debug_configs_code ──────────────────────────────────────────
    server.tool(
        'list_debug_configs_code',
        `List available debug / launch configurations from .vscode/launch.json for all workspace folders.

        WHEN TO USE: Discovering what debug configurations exist before starting a debug session.
        Returns configuration name, type, request mode (launch/attach), and preLaunchTask if defined.`,
        {},
        async (): Promise<CallToolResult> => {
            console.log('[list_debug_configs] Tool called');
            try {
                const folders = vscode.workspace.workspaceFolders;
                if (!folders || folders.length === 0) {
                    return {
                        content: [{ type: 'text' as const, text: 'No workspace folders are open.' }]
                    };
                }

                const configs: Array<{
                    folder: string;
                    name: string;
                    type: string;
                    request: string;
                    preLaunchTask?: string;
                }> = [];

                for (const folder of folders) {
                    const launchConfig = vscode.workspace.getConfiguration('launch', folder.uri);
                    const configurations = launchConfig.get<any[]>('configurations') || [];

                    for (const cfg of configurations) {
                        configs.push({
                            folder: folder.name,
                            name: cfg.name ?? '(unnamed)',
                            type: cfg.type ?? '(unknown)',
                            request: cfg.request ?? '(unknown)',
                            ...(cfg.preLaunchTask ? { preLaunchTask: cfg.preLaunchTask } : {})
                        });
                    }
                }

                if (configs.length === 0) {
                    return {
                        content: [{ type: 'text' as const, text: 'No launch configurations found in any workspace folder.' }]
                    };
                }

                let output = `Found ${configs.length} launch configuration(s):\n\n`;
                for (const c of configs) {
                    output += `• ${c.name}\n`;
                    output += `  Folder: ${c.folder}  |  Type: ${c.type}  |  Request: ${c.request}\n`;
                    if (c.preLaunchTask) {
                        output += `  Pre-launch task: ${c.preLaunchTask}\n`;
                    }
                    output += '\n';
                }

                console.log(`[list_debug_configs] Returning ${configs.length} configurations`);
                return { content: [{ type: 'text' as const, text: output }] };
            } catch (error) {
                console.error('[list_debug_configs] Error:', error);
                throw error;
            }
        }
    );

    // ── start_debug_code ────────────────────────────────────────────────
    server.tool(
        'start_debug_code',
        `Start a debug session using a named launch configuration.

        WHEN TO USE: Launching a debugger for a specific configuration from launch.json.
        Use noDebug=true to run without the debugger attached (equivalent to Ctrl+F5).`,
        {
            name: z.string().describe('The name of the launch configuration to start'),
            noDebug: z.boolean().optional().default(false).describe('If true, run without debugging (Ctrl+F5)')
        },
        async ({ name, noDebug = false }): Promise<CallToolResult> => {
            console.log(`[start_debug] Tool called: name="${name}", noDebug=${noDebug}`);
            try {
                const folder = vscode.workspace.workspaceFolders?.[0];

                const started = await vscode.debug.startDebugging(
                    folder,
                    name,
                    { noDebug }
                );

                if (!started) {
                    return {
                        content: [{ type: 'text' as const, text: `Failed to start debug session "${name}". Verify the configuration exists in launch.json.` }]
                    };
                }

                // Give VS Code a moment to spin up the session
                await new Promise(resolve => setTimeout(resolve, 500));

                const session = vscode.debug.activeDebugSession;
                const sessionInfo = session
                    ? `Session started — ID: ${session.id}, Name: ${session.name}, Type: ${session.type}`
                    : `Debug session "${name}" was started successfully.`;

                console.log(`[start_debug] ${sessionInfo}`);
                return { content: [{ type: 'text' as const, text: sessionInfo }] };
            } catch (error) {
                console.error('[start_debug] Error:', error);
                throw error;
            }
        }
    );

    // ── stop_debug_code ─────────────────────────────────────────────────
    server.tool(
        'stop_debug_code',
        `Stop the active debug session, or all debug sessions.

        WHEN TO USE: Ending a running debug session. Use all=true to stop every active session.`,
        {
            all: z.boolean().optional().default(false).describe('If true, stop all active debug sessions')
        },
        async ({ all = false }): Promise<CallToolResult> => {
            console.log(`[stop_debug] Tool called: all=${all}`);
            try {
                if (all) {
                    await vscode.debug.stopDebugging(undefined);
                    console.log('[stop_debug] Stopped all sessions');
                    return {
                        content: [{ type: 'text' as const, text: 'All debug sessions have been stopped.' }]
                    };
                }

                const session = vscode.debug.activeDebugSession;
                if (!session) {
                    return {
                        content: [{ type: 'text' as const, text: 'No active debug session to stop.' }]
                    };
                }

                const sessionName = session.name;
                await vscode.debug.stopDebugging(session);
                console.log(`[stop_debug] Stopped session "${sessionName}"`);
                return {
                    content: [{ type: 'text' as const, text: `Debug session "${sessionName}" has been stopped.` }]
                };
            } catch (error) {
                console.error('[stop_debug] Error:', error);
                throw error;
            }
        }
    );

    // ── set_breakpoint_code ─────────────────────────────────────────────
    server.tool(
        'set_breakpoint_code',
        `Set or remove a breakpoint at a specific file and line.

        WHEN TO USE: Adding conditional or unconditional breakpoints before debugging,
        or removing breakpoints that are no longer needed.
        Line numbers are 1-based.`,
        {
            path: z.string().describe('File path (relative to workspace or absolute)'),
            line: z.number().describe('Line number (1-based) where the breakpoint should be set'),
            remove: z.boolean().optional().default(false).describe('If true, remove the breakpoint instead of adding it'),
            condition: z.string().optional().describe('Optional conditional expression for the breakpoint')
        },
        async ({ path: filePath, line, remove = false, condition }): Promise<CallToolResult> => {
            console.log(`[set_breakpoint] Tool called: path="${filePath}", line=${line}, remove=${remove}, condition="${condition ?? ''}"`);
            try {
                const fileUri = resolveFileUri(filePath);

                if (remove) {
                    // Find and remove matching breakpoint
                    const matching = vscode.debug.breakpoints.filter(bp => {
                        if (bp instanceof vscode.SourceBreakpoint) {
                            return bp.location.uri.toString() === fileUri.toString()
                                && bp.location.range.start.line === line - 1;
                        }
                        return false;
                    });

                    if (matching.length === 0) {
                        return {
                            content: [{ type: 'text' as const, text: `No breakpoint found at ${filePath}:${line}.` }]
                        };
                    }

                    vscode.debug.removeBreakpoints(matching);
                    console.log(`[set_breakpoint] Removed ${matching.length} breakpoint(s) at ${filePath}:${line}`);
                    return {
                        content: [{ type: 'text' as const, text: `Removed ${matching.length} breakpoint(s) at ${filePath}:${line}.` }]
                    };
                }

                // Add a new breakpoint
                const position = new vscode.Position(line - 1, 0);
                const location = new vscode.Location(fileUri, position);
                const bp = new vscode.SourceBreakpoint(location, true, condition);

                vscode.debug.addBreakpoints([bp]);

                let text = `Breakpoint set at ${filePath}:${line}`;
                if (condition) {
                    text += ` (condition: ${condition})`;
                }

                console.log(`[set_breakpoint] ${text}`);
                return { content: [{ type: 'text' as const, text: `${text}.` }] };
            } catch (error) {
                console.error('[set_breakpoint] Error:', error);
                throw error;
            }
        }
    );

    // ── list_breakpoints_code ───────────────────────────────────────────
    server.tool(
        'list_breakpoints_code',
        `List all breakpoints currently set in the workspace.

        WHEN TO USE: Inspecting active breakpoints before or during a debug session.
        Returns file, line, enabled state, and optional condition/hitCondition for each SourceBreakpoint.`,
        {},
        async (): Promise<CallToolResult> => {
            console.log('[list_breakpoints] Tool called');
            try {
                const breakpoints = vscode.debug.breakpoints;

                if (breakpoints.length === 0) {
                    return {
                        content: [{ type: 'text' as const, text: 'No breakpoints are currently set.' }]
                    };
                }

                const items: Array<{
                    file: string;
                    line: number;
                    enabled: boolean;
                    condition?: string;
                    hitCondition?: string;
                }> = [];

                for (const bp of breakpoints) {
                    if (bp instanceof vscode.SourceBreakpoint) {
                        const uri = bp.location.uri;
                        let filePath: string;
                        if (vscode.workspace.workspaceFolders) {
                            filePath = path.relative(
                                vscode.workspace.workspaceFolders[0].uri.fsPath,
                                uri.fsPath
                            );
                        } else {
                            filePath = uri.fsPath;
                        }

                        items.push({
                            file: filePath,
                            line: bp.location.range.start.line + 1,
                            enabled: bp.enabled,
                            ...(bp.condition ? { condition: bp.condition } : {}),
                            ...(bp.hitCondition ? { hitCondition: bp.hitCondition } : {})
                        });
                    }
                }

                if (items.length === 0) {
                    return {
                        content: [{ type: 'text' as const, text: `${breakpoints.length} breakpoint(s) found, but none are source breakpoints.` }]
                    };
                }

                let output = `${items.length} source breakpoint(s):\n\n`;
                for (const item of items) {
                    output += `• ${item.file}:${item.line}`;
                    output += item.enabled ? '' : ' (disabled)';
                    if (item.condition) {
                        output += `  [condition: ${item.condition}]`;
                    }
                    if (item.hitCondition) {
                        output += `  [hitCondition: ${item.hitCondition}]`;
                    }
                    output += '\n';
                }

                console.log(`[list_breakpoints] Returning ${items.length} source breakpoints`);
                return { content: [{ type: 'text' as const, text: output }] };
            } catch (error) {
                console.error('[list_breakpoints] Error:', error);
                throw error;
            }
        }
    );

    // ── debug_evaluate_code ─────────────────────────────────────────────
    server.tool(
        'debug_evaluate_code',
        `Evaluate an expression in the active debug session context (REPL).

        WHEN TO USE: Inspecting variables, calling functions, or evaluating arbitrary expressions
        while paused at a breakpoint. Requires an active debug session.
        Optionally specify a frameId to evaluate in a particular stack frame.`,
        {
            expression: z.string().describe('The expression to evaluate in the debug context'),
            frameId: z.number().optional().describe('Optional stack frame ID to evaluate in')
        },
        async ({ expression, frameId }): Promise<CallToolResult> => {
            console.log(`[debug_evaluate] Tool called: expression="${expression}", frameId=${frameId ?? 'default'}`);
            try {
                const session = vscode.debug.activeDebugSession;
                if (!session) {
                    return {
                        content: [{ type: 'text' as const, text: 'No active debug session. Start a debug session first.' }]
                    };
                }

                const evalArgs: Record<string, unknown> = {
                    expression,
                    context: 'repl'
                };
                if (frameId !== undefined) {
                    evalArgs.frameId = frameId;
                }

                const response = await session.customRequest('evaluate', evalArgs);

                const resultText = response.result ?? String(response);
                const output = `Expression: ${expression}\nResult: ${resultText}`;

                console.log(`[debug_evaluate] Evaluation succeeded`);
                return { content: [{ type: 'text' as const, text: output }] };
            } catch (error) {
                console.error('[debug_evaluate] Error:', error);
                const message = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: 'text' as const, text: `Evaluation failed: ${message}` }]
                };
            }
        }
    );
}
