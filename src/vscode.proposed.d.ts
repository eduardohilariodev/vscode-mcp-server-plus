import * as vscode from 'vscode';

// Type declarations for VS Code proposed APIs
// Requires "enabledApiProposals": ["terminalDataWriteEvent"] in package.json

declare module 'vscode' {
    export interface TerminalDataWriteEvent {
        readonly terminal: vscode.Terminal;
        readonly data: string;
    }

    export namespace window {
        /**
         * An event that fires when data is written to a terminal.
         * Requires proposed API: terminalDataWriteEvent
         */
        export function onDidWriteTerminalData(
            listener: (e: TerminalDataWriteEvent) => void,
            thisArgs?: unknown,
            disposables?: vscode.Disposable[]
        ): vscode.Disposable;
    }
}
