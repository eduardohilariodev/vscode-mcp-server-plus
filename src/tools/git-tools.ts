import * as vscode from 'vscode';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { execSync } from 'child_process';

/**
 * Get the primary Git repository from the built-in Git extension.
 * Activates the extension if needed.
 */
async function getGitRepo(): Promise<any> {
    const gitExtension = vscode.extensions.getExtension<any>('vscode.git');
    if (!gitExtension) {
        throw new Error('Git extension not found. Make sure the built-in Git extension is enabled.');
    }
    if (!gitExtension.isActive) {
        await gitExtension.activate();
    }
    const git = gitExtension.exports.getAPI(1);
    if (!git.repositories.length) {
        throw new Error('No Git repository found in the current workspace.');
    }
    return git.repositories[0];
}

/**
 * Map a change status code to a human-readable label.
 */
function statusLabel(status: number): string {
    const map: Record<number, string> = {
        0: 'Modified',
        1: 'Added',
        2: 'Deleted',
        3: 'Renamed',
        4: 'Copied',
        5: 'Untracked',
        6: 'Ignored',
        7: 'Intent to Add',
    };
    return map[status] ?? `Unknown(${status})`;
}

/**
 * Format a file change entry for display.
 */
function formatChange(change: any): string {
    const rel = vscode.workspace.asRelativePath(change.uri);
    return `  ${statusLabel(change.status)}: ${rel}`;
}

export function registerGitTools(server: McpServer): void {

    // ── 1. git_status_code ──────────────────────────────────────────────
    server.tool(
        'git_status_code',
        `Get working tree status including staged, modified, and untracked files, current branch, and HEAD commit.

        WHEN TO USE: Understanding the current state of the repository before committing or reviewing changes.`,
        {},
        async (): Promise<CallToolResult> => {
            console.log('[git_status] Tool called');

            try {
                const repo = await getGitRepo();
                const lines: string[] = [];

                const branch = repo.state.HEAD?.name ?? '(detached)';
                const headCommit = repo.state.HEAD?.commit
                    ? repo.state.HEAD.commit.substring(0, 8)
                    : '(no commits)';
                lines.push(`Branch: ${branch}`);
                lines.push(`HEAD:   ${headCommit}`);

                const staged = repo.state.indexChanges ?? [];
                const modified = repo.state.workingTreeChanges ?? [];
                const merge = repo.state.mergeChanges ?? [];

                if (staged.length) {
                    lines.push('', 'Staged files:');
                    staged.forEach((c: any) => lines.push(formatChange(c)));
                }
                if (modified.length) {
                    lines.push('', 'Modified files (unstaged):');
                    modified.forEach((c: any) => lines.push(formatChange(c)));
                }
                if (merge.length) {
                    lines.push('', 'Merge conflicts:');
                    merge.forEach((c: any) => lines.push(formatChange(c)));
                }
                if (!staged.length && !modified.length && !merge.length) {
                    lines.push('', 'Working tree clean.');
                }

                console.log('[git_status] Successfully completed');
                return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
            } catch (error) {
                console.error('[git_status] Error:', error);
                throw error;
            }
        }
    );

    // ── 2. git_diff_code ────────────────────────────────────────────────
    server.tool(
        'git_diff_code',
        `Get diff for working-tree or staged changes.

        WHEN TO USE: Reviewing what changed before committing, or inspecting a specific file's modifications.
        Specify a file path to limit the diff, or omit for all changes.`,
        {
            file: z.string().optional().describe('Specific file path to diff. If omitted, diffs all changed files.'),
            staged: z.boolean().optional().default(false).describe('If true, show staged (index) diff instead of working-tree diff.')
        },
        async ({ file, staged = false }): Promise<CallToolResult> => {
            console.log(`[git_diff] Tool called with file=${file ?? 'all'}, staged=${staged}`);

            try {
                const repo = await getGitRepo();
                let diffText: string;

                if (file) {
                    if (staged) {
                        diffText = await repo.diffIndexWith('HEAD', file);
                    } else {
                        diffText = await repo.diffWith('HEAD', file);
                    }
                } else {
                    // Attempt the simple diff(staged) API first
                    try {
                        diffText = await repo.diff(staged);
                    } catch {
                        // Fallback: iterate changed files
                        const changes = staged
                            ? (repo.state.indexChanges ?? [])
                            : (repo.state.workingTreeChanges ?? []);

                        const parts: string[] = [];
                        for (const change of changes) {
                            const rel = vscode.workspace.asRelativePath(change.uri);
                            try {
                                const d = staged
                                    ? await repo.diffIndexWith('HEAD', rel)
                                    : await repo.diffWith('HEAD', rel);
                                if (d) { parts.push(d); }
                            } catch {
                                parts.push(`--- could not diff: ${rel} ---`);
                            }
                        }
                        diffText = parts.join('\n');
                    }
                }

                if (!diffText || !diffText.trim()) {
                    diffText = staged
                        ? 'No staged changes.'
                        : 'No unstaged changes.';
                }

                console.log('[git_diff] Successfully completed');
                return { content: [{ type: 'text' as const, text: diffText }] };
            } catch (error) {
                console.error('[git_diff] Error:', error);
                throw error;
            }
        }
    );

    // ── 3. git_log_code ─────────────────────────────────────────────────
    server.tool(
        'git_log_code',
        `Get commit history for the repository or a specific file.

        WHEN TO USE: Exploring recent changes, finding who changed a file, or locating a specific commit.`,
        {
            maxCount: z.number().optional().default(20).describe('Maximum number of log entries to return (default: 20).'),
            file: z.string().optional().describe('Filter log to commits touching this file path.'),
            author: z.string().optional().describe('Filter log to commits by this author name or email.')
        },
        async ({ maxCount = 20, file, author }): Promise<CallToolResult> => {
            console.log(`[git_log] Tool called with maxCount=${maxCount}, file=${file ?? 'none'}, author=${author ?? 'none'}`);

            try {
                const repo = await getGitRepo();

                const logOptions: any = { maxEntries: maxCount };
                if (file) { logOptions.path = file; }

                let commits: any[];
                try {
                    commits = await repo.log(logOptions);
                } catch {
                    return { content: [{ type: 'text' as const, text: 'No commits found (repository may be empty).' }] };
                }

                if (author) {
                    const authorLower = author.toLowerCase();
                    commits = commits.filter((c: any) => {
                        const name = (c.authorName ?? '').toLowerCase();
                        const email = (c.authorEmail ?? '').toLowerCase();
                        return name.includes(authorLower) || email.includes(authorLower);
                    });
                }

                if (!commits.length) {
                    return { content: [{ type: 'text' as const, text: 'No matching commits found.' }] };
                }

                const lines = commits.map((c: any) => {
                    const short = (c.hash ?? '').substring(0, 8);
                    const date = c.authorDate
                        ? new Date(c.authorDate).toISOString().replace('T', ' ').substring(0, 19)
                        : 'unknown date';
                    const authorStr = c.authorName ?? 'unknown';
                    const msg = (c.message ?? '').split('\n')[0];
                    return `${short} ${date} ${authorStr} — ${msg}`;
                });

                console.log(`[git_log] Returning ${lines.length} commits`);
                return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
            } catch (error) {
                console.error('[git_log] Error:', error);
                throw error;
            }
        }
    );

    // ── 4. git_stage_code ───────────────────────────────────────────────
    server.tool(
        'git_stage_code',
        `Stage or unstage files in the Git index.

        WHEN TO USE: Preparing files for commit, or removing files from the staging area.`,
        {
            files: z.array(z.string()).describe('File paths to stage or unstage.'),
            unstage: z.boolean().optional().default(false).describe('If true, unstage the files instead of staging them.')
        },
        async ({ files, unstage = false }): Promise<CallToolResult> => {
            console.log(`[git_stage] Tool called with files=[${files.join(', ')}], unstage=${unstage}`);

            try {
                const repo = await getGitRepo();

                // Resolve paths relative to workspace
                const workspaceRoot = repo.rootUri?.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
                const uris = files.map(f => {
                    if (f.startsWith('/') || /^[a-zA-Z]:/.test(f)) {
                        return vscode.Uri.file(f);
                    }
                    return vscode.Uri.file(`${workspaceRoot}/${f}`);
                });

                if (unstage) {
                    // revert removes files from the index (unstage)
                    await repo.revert(uris.map(u => u.fsPath));
                } else {
                    await repo.add(uris.map(u => u.fsPath));
                }

                const action = unstage ? 'Unstaged' : 'Staged';
                const listing = files.map(f => `  ${f}`).join('\n');

                console.log(`[git_stage] ${action} ${files.length} file(s)`);
                return { content: [{ type: 'text' as const, text: `${action} ${files.length} file(s):\n${listing}` }] };
            } catch (error) {
                console.error('[git_stage] Error:', error);
                throw error;
            }
        }
    );

    // ── 5. git_commit_code ──────────────────────────────────────────────
    server.tool(
        'git_commit_code',
        `Create a Git commit with the currently staged changes.

        WHEN TO USE: After staging files, to record changes in history.
        Use amend=true to amend the last commit instead of creating a new one.`,
        {
            message: z.string().describe('The commit message.'),
            amend: z.boolean().optional().default(false).describe('If true, amend the previous commit instead of creating a new one.')
        },
        async ({ message, amend = false }): Promise<CallToolResult> => {
            console.log(`[git_commit] Tool called with message="${message}", amend=${amend}`);

            try {
                const repo = await getGitRepo();
                await repo.commit(message, { amend });

                // Read back the new HEAD to confirm
                const newHead = repo.state.HEAD?.commit
                    ? repo.state.HEAD.commit.substring(0, 8)
                    : 'unknown';

                const verb = amend ? 'Amended' : 'Created';
                console.log(`[git_commit] ${verb} commit ${newHead}`);
                return {
                    content: [{
                        type: 'text' as const,
                        text: `${verb} commit ${newHead}\nMessage: ${message}`
                    }]
                };
            } catch (error) {
                console.error('[git_commit] Error:', error);
                throw error;
            }
        }
    );

    // ── 6. git_branch_code ──────────────────────────────────────────────
    server.tool(
        'git_branch_code',
        `Perform branch operations: list, create, switch, or delete branches.

        WHEN TO USE: Managing branches — viewing available branches, creating feature branches, switching context, or cleaning up.`,
        {
            action: z.enum(['list', 'create', 'switch', 'delete']).describe('Branch operation to perform.'),
            name: z.string().optional().describe('Branch name (required for create, switch, and delete).')
        },
        async ({ action, name }): Promise<CallToolResult> => {
            console.log(`[git_branch] Tool called with action=${action}, name=${name ?? 'none'}`);

            try {
                const repo = await getGitRepo();

                switch (action) {
                    case 'list': {
                        let branches: any[];
                        try {
                            branches = await repo.getBranches({ remote: true });
                        } catch {
                            branches = await repo.getBranches({});
                        }

                        const currentName = repo.state.HEAD?.name;
                        const lines = branches.map((b: any) => {
                            const marker = b.name === currentName ? '* ' : '  ';
                            const remote = b.remote ? ` (remote: ${b.remote})` : '';
                            return `${marker}${b.name}${remote}`;
                        });

                        if (!lines.length) {
                            return { content: [{ type: 'text' as const, text: 'No branches found.' }] };
                        }
                        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
                    }

                    case 'create': {
                        if (!name) { throw new Error('Branch name is required for "create" action.'); }
                        await repo.createBranch(name, false);
                        console.log(`[git_branch] Created branch: ${name}`);
                        return { content: [{ type: 'text' as const, text: `Branch '${name}' created from HEAD.` }] };
                    }

                    case 'switch': {
                        if (!name) { throw new Error('Branch name is required for "switch" action.'); }
                        await repo.checkout(name);
                        console.log(`[git_branch] Switched to branch: ${name}`);
                        return { content: [{ type: 'text' as const, text: `Switched to branch '${name}'.` }] };
                    }

                    case 'delete': {
                        if (!name) { throw new Error('Branch name is required for "delete" action.'); }
                        await repo.deleteBranch(name, false);
                        console.log(`[git_branch] Deleted branch: ${name}`);
                        return { content: [{ type: 'text' as const, text: `Branch '${name}' deleted.` }] };
                    }

                    default:
                        throw new Error(`Unknown branch action: ${action}`);
                }
            } catch (error) {
                console.error('[git_branch] Error:', error);
                throw error;
            }
        }
    );

    // ── 7. git_stash_code ───────────────────────────────────────────────
    server.tool(
        'git_stash_code',
        `Perform stash operations: save, pop, list, or drop stashes.

        WHEN TO USE: Temporarily shelving changes, restoring stashed work, or cleaning up stash entries.`,
        {
            action: z.enum(['save', 'pop', 'list', 'drop']).describe('Stash operation to perform.'),
            message: z.string().optional().describe('Optional message for the stash (used with "save" action).')
        },
        async ({ action, message }): Promise<CallToolResult> => {
            console.log(`[git_stash] Tool called with action=${action}, message=${message ?? 'none'}`);

            try {
                const repo = await getGitRepo();
                const rootPath = repo.rootUri?.fsPath
                    ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
                    ?? '';

                switch (action) {
                    case 'save': {
                        try {
                            if (message) {
                                await vscode.commands.executeCommand('git.stash', message);
                            } else {
                                await vscode.commands.executeCommand('git.stash');
                            }
                        } catch {
                            // Fallback to CLI if the VS Code command interface differs
                            const cmd = message
                                ? `git stash push -m "${message.replace(/"/g, '\\"')}"`
                                : 'git stash';
                            execSync(cmd, { cwd: rootPath, encoding: 'utf-8' });
                        }
                        console.log('[git_stash] Saved stash');
                        return { content: [{ type: 'text' as const, text: `Stash saved${message ? `: ${message}` : ''}` }] };
                    }

                    case 'pop': {
                        try {
                            await vscode.commands.executeCommand('git.stashPop');
                        } catch {
                            execSync('git stash pop', { cwd: rootPath, encoding: 'utf-8' });
                        }
                        console.log('[git_stash] Popped stash');
                        return { content: [{ type: 'text' as const, text: 'Stash popped and applied to working tree.' }] };
                    }

                    case 'list': {
                        let listOutput: string;
                        try {
                            listOutput = execSync('git stash list', { cwd: rootPath, encoding: 'utf-8' }).trim();
                        } catch {
                            listOutput = '';
                        }

                        if (!listOutput) {
                            return { content: [{ type: 'text' as const, text: 'No stashes found.' }] };
                        }
                        console.log('[git_stash] Listed stashes');
                        return { content: [{ type: 'text' as const, text: listOutput }] };
                    }

                    case 'drop': {
                        try {
                            await vscode.commands.executeCommand('git.stashDrop');
                        } catch {
                            execSync('git stash drop', { cwd: rootPath, encoding: 'utf-8' });
                        }
                        console.log('[git_stash] Dropped stash');
                        return { content: [{ type: 'text' as const, text: 'Stash entry dropped.' }] };
                    }

                    default:
                        throw new Error(`Unknown stash action: ${action}`);
                }
            } catch (error) {
                console.error('[git_stash] Error:', error);
                throw error;
            }
        }
    );
}
