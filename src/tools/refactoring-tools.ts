import * as vscode from 'vscode';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as path from 'path';
import { logger } from '../utils/logger';

/**
 * Resolves a file path (absolute or workspace-relative) to a VS Code Uri.
 */
function resolveFilePath(filePath: string): vscode.Uri {
    if (path.isAbsolute(filePath)) {
        return vscode.Uri.file(filePath);
    }

    if (!vscode.workspace.workspaceFolders) {
        throw new Error('No workspace folder is open');
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    return vscode.Uri.joinPath(workspaceFolder.uri, filePath);
}

/**
 * Converts a workspace URI to a path relative to the workspace root.
 */
function uriToWorkspacePath(uri: vscode.Uri): string {
    if (!vscode.workspace.workspaceFolders) {
        return uri.fsPath;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    return path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
}

/**
 * Registers MCP refactoring tools with the server.
 */
export function registerRefactoringTools(server: McpServer): void {

    // ── rename_symbol_code ──────────────────────────────────────────────
    server.tool(
        'rename_symbol_code',
        `Renames a symbol across the workspace using VS Code's rename provider.

        WHEN TO USE: Renaming functions, variables, classes, or any symbol that may be referenced in multiple files.
        
        Requires exact symbol name and line number. If symbol not found on line, returns clear message.`,
        {
            path: z.string().describe('The path to the file containing the symbol'),
            line: z.number().describe('The line number of the symbol (1-based)'),
            character: z.number().describe('The character position of the symbol (1-based)'),
            newName: z.string().describe('The new name for the symbol')
        },
        async ({ path: filePath, line, character, newName }): Promise<CallToolResult> => {
            logger.info(`[rename_symbol] path=${filePath}, line=${line}, char=${character}, newName=${newName}`);

            try {
                const uri = resolveFilePath(filePath);
                const document = await vscode.workspace.openTextDocument(uri);
                const position = new vscode.Position(line - 1, character - 1);

                const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
                    'vscode.executeDocumentRenameProvider',
                    uri,
                    position,
                    newName
                );

                if (!edit) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: `No rename edits returned. The symbol at ${filePath}:${line}:${character} may not support renaming.`
                        }]
                    };
                }

                const success = await vscode.workspace.applyEdit(edit);

                if (!success) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: 'Failed to apply rename edits.'
                        }]
                    };
                }

                const entries = edit.entries();
                let totalEdits = 0;
                const filesChanged: string[] = [];

                for (const [entryUri, textEdits] of entries) {
                    filesChanged.push(uriToWorkspacePath(entryUri));
                    totalEdits += textEdits.length;
                }

                const summary = [
                    `Symbol renamed to "${newName}" successfully.`,
                    `Files changed: ${filesChanged.length}`,
                    `Total edits: ${totalEdits}`,
                    '',
                    ...filesChanged.map(f => `  • ${f}`)
                ].join('\n');

                logger.info(`[rename_symbol] Renamed across ${filesChanged.length} file(s), ${totalEdits} edit(s)`);
                return { content: [{ type: 'text' as const, text: summary }] };

            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`[rename_symbol] ${message}`);
                throw error;
            }
        }
    );

    // ── format_document_code ────────────────────────────────────────────
    server.tool(
        'format_document_code',
        `Formats a document using VS Code's built-in formatting provider.

        WHEN TO USE: Auto-formatting a file after edits, enforcing code style.
        Uses the workspace's configured formatter (Prettier, ESLint, etc.).`,
        {
            path: z.string().describe('The path to the file to format')
        },
        async ({ path: filePath }): Promise<CallToolResult> => {
            logger.info(`[format_document] path=${filePath}`);

            try {
                const uri = resolveFilePath(filePath);
                const document = await vscode.workspace.openTextDocument(uri);

                const editorConfig = vscode.workspace.getConfiguration('editor', uri);
                const tabSize = editorConfig.get<number>('tabSize', 4);
                const insertSpaces = editorConfig.get<boolean>('insertSpaces', true);

                const textEdits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
                    'vscode.executeFormatDocumentProvider',
                    uri,
                    { tabSize, insertSpaces }
                );

                if (!textEdits || textEdits.length === 0) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: `No formatting changes needed for ${filePath}.`
                        }]
                    };
                }

                const edit = new vscode.WorkspaceEdit();
                for (const textEdit of textEdits) {
                    edit.replace(uri, textEdit.range, textEdit.newText);
                }

                const success = await vscode.workspace.applyEdit(edit);

                if (!success) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: 'Failed to apply formatting edits.'
                        }]
                    };
                }

                // Save the document to persist changes
                await document.save();

                logger.info(`[format_document] Applied ${textEdits.length} edit(s) to ${filePath}`);
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Formatted ${filePath} successfully. ${textEdits.length} edit(s) applied.`
                    }]
                };

            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`[format_document] ${message}`);
                throw error;
            }
        }
    );

    // ── organize_imports_code ───────────────────────────────────────────
    server.tool(
        'organize_imports_code',
        `Organizes imports in a file using VS Code's code action provider.

        WHEN TO USE: Sorting and cleaning up imports, removing unused imports.
        Requires a language extension that supports the "source.organizeImports" code action.`,
        {
            path: z.string().describe('The path to the file to organize imports for')
        },
        async ({ path: filePath }): Promise<CallToolResult> => {
            logger.info(`[organize_imports] path=${filePath}`);

            try {
                const uri = resolveFilePath(filePath);
                const document = await vscode.workspace.openTextDocument(uri);

                const fullRange = new vscode.Range(
                    new vscode.Position(0, 0),
                    new vscode.Position(document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length)
                );

                const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
                    'vscode.executeCodeActionProvider',
                    uri,
                    fullRange,
                    vscode.CodeActionKind.SourceOrganizeImports.value
                );

                if (!codeActions || codeActions.length === 0) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: `No organize-imports action available for ${filePath}. The language extension may not support this feature.`
                        }]
                    };
                }

                let appliedCount = 0;

                for (const action of codeActions) {
                    if (action.edit) {
                        const success = await vscode.workspace.applyEdit(action.edit);
                        if (success) {
                            appliedCount++;
                        }
                    }

                    if (action.command) {
                        await vscode.commands.executeCommand(
                            action.command.command,
                            ...(action.command.arguments || [])
                        );
                        appliedCount++;
                    }
                }

                // Save the document to persist changes
                await document.save();

                logger.info(`[organize_imports] Applied ${appliedCount} action(s) to ${filePath}`);
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Imports organized in ${filePath}. ${appliedCount} action(s) applied.`
                    }]
                };

            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`[organize_imports] ${message}`);
                throw error;
            }
        }
    );

    // ── code_actions_code ───────────────────────────────────────────────
    server.tool(
        'code_actions_code',
        `Lists available code actions at a position, and optionally applies one.

        WHEN TO USE: Discovering quick-fixes, refactorings, or source actions at a specific location.
        Pass 'apply' with the 0-based index of the action to apply it directly.`,
        {
            path: z.string().describe('The path to the file'),
            line: z.number().describe('The line number (1-based)'),
            character: z.number().describe('The character position (1-based)'),
            apply: z.number().optional().describe('0-based index of the code action to apply. If omitted, only lists available actions.')
        },
        async ({ path: filePath, line, character, apply }): Promise<CallToolResult> => {
            logger.info(`[code_actions] path=${filePath}, line=${line}, char=${character}, apply=${apply ?? 'list-only'}`);

            try {
                const uri = resolveFilePath(filePath);
                const document = await vscode.workspace.openTextDocument(uri);

                const position = new vscode.Position(line - 1, character - 1);
                const range = new vscode.Range(position, position);

                const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
                    'vscode.executeCodeActionProvider',
                    uri,
                    range
                );

                if (!codeActions || codeActions.length === 0) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: `No code actions available at ${filePath}:${line}:${character}.`
                        }]
                    };
                }

                // Build the listing
                const listing = codeActions.map((action, i) => {
                    const kind = action.kind?.value ?? 'unknown';
                    const disabled = action.disabled ? ` (disabled: ${action.disabled.reason})` : '';
                    return `  [${i}] ${action.title} (${kind})${disabled}`;
                });

                // If apply is requested, execute that action
                if (apply !== undefined) {
                    if (apply < 0 || apply >= codeActions.length) {
                        return {
                            content: [{
                                type: 'text' as const,
                                text: `Index ${apply} is out of range. Available actions: 0–${codeActions.length - 1}.\n\n${listing.join('\n')}`
                            }]
                        };
                    }

                    const action = codeActions[apply];

                    if (action.disabled) {
                        return {
                            content: [{
                                type: 'text' as const,
                                text: `Action [${apply}] "${action.title}" is disabled: ${action.disabled.reason}\n\n${listing.join('\n')}`
                            }]
                        };
                    }

                    if (action.edit) {
                        const success = await vscode.workspace.applyEdit(action.edit);
                        if (!success) {
                            return {
                                content: [{
                                    type: 'text' as const,
                                    text: `Failed to apply edit for action [${apply}] "${action.title}".`
                                }]
                            };
                        }
                    }

                    if (action.command) {
                        await vscode.commands.executeCommand(
                            action.command.command,
                            ...(action.command.arguments || [])
                        );
                    }

                    logger.info(`[code_actions] Applied action [${apply}] "${action.title}"`);
                    return {
                        content: [{
                            type: 'text' as const,
                            text: `Applied code action [${apply}]: "${action.title}"\n\nAll available actions:\n${listing.join('\n')}`
                        }]
                    };
                }

                // List-only mode
                logger.info(`[code_actions] Found ${codeActions.length} action(s)`);
                return {
                    content: [{
                        type: 'text' as const,
                        text: `${codeActions.length} code action(s) at ${filePath}:${line}:${character}:\n\n${listing.join('\n')}`
                    }]
                };

            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`[code_actions] ${message}`);
                throw error;
            }
        }
    );
}
