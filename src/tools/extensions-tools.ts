import * as vscode from 'vscode';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { logger } from '../utils/logger';

/**
 * Check whether an extension is built-in (ships with VS Code itself).
 */
function isBuiltinExtension(ext: vscode.Extension<unknown>): boolean {
    if (ext.packageJSON?.isBuiltin) {
        return true;
    }
    // Fallback: built-in extensions live inside the VS Code install directory
    return ext.extensionPath.includes('Microsoft VS Code');
}

/**
 * Registers MCP extension-management tools with the server.
 */
export function registerExtensionsTools(server: McpServer): void {

    // ── 1. list_extensions_code ──────────────────────────────────────────
    server.tool(
        'list_extensions_code',
        `List all installed VS Code extensions.

        WHEN TO USE: Discovering installed extensions, checking if a specific extension is present.
        Returns id, displayName, version, isActive, and publisher for each extension.
        Use filter to narrow results by name or id substring.`,
        {
            includeBuiltin: z.boolean().optional().default(false)
                .describe('Whether to include built-in extensions that ship with VS Code'),
            filter: z.string().optional()
                .describe('Optional name/id substring filter (case-insensitive)')
        },
        async ({ includeBuiltin, filter }): Promise<CallToolResult> => {
            logger.info(`[list_extensions] includeBuiltin=${includeBuiltin}, filter=${filter ?? 'none'}`);

            try {
                let extensions = vscode.extensions.all;

                if (!includeBuiltin) {
                    extensions = extensions.filter(ext => !isBuiltinExtension(ext));
                }

                if (filter) {
                    const lowerFilter = filter.toLowerCase();
                    extensions = extensions.filter(ext => {
                        const id = ext.id.toLowerCase();
                        const displayName = (ext.packageJSON?.displayName ?? '').toLowerCase();
                        return id.includes(lowerFilter) || displayName.includes(lowerFilter);
                    });
                }

                const items = extensions.map(ext => ({
                    id: ext.id,
                    displayName: ext.packageJSON?.displayName ?? ext.id,
                    version: ext.packageJSON?.version ?? 'unknown',
                    isActive: ext.isActive,
                    publisher: ext.packageJSON?.publisher ?? 'unknown'
                }));

                items.sort((a, b) => a.id.localeCompare(b.id));

                const text = items.length === 0
                    ? 'No extensions found matching the criteria.'
                    : `Found ${items.length} extension(s):\n\n${JSON.stringify(items, null, 2)}`;

                logger.info(`[list_extensions] Returning ${items.length} extension(s)`);
                return { content: [{ type: 'text' as const, text }] };
            } catch (error) {
                logger.error(`[list_extensions] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );

    // ── 2. get_extension_info_code ───────────────────────────────────────
    server.tool(
        'get_extension_info_code',
        `Get detailed information about a specific VS Code extension.

        WHEN TO USE: Checking extension status, inspecting activation events, understanding what an extension contributes.
        Requires the full extension identifier (e.g. "publisher.extension-name").`,
        {
            id: z.string().describe('Extension identifier (e.g. "dbaeumer.vscode-eslint")')
        },
        async ({ id }): Promise<CallToolResult> => {
            logger.info(`[get_extension_info] id=${id}`);

            try {
                const ext = vscode.extensions.getExtension(id);

                if (!ext) {
                    return {
                        content: [{ type: 'text' as const, text: `Extension "${id}" not found. Make sure to use the full identifier (publisher.name).` }]
                    };
                }

                const pkg = ext.packageJSON ?? {};
                const contributesKeys = pkg.contributes ? Object.keys(pkg.contributes) : [];

                const info = {
                    id: ext.id,
                    displayName: pkg.displayName ?? ext.id,
                    version: pkg.version ?? 'unknown',
                    description: pkg.description ?? '',
                    isActive: ext.isActive,
                    extensionPath: ext.extensionPath,
                    packageJSON: {
                        activationEvents: pkg.activationEvents ?? [],
                        contributesKeys
                    }
                };

                logger.info(`[get_extension_info] Found extension: ${ext.id} (active=${ext.isActive})`);
                return { content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }] };
            } catch (error) {
                logger.error(`[get_extension_info] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );

    // ── 3. install_extension_code ────────────────────────────────────────
    server.tool(
        'install_extension_code',
        `Install a VS Code extension from the marketplace.

        WHEN TO USE: Adding new extensions to the workspace.
        A window reload may be required for the extension to activate.`,
        {
            id: z.string().describe('Extension identifier to install (e.g. "dbaeumer.vscode-eslint")')
        },
        async ({ id }): Promise<CallToolResult> => {
            logger.info(`[install_extension] Installing extension: ${id}`);

            try {
                await vscode.commands.executeCommand('workbench.extensions.installExtension', id);

                const text = `Extension "${id}" installation initiated successfully. A window reload may be required for the extension to fully activate.`;
                logger.info(`[install_extension] ${text}`);
                return { content: [{ type: 'text' as const, text }] };
            } catch (error) {
                logger.error(`[install_extension] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );

    // ── 4. uninstall_extension_code ──────────────────────────────────────
    server.tool(
        'uninstall_extension_code',
        `Uninstall a VS Code extension.

        WHEN TO USE: Removing extensions that are no longer needed.
        A window reload may be required to complete the uninstallation.`,
        {
            id: z.string().describe('Extension identifier to uninstall (e.g. "dbaeumer.vscode-eslint")')
        },
        async ({ id }): Promise<CallToolResult> => {
            logger.info(`[uninstall_extension] Uninstalling extension: ${id}`);

            try {
                await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', id);

                const text = `Extension "${id}" uninstallation initiated successfully. A window reload may be required to complete removal.`;
                logger.info(`[uninstall_extension] ${text}`);
                return { content: [{ type: 'text' as const, text }] };
            } catch (error) {
                logger.error(`[uninstall_extension] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );

    // ── 5. enable_extension_code ─────────────────────────────────────────
    server.tool(
        'enable_extension_code',
        `Enable or disable a VS Code extension.

        WHEN TO USE: Toggling extensions on or off without installing/uninstalling.
        A window reload may be required for changes to take effect.`,
        {
            id: z.string().describe('Extension identifier (e.g. "dbaeumer.vscode-eslint")'),
            enable: z.boolean().describe('true to enable, false to disable the extension')
        },
        async ({ id, enable }): Promise<CallToolResult> => {
            const action = enable ? 'Enabling' : 'Disabling';
            logger.info(`[enable_extension] ${action} extension: ${id}`);

            try {
                const command = enable
                    ? 'workbench.extensions.enableExtension'
                    : 'workbench.extensions.disableExtension';

                await vscode.commands.executeCommand(command, id);

                const text = `Extension "${id}" ${enable ? 'enabled' : 'disabled'} successfully. A window reload may be required for changes to take effect.`;
                logger.info(`[enable_extension] ${text}`);
                return { content: [{ type: 'text' as const, text }] };
            } catch (error) {
                logger.error(`[enable_extension] Error: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }
    );
}
