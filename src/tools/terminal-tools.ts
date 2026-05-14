import * as vscode from 'vscode';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { logger } from '../utils/logger';

/**
 * Find a terminal by its name.
 * @throws Error if no terminal with that name exists
 */
function findTerminalByName(name: string): vscode.Terminal {
    const terminal = vscode.window.terminals.find(t => t.name === name);
    if (!terminal) {
        const available = vscode.window.terminals.map(t => t.name).join(', ') || '(none)';
        throw new Error(`Terminal "${name}" not found. Available terminals: ${available}`);
    }
    return terminal;
}

export function registerTerminalTools(server: McpServer): void {
    // --- list_terminals_code ---
    server.tool(
        'list_terminals_code',
        'List all active terminals in VS Code, including name, process ID, index, and active status.',
        {},
        async (): Promise<CallToolResult> => {
            logger.info('[list_terminals] Tool called');

            try {
                const terminals = vscode.window.terminals;

                if (terminals.length === 0) {
                    return {
                        content: [{ type: 'text' as const, text: 'No active terminals.' }]
                    };
                }

                const activeTerminal = vscode.window.activeTerminal;

                const entries = await Promise.all(
                    terminals.map(async (terminal, index) => {
                        let pid: number | undefined;
                        try {
                            pid = await terminal.processId;
                        } catch {
                            // processId may be unavailable
                        }

                        return {
                            index,
                            name: terminal.name,
                            processId: pid ?? null,
                            isActive: terminal === activeTerminal
                        };
                    })
                );

                const text = JSON.stringify(entries, null, 2);
                logger.info(`[list_terminals] Found ${entries.length} terminal(s)`);
                return {
                    content: [{ type: 'text' as const, text }]
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`[list_terminals] Error: ${message}`);
                throw error;
            }
        }
    );

    // --- create_terminal_code ---
    server.tool(
        'create_terminal_code',
        'Create a new named terminal in VS Code with optional working directory, environment variables, and shell path.',
        {
            name: z.string().describe('The name for the new terminal'),
            cwd: z.string().optional().describe('Optional working directory for the terminal'),
            env: z.string().optional().describe('Optional environment variables as a JSON string (e.g. \'{"KEY":"value"}\')'),
            shellPath: z.string().optional().describe('Optional path to a custom shell executable')
        },
        async ({ name, cwd, env, shellPath }): Promise<CallToolResult> => {
            logger.info(`[create_terminal] Tool called with name="${name}", cwd=${cwd ?? 'default'}, shellPath=${shellPath ?? 'default'}`);

            try {
                let parsedEnv: Record<string, string> | undefined;
                if (env) {
                    try {
                        parsedEnv = JSON.parse(env);
                    } catch {
                        throw new Error(`Invalid JSON for env parameter: ${env}`);
                    }
                }

                const options: vscode.TerminalOptions = { name };
                if (cwd) { options.cwd = cwd; }
                if (parsedEnv) { options.env = parsedEnv; }
                if (shellPath) { options.shellPath = shellPath; }

                vscode.window.createTerminal(options);

                const text = `Terminal "${name}" created successfully.`;
                logger.info(`[create_terminal] ${text}`);
                return {
                    content: [{ type: 'text' as const, text }]
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`[create_terminal] Error: ${message}`);
                throw error;
            }
        }
    );

    // --- send_terminal_text_code ---
    server.tool(
        'send_terminal_text_code',
        'Send text or a command to an existing terminal identified by name.',
        {
            name: z.string().describe('The name of the target terminal'),
            text: z.string().describe('The text or command to send'),
            addNewLine: z.boolean().optional().default(true).describe('Whether to append a newline (default: true)')
        },
        async ({ name, text, addNewLine = true }): Promise<CallToolResult> => {
            logger.info(`[send_terminal_text] Tool called with name="${name}", addNewLine=${addNewLine}`);

            try {
                const terminal = findTerminalByName(name);
                terminal.sendText(text, addNewLine);

                const result = `Text sent to terminal "${name}".`;
                logger.info(`[send_terminal_text] ${result}`);
                return {
                    content: [{ type: 'text' as const, text: result }]
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`[send_terminal_text] Error: ${message}`);
                throw error;
            }
        }
    );

    // --- close_terminal_code ---
    server.tool(
        'close_terminal_code',
        'Close and dispose of a terminal identified by name.',
        {
            name: z.string().describe('The name of the terminal to close')
        },
        async ({ name }): Promise<CallToolResult> => {
            logger.info(`[close_terminal] Tool called with name="${name}"`);

            try {
                const terminal = findTerminalByName(name);
                terminal.dispose();

                const result = `Terminal "${name}" closed.`;
                logger.info(`[close_terminal] ${result}`);
                return {
                    content: [{ type: 'text' as const, text: result }]
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`[close_terminal] Error: ${message}`);
                throw error;
            }
        }
    );

    // --- show_terminal_code ---
    server.tool(
        'show_terminal_code',
        'Bring a terminal to focus in the VS Code UI.',
        {
            name: z.string().describe('The name of the terminal to show'),
            preserveFocus: z.boolean().optional().default(true).describe('If true, the terminal will not steal focus from the editor (default: true)')
        },
        async ({ name, preserveFocus = true }): Promise<CallToolResult> => {
            logger.info(`[show_terminal] Tool called with name="${name}", preserveFocus=${preserveFocus}`);

            try {
                const terminal = findTerminalByName(name);
                terminal.show(preserveFocus);

                const result = `Terminal "${name}" is now visible${preserveFocus ? ' (focus preserved)' : ''}.`;
                logger.info(`[show_terminal] ${result}`);
                return {
                    content: [{ type: 'text' as const, text: result }]
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`[show_terminal] Error: ${message}`);
                throw error;
            }
        }
    );
}
