/**
 * `am completion <shell>` — emit a tab-completion script for zsh, bash, or fish.
 *
 * Why we wrote this by hand:
 *   commander-completion exists but is unmaintained and pulls in a chunky
 *   dependency tree for what amounts to ~80 lines of shell. Walking the
 *   program tree at runtime is also more accurate — it stays in sync as
 *   subcommands are added/removed.
 *
 * Install path (the message at the end of each script):
 *   zsh:  am completion zsh  >> ~/.zshrc            (or load via fpath)
 *   bash: am completion bash >> ~/.bashrc           (or /etc/bash_completion.d)
 *   fish: am completion fish > ~/.config/fish/completions/anima.fish
 *
 * What we emit:
 *   - top-level subcommands
 *   - per-subcommand: its own subcommands + flags
 *   - global flags (--json, --debug, --token, --api-url)
 *
 * We do NOT emit per-flag value completion (e.g. "--tier <basic|premium>")
 * for now — keeping it boring & robust. Static enum hints can be added per
 * shell later without changing the surface.
 */

import { Command } from "commander";

const SUPPORTED_SHELLS = ["zsh", "bash", "fish"] as const;
type Shell = (typeof SUPPORTED_SHELLS)[number];

interface CommandNode {
	name: string;
	description: string;
	subcommands: CommandNode[];
	options: string[];
}

function walk(cmd: Command): CommandNode {
	const opts = cmd.options.flatMap((o) => {
		// `flags` looks like "-t, --tier <tier>" — we want both forms minus
		// the angle-bracket arg placeholder.
		return o.flags
			.split(",")
			.map((s) =>
				s
					.trim()
					.replace(/\s+<.+?>$/, "")
					.replace(/\s+\[.+?]$/, ""),
			)
			.filter((s) => s.startsWith("-"));
	});
	return {
		name: cmd.name(),
		description: cmd.description() || "",
		subcommands: cmd.commands.map(walk),
		options: opts,
	};
}

function generateZsh(root: CommandNode): string {
	const topLevels = root.subcommands
		.map((c) => `'${c.name}:${c.description.replace(/'/g, "''")}'`)
		.join(" \\\n    ");
	const globalFlags = root.options.join(" ");
	return `#compdef anima am
# Anima CLI completion for zsh.
# Install: add this file to a directory in $fpath, or:
#   am completion zsh >> ~/.zshrc

_anima() {
  local -a subcommands
  subcommands=(
    ${topLevels}
  )

  _arguments -C \\
    '1: :->cmd' \\
    '*::arg:->args'

  case $state in
    cmd)
      _describe 'anima command' subcommands
      ;;
    args)
      # Per-subcommand completion is generated dynamically by parsing
      # \`am <cmd> --help\`. Keeps this script small even as subcommands
      # grow.
      local cmd_help
      cmd_help=$(am "\${words[2]}" --help 2>/dev/null)
      local -a subcmds opts
      subcmds=(\${(f)"$(print -- "$cmd_help" | awk '/^Commands:/{flag=1; next} /^[[:space:]]*$/{flag=0} flag {gsub(/^[[:space:]]+/, ""); print $1}')"})
      opts=(\${(f)"$(print -- "$cmd_help" | awk '/^Options:/{flag=1; next} /^[[:space:]]*$/{flag=0} flag {match($0, /--[a-z-]+/); if (RSTART > 0) print substr($0, RSTART, RLENGTH)}')"})
      _describe 'subcommand' subcmds
      _describe 'flag' opts
      ;;
  esac
}

compdef _anima anima am

# Global flags for top-level: ${globalFlags}
`;
}

function generateBash(root: CommandNode): string {
	const topLevels = root.subcommands.map((c) => c.name).join(" ");
	return `# Anima CLI completion for bash.
# Install: source this file from your ~/.bashrc, or:
#   am completion bash >> ~/.bashrc

_anima_completion() {
  local cur prev cmds opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cmds="${topLevels}"

  # Position 1: top-level subcommand
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "$cmds" -- "$cur") )
    return 0
  fi

  # Position 2+: defer to \`am <cmd> --help\` parsing for sub-subcommands
  # and flags. A bit slow on first invocation; bash caches by default.
  local subcmd="\${COMP_WORDS[1]}"
  local sub_help sub_cmds sub_opts
  sub_help=$(am "$subcmd" --help 2>/dev/null)
  sub_cmds=$(printf '%s\\n' "$sub_help" | awk '/^Commands:/{flag=1; next} /^[[:space:]]*$/{flag=0} flag {gsub(/^[[:space:]]+/, ""); print $1}')
  sub_opts=$(printf '%s\\n' "$sub_help" | grep -oE '\\-\\-[a-z][a-z0-9-]*' | sort -u)

  COMPREPLY=( $(compgen -W "$sub_cmds $sub_opts" -- "$cur") )
}

complete -F _anima_completion anima
complete -F _anima_completion am
`;
}

function generateFish(root: CommandNode): string {
	const lines: string[] = [
		"# Anima CLI completion for fish.",
		"# Install: am completion fish > ~/.config/fish/completions/anima.fish",
		"",
		"# Disable file completion at the top level — only subcommands.",
		"complete -c anima -f",
		"complete -c am -f",
		"",
	];
	for (const sub of root.subcommands) {
		const desc = sub.description.replace(/'/g, "\\'");
		lines.push(
			`complete -c anima -n "__fish_use_subcommand" -a "${sub.name}" -d '${desc}'`,
		);
		lines.push(
			`complete -c am    -n "__fish_use_subcommand" -a "${sub.name}" -d '${desc}'`,
		);
	}
	lines.push("");
	for (const sub of root.subcommands) {
		for (const child of sub.subcommands) {
			const desc = child.description.replace(/'/g, "\\'");
			lines.push(
				`complete -c anima -n "__fish_seen_subcommand_from ${sub.name}" -a "${child.name}" -d '${desc}'`,
			);
			lines.push(
				`complete -c am    -n "__fish_seen_subcommand_from ${sub.name}" -a "${child.name}" -d '${desc}'`,
			);
		}
	}
	return lines.join("\n") + "\n";
}

export function completionCommand(): Command {
	return new Command("completion")
		.description("Print a shell-completion script for zsh, bash, or fish")
		.argument(
			"<shell>",
			`Shell to generate completion for (${SUPPORTED_SHELLS.join("|")})`,
		)
		.action(function (this: Command, shellArg: string) {
			const shell = shellArg.toLowerCase() as Shell;
			if (!SUPPORTED_SHELLS.includes(shell)) {
				console.error(
					`Unsupported shell "${shellArg}". Use one of: ${SUPPORTED_SHELLS.join(", ")}.`,
				);
				process.exit(2);
			}

			// Walk the parent program (this command's parent), so we capture
			// every subcommand that's been registered.
			const root = this.parent ?? this;
			const tree = walk(root);

			let script: string;
			switch (shell) {
				case "zsh":
					script = generateZsh(tree);
					break;
				case "bash":
					script = generateBash(tree);
					break;
				case "fish":
					script = generateFish(tree);
					break;
			}

			// Print to stdout so the user can pipe to a file. Stderr carries
			// the install hint when this runs in a TTY.
			process.stdout.write(script);
			if (process.stderr.isTTY) {
				process.stderr.write(
					`\n# Install hint:\n#   am completion ${shell} ${shell === "fish" ? "> ~/.config/fish/completions/anima.fish" : `>> ~/.${shell === "zsh" ? "zshrc" : "bashrc"}`}\n`,
				);
			}
		});
}
