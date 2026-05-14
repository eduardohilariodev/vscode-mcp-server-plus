# Changelog

## [1.0.0] - 2025-07-13

### Added

- **Task Tools**: `list_tasks_code`, `run_task_code`, `read_task_output_code`, `terminate_task_code`, `clear_task_output_code` — full VS Code task lifecycle with ANSI-stripped output capture
- **Git Tools**: `git_status_code`, `git_diff_code`, `git_log_code`, `git_stage_code`, `git_commit_code`, `git_branch_code`, `git_stash_code` — native Git integration via built-in Git extension API
- **Terminal Tools**: `list_terminals_code`, `create_terminal_code`, `send_terminal_text_code`, `close_terminal_code`, `show_terminal_code` — advanced terminal management
- **Refactoring Tools**: `rename_symbol_code`, `format_document_code`, `organize_imports_code`, `code_actions_code` — LSP-powered code transformations
- **Debug Tools**: `list_debug_configs_code`, `start_debug_code`, `stop_debug_code`, `set_breakpoint_code`, `list_breakpoints_code`, `debug_evaluate_code` — debug adapter integration (disabled by default)
- **Config Tools**: `read_config_code`, `write_config_code`, `get_workspace_info_code`, `list_config_sections_code` — workspace settings management
- **Extensions Tools**: `list_extensions_code`, `get_extension_info_code`, `install_extension_code`, `uninstall_extension_code`, `enable_extension_code` — extension marketplace operations
- **Clipboard Tools**: `read_clipboard_code`, `write_clipboard_code` — system clipboard access
- Per-category `enabledTools` configuration to toggle each tool group independently

### Changed

- Rebranded from `vscode-mcp-server` to `vscode-mcp-server-plus`
- Shell integration wait timeout increased from 1s to 5s for reliability
- Terminal shown before shell integration check for proper activation

### Credits

Forked from [juehang/vscode-mcp-server](https://github.com/juehang/vscode-mcp-server) v0.4.0 by Juehang Qin (MIT License).
