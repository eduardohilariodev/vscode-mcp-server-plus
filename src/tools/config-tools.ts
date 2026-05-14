import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as vscode from 'vscode';
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { logger } from '../utils/logger';

/**
 * Split a dotted setting section into the configuration section and the leaf key.
 * Example: "editor.fontSize" → { section: "editor", key: "fontSize" }
 *          "editor.minimap.enabled" → { section: "editor.minimap", key: "enabled" }
 *          "singleKey" → { section: "", key: "singleKey" }
 */
function splitConfigSection(fullSection: string): { section: string; key: string } {
    const lastDot = fullSection.lastIndexOf('.');
    if (lastDot === -1) {
        return { section: '', key: fullSection };
    }
    return {
        section: fullSection.substring(0, lastDot),
        key: fullSection.substring(lastDot + 1),
    };
}

/**
 * Map a target string to a vscode.ConfigurationTarget enum value.
 */
function resolveConfigTarget(target: string): vscode.ConfigurationTarget {
    switch (target) {
        case 'global':
            return vscode.ConfigurationTarget.Global;
        case 'workspaceFolder':
            return vscode.ConfigurationTarget.WorkspaceFolder;
        case 'workspace':
        default:
            return vscode.ConfigurationTarget.Workspace;
    }
}

/**
 * Registers MCP configuration-related tools with the server.
 * @param server MCP server instance
 */
export function registerConfigTools(server: McpServer): void {

    // ── read_config_code ─────────────────────────────────────────────
    server.tool(
        'read_config_code',
        `Read a VS Code setting value by its full dotted key (e.g. "editor.fontSize").

        WHEN TO USE: Inspecting current editor/extension settings, verifying config before changes.
        Scope: "user", "workspace", "default", or "effective" (merged result, the default).`,
        {
            section: z.string().describe('Full dotted setting key (e.g. "editor.fontSize", "files.autoSave")'),
            scope: z.enum(['effective', 'user', 'workspace', 'default']).optional().default('effective')
                .describe('Which scope to read from. "effective" returns the merged value VS Code actually uses.'),
        },
        async ({ section, scope }): Promise<CallToolResult> => {
            logger.info(`[read_config] section=${section}, scope=${scope}`);

            try {
                const { section: cfgSection, key } = splitConfigSection(section);
                const config = vscode.workspace.getConfiguration(cfgSection || undefined);
                const inspect = config.inspect(key);

                if (!inspect) {
                    return {
                        content: [{ type: 'text' as const, text: `Setting "${section}" not found.` }],
                    };
                }

                let value: unknown;
                switch (scope) {
                    case 'user':
                        value = inspect.globalValue;
                        break;
                    case 'workspace':
                        value = inspect.workspaceValue;
                        break;
                    case 'default':
                        value = inspect.defaultValue;
                        break;
                    case 'effective':
                    default:
                        value = config.get(key);
                        break;
                }

                const result = {
                    setting: section,
                    scope,
                    value,
                    defaultValue: inspect.defaultValue,
                    userValue: inspect.globalValue,
                    workspaceValue: inspect.workspaceValue,
                };

                logger.info(`[read_config] Resolved value for "${section}": ${JSON.stringify(value)}`);
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`[read_config] Error: ${message}`);
                return {
                    content: [{ type: 'text' as const, text: `Error reading config "${section}": ${message}` }],
                    isError: true,
                };
            }
        },
    );

    // ── write_config_code ────────────────────────────────────────────
    server.tool(
        'write_config_code',
        `Write or update a VS Code setting.

        WHEN TO USE: Changing editor behaviour, toggling extension settings, adjusting formatting rules.
        The value parameter is a JSON string that will be parsed (e.g. "14", "true", "\\"onSave\\"").
        Pass null to remove/reset the setting to its default.`,
        {
            section: z.string().describe('Full dotted setting key (e.g. "editor.fontSize")'),
            value: z.string().describe('New value as a JSON string (e.g. "14", "true", "\\"onSave\\"", "null" to reset)'),
            target: z.enum(['global', 'workspace', 'workspaceFolder']).optional().default('workspace')
                .describe('Configuration target scope'),
        },
        async ({ section, value, target }): Promise<CallToolResult> => {
            logger.info(`[write_config] section=${section}, value=${value}, target=${target}`);

            try {
                const { section: cfgSection, key } = splitConfigSection(section);
                const config = vscode.workspace.getConfiguration(cfgSection || undefined);

                const oldValue = config.get(key);

                let parsedValue: unknown;
                try {
                    parsedValue = JSON.parse(value);
                } catch {
                    return {
                        content: [{ type: 'text' as const, text: `Invalid JSON value: ${value}` }],
                        isError: true,
                    };
                }

                // undefined tells VS Code to remove the override and fall back to default
                const writeValue = parsedValue === null ? undefined : parsedValue;
                const configTarget = resolveConfigTarget(target);

                await config.update(key, writeValue, configTarget);

                const newValue = vscode.workspace.getConfiguration(cfgSection || undefined).get(key);

                const result = {
                    setting: section,
                    target,
                    previousValue: oldValue,
                    newValue,
                    reset: parsedValue === null,
                };

                logger.info(`[write_config] Updated "${section}": ${JSON.stringify(oldValue)} → ${JSON.stringify(newValue)}`);
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`[write_config] Error: ${message}`);
                return {
                    content: [{ type: 'text' as const, text: `Error writing config "${section}": ${message}` }],
                    isError: true,
                };
            }
        },
    );

    // ── get_workspace_info_code ──────────────────────────────────────
    server.tool(
        'get_workspace_info_code',
        `Get workspace metadata: name, folders, trust status, storage path, multi-root status.

        WHEN TO USE: Understanding the current workspace layout, checking trust before running tasks.`,
        {},
        async (): Promise<CallToolResult> => {
            logger.info('[get_workspace_info] Tool called');

            try {
                const folders = vscode.workspace.workspaceFolders ?? [];

                const info = {
                    name: vscode.workspace.name ?? null,
                    isMultiRoot: folders.length > 1,
                    isTrusted: vscode.workspace.isTrusted,
                    workspaceFolders: folders.map((f) => ({
                        name: f.name,
                        uri: f.uri.fsPath,
                        index: f.index,
                    })),
                    workspaceFile: vscode.workspace.workspaceFile?.fsPath ?? null,
                };

                logger.info(`[get_workspace_info] name=${info.name}, folders=${folders.length}`);
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }],
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`[get_workspace_info] Error: ${message}`);
                return {
                    content: [{ type: 'text' as const, text: `Error getting workspace info: ${message}` }],
                    isError: true,
                };
            }
        },
    );

    // ── list_config_sections_code ────────────────────────────────────
    server.tool(
        'list_config_sections_code',
        `List known configuration sections from workspace and user settings.

        WHEN TO USE: Discovering available settings, exploring extension configuration.
        Returns top-level section keys from the effective configuration.
        Use the optional filter to narrow results by substring match.`,
        {
            filter: z.string().optional().describe('Optional substring to filter section names (case-insensitive)'),
        },
        async ({ filter }): Promise<CallToolResult> => {
            logger.info(`[list_config_sections] filter=${filter ?? '(none)'}`);

            try {
                // Collect sections from workspace settings files and the full config object
                const sections = new Set<string>();

                // Approach 1: inspect the root configuration object
                // getConfiguration() with no argument returns the full merged config.
                // The returned object exposes known keys when iterated via inspect.
                const rootConfig = vscode.workspace.getConfiguration();
                // The VS Code API doesn't enumerate keys directly, but the underlying
                // object can be serialised to reveal top-level sections.
                const configSnapshot = JSON.parse(JSON.stringify(rootConfig));
                for (const key of Object.keys(configSnapshot)) {
                    // Skip internal/private keys that start with underscore
                    if (!key.startsWith('_')) {
                        sections.add(key);
                    }
                }

                // Approach 2: read .vscode/settings.json to capture workspace-level keys
                if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                    const wsFolder = vscode.workspace.workspaceFolders[0];
                    const settingsUri = vscode.Uri.joinPath(wsFolder.uri, '.vscode', 'settings.json');
                    try {
                        const rawBytes = await vscode.workspace.fs.readFile(settingsUri);
                        const rawText = Buffer.from(rawBytes).toString('utf-8');
                        // Strip comments (simple single-line comment removal)
                        const cleaned = rawText.replace(/\/\/.*$/gm, '');
                        const parsed = JSON.parse(cleaned);
                        for (const key of Object.keys(parsed)) {
                            const topLevel = key.split('.')[0];
                            sections.add(topLevel);
                        }
                    } catch {
                        // settings.json may not exist — that's fine
                    }
                }

                let sortedSections = Array.from(sections).sort();

                if (filter) {
                    const lowerFilter = filter.toLowerCase();
                    sortedSections = sortedSections.filter((s) => s.toLowerCase().includes(lowerFilter));
                }

                const result = {
                    total: sortedSections.length,
                    filter: filter ?? null,
                    sections: sortedSections,
                };

                logger.info(`[list_config_sections] Found ${sortedSections.length} sections`);
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`[list_config_sections] Error: ${message}`);
                return {
                    content: [{ type: 'text' as const, text: `Error listing config sections: ${message}` }],
                    isError: true,
                };
            }
        },
    );
}
