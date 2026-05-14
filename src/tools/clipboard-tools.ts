import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as vscode from 'vscode';
import { z } from 'zod';
import { logger } from '../utils/logger';

export function registerClipboardTools(server: McpServer): void {
    server.tool(
        "read_clipboard_code",
        "Read the current text contents of the system clipboard.\n\n" +
        "WHEN TO USE: Accessing copied text, pasting content into workflows, inspecting clipboard state.",
        {},
        async () => {
            try {
                const text = await vscode.env.clipboard.readText();
                const result = text || "(empty)";
                logger.info(`Read clipboard: ${result.length} characters`);
                return { content: [{ type: "text" as const, text: result }] };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`Failed to read clipboard: ${message}`);
                return { content: [{ type: "text" as const, text: `Error reading clipboard: ${message}` }] };
            }
        }
    );

    server.tool(
        "write_clipboard_code",
        "Write text to the system clipboard.\n\n" +
        "WHEN TO USE: Copying generated content, sharing output with the user, preparing text for pasting.",
        { text: z.string().describe("The text to write to the clipboard") },
        async ({ text }) => {
            try {
                await vscode.env.clipboard.writeText(text);
                logger.info(`Wrote ${text.length} characters to clipboard`);
                return { content: [{ type: "text" as const, text: `Copied ${text.length} characters to clipboard.` }] };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`Failed to write clipboard: ${message}`);
                return { content: [{ type: "text" as const, text: `Error writing to clipboard: ${message}` }] };
            }
        }
    );
}
