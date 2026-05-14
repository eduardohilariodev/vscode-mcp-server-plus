# VSCode MCP Server Plus

A supercharged fork of [vscode-mcp-server](https://github.com/juehang/vscode-mcp-server) that exposes **50+ VS Code tools** via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io), enabling Claude, Copilot, and other AI agents to interact deeply with your editor.

> **Original**: 12 tools across 5 categories  
> **Plus**: 50+ tools across 13 categories — tasks, git, terminals, refactoring, debugging, config, extensions, clipboard, and more.

## Features

### Original Tools (from upstream)

| Category | Tools |
|----------|-------|
| **File** | `list_files_code`, `read_file_code` |
| **Edit** | `create_file_code`, `replace_lines_code`, `copy_file_code`, `move_file_code`, `rename_file_code` |
| **Shell** | `execute_shell_command_code` |
| **Diagnostics** | `get_diagnostics_code` |
| **Symbol** | `search_symbols_code`, `get_document_symbols_code`, `get_symbol_definition_code` |

### New in Plus ✨

| Category | Tools | Description |
|----------|-------|-------------|
| **Tasks** | `list_tasks_code`, `run_task_code`, `read_task_output_code`, `terminate_task_code`, `clear_task_output_code` | Full VS Code task lifecycle — run builds, read output, terminate watchers |
| **Git** | `git_status_code`, `git_diff_code`, `git_log_code`, `git_stage_code`, `git_commit_code`, `git_branch_code`, `git_stash_code` | Native Git integration via VS Code's built-in Git extension |
| **Terminal** | `list_terminals_code`, `create_terminal_code`, `send_terminal_text_code`, `close_terminal_code`, `show_terminal_code` | Advanced terminal management beyond shell execution |
| **Refactoring** | `rename_symbol_code`, `format_document_code`, `organize_imports_code`, `code_actions_code` | LSP-powered code transformations |
| **Debug** | `list_debug_configs_code`, `start_debug_code`, `stop_debug_code`, `set_breakpoint_code`, `list_breakpoints_code`, `debug_evaluate_code` | Debug adapter integration |
| **Config** | `read_config_code`, `write_config_code`, `get_workspace_info_code`, `list_config_sections_code` | VS Code settings management |
| **Extensions** | `list_extensions_code`, `get_extension_info_code`, `install_extension_code`, `uninstall_extension_code`, `enable_extension_code` | Extension marketplace operations |
| **Clipboard** | `read_clipboard_code`, `write_clipboard_code` | System clipboard access |

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X`)
3. Search for **"VSCode MCP Server Plus"**
4. Click **Install**

### From Source

```bash
git clone https://github.com/eduardohilariodev/vscode-mcp-server-plus.git
cd vscode-mcp-server-plus
npm install
npm run compile
```

Then press `F5` in VS Code to launch the Extension Development Host.

## Configuration

### MCP Client Configuration

Configure your MCP client to connect to the extension's HTTP endpoint:

```json
{
  "mcpServers": {
    "vscode-mcp-server-plus": {
      "url": "http://127.0.0.1:3100/mcp"
    }
  }
}
```

### Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `vscode-mcp-server-plus.port` | `3000` | HTTP server port |
| `vscode-mcp-server-plus.enabledTools.file` | `true` | File listing and reading |
| `vscode-mcp-server-plus.enabledTools.edit` | `true` | File creation and editing |
| `vscode-mcp-server-plus.enabledTools.shell` | `true` | Shell command execution |
| `vscode-mcp-server-plus.enabledTools.diagnostics` | `true` | Language diagnostics |
| `vscode-mcp-server-plus.enabledTools.symbol` | `true` | Symbol search and navigation |
| `vscode-mcp-server-plus.enabledTools.tasks` | `true` | VS Code task management |
| `vscode-mcp-server-plus.enabledTools.git` | `true` | Git operations |
| `vscode-mcp-server-plus.enabledTools.terminal` | `true` | Terminal management |
| `vscode-mcp-server-plus.enabledTools.refactoring` | `true` | Code refactoring |
| `vscode-mcp-server-plus.enabledTools.debug` | `false` | Debug adapter (disabled by default — can interfere with active sessions) |
| `vscode-mcp-server-plus.enabledTools.config` | `true` | Workspace configuration |
| `vscode-mcp-server-plus.enabledTools.extensions` | `true` | Extension management |
| `vscode-mcp-server-plus.enabledTools.clipboard` | `true` | Clipboard access |

### Disabling Tool Categories

To disable specific tool categories, add to your VS Code `settings.json`:

```json
{
  "vscode-mcp-server-plus.enabledTools": {
    "git": false,
    "debug": false
  }
}
```

## Tool Reference

### Task Tools

- **`list_tasks_code`** — List all available tasks from `tasks.json` and extensions
- **`run_task_code`** — Run a task by label, with optional `waitForExit` for finite tasks
- **`read_task_output_code`** — Read captured terminal output (ANSI-stripped, with buffer management)
- **`terminate_task_code`** — Stop a running task
- **`clear_task_output_code`** — Clear output buffers for memory management

> Task output capture requires `terminalDataWriteEvent` proposed API (VS Code 1.93+)

### Git Tools

- **`git_status_code`** — Working tree status with branch info
- **`git_diff_code`** — Unified diff (staged or unstaged)
- **`git_log_code`** — Commit history with optional file/author/count filters
- **`git_stage_code`** — Stage or unstage files
- **`git_commit_code`** — Create commits (with optional amend)
- **`git_branch_code`** — List, create, switch, or delete branches
- **`git_stash_code`** — Save, pop, list, or drop stashes

### Terminal Tools

- **`list_terminals_code`** — List active terminals with PID and status
- **`create_terminal_code`** — Create named terminal with optional cwd/env
- **`send_terminal_text_code`** — Send commands to a terminal by name
- **`close_terminal_code`** — Dispose a terminal
- **`show_terminal_code`** — Bring terminal to focus

### Refactoring Tools

- **`rename_symbol_code`** — LSP rename across workspace
- **`format_document_code`** — Format file with active formatter
- **`organize_imports_code`** — Sort and organize imports
- **`code_actions_code`** — List and apply quick fixes at a position

### Debug Tools

- **`list_debug_configs_code`** — List launch.json configurations
- **`start_debug_code`** — Start debug session
- **`stop_debug_code`** — Stop active debug session(s)
- **`set_breakpoint_code`** — Add/remove breakpoints with conditions
- **`list_breakpoints_code`** — List all breakpoints
- **`debug_evaluate_code`** — Evaluate expressions in debug context

### Config Tools

- **`read_config_code`** — Read any VS Code setting
- **`write_config_code`** — Update settings (user/workspace scope)
- **`get_workspace_info_code`** — Workspace metadata
- **`list_config_sections_code`** — Discover setting sections

### Extensions Tools

- **`list_extensions_code`** — List installed extensions
- **`get_extension_info_code`** — Detailed extension metadata
- **`install_extension_code`** — Install from marketplace
- **`uninstall_extension_code`** — Remove an extension
- **`enable_extension_code`** — Enable/disable extensions

### Clipboard Tools

- **`read_clipboard_code`** — Read clipboard text
- **`write_clipboard_code`** — Write text to clipboard

## Security

⚠️ This extension exposes powerful VS Code APIs over HTTP. Use with caution:

- The server binds to `127.0.0.1` (localhost only) by default
- **Shell execution**, **git commit/push**, **extension install**, and **config write** can modify your system
- **Debug evaluate** can execute arbitrary code in the debug context
- Disable tool categories you don't need via `enabledTools` configuration
- Ensure the port is not exposed to untrusted networks

## Development

```bash
npm install          # install dependencies
npm run compile      # build TypeScript
npm run watch        # watch mode for development
npm run lint         # run ESLint
```

### Packaging

```bash
npx vsce package     # creates .vsix file
npx vsce publish     # publish to marketplace
```

## Credits

Forked from [juehang/vscode-mcp-server](https://github.com/juehang/vscode-mcp-server) (MIT License).  
Original work by [Juehang Qin](https://github.com/juehang).

## License

MIT — see [LICENSE](LICENSE) for details.
