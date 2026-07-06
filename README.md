# @anima-labs/cli

Official command-line interface for [Anima](https://useanima.sh) — identity infrastructure for AI agents. Email, phone, voice, vault, addresses, and a unified policy engine — one CLI, one identity per agent.

## Install

```bash
npm install -g @anima-labs/cli
```

That's it. Run `anima onboard` to authenticate and walk through the agentic-commerce flow end-to-end.

### Tell your agent to set you up

In Claude Code, Cursor, Codex, or any MCP-aware agent:

```
Read useanima.sh/skill.md and get me set up with Anima
```

The agent reads the skill manifest, installs the CLI, registers itself as an MCP server, and finishes onboarding for you.

### MCP server

Anima CLI doubles as an MCP server. Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "anima": {
      "command": "npx",
      "args": ["-y", "@anima-labs/cli", "--mcp"]
    }
  }
}
```

Or run `anima setup-mcp install --all` to wire every supported client (Claude Desktop, Claude Code, Cursor, Codex, Windsurf, Zed) automatically.

### Alternative installs

```bash
bun add -g @anima-labs/cli           # bun
brew install anima-labs/tap/anima    # homebrew (macOS / Linux)
npx @anima-labs/cli init             # try without installing
```

## Output: agent vs human

By default every command prints **agent format** — compact single-line JSON, ~30-40% smaller than pretty JSON, machine-parseable. Pass `--human` for a pretty terminal view.

```bash
anima email list                 # agent default: {"emails":[…]}
anima email list --human         # ┌── box-drawn table
anima email list --format yaml   # explicit yaml
anima email list --format jsonl  # one record per line
```

Primary binary: **`anima`**. Short alias: **`am`**.

## Command Reference

### `auth` — Authentication and session management

```bash
anima auth login          # Authenticate with Anima
anima auth logout         # Clear stored credentials
anima auth whoami         # Show current user info
```

### `identity` — Manage agent identities

```bash
anima identity create     # Create a new agent identity
anima identity list       # List all identities
anima identity get <id>   # Get identity details
anima identity update     # Update identity properties
anima identity delete     # Delete an identity
anima identity rotate-key # Rotate identity signing key
```

### `email` — Send and manage emails

```bash
anima email send          # Send an email
anima email list          # List received emails
anima email get <id>      # Get email details
```

#### `email domains` — Custom domain management

```bash
anima email domains add       # Add a custom domain
anima email domains list      # List configured domains
anima email domains get       # Get domain details
anima email domains verify    # Verify domain DNS records
anima email domains dns       # Show required DNS records
anima email domains deliverability  # Check deliverability status
anima email domains delete    # Remove a domain
```

### `phone` — Manage phone numbers and SMS

```bash
anima phone search        # Search available phone numbers
anima phone provision     # Provision a new phone number
anima phone list          # List provisioned numbers
anima phone release       # Release a phone number
anima phone send-sms      # Send an SMS message
```

### `message` — Manage messages across all channels

```bash
anima message list        # List messages (email, SMS, MMS)
anima message get <id>    # Get message details
anima message search <q>  # Full-text search messages
```

### `vault` — Manage password vault credentials

```bash
anima vault provision     # Provision vault for an identity
anima vault deprovision   # Remove vault from an identity
anima vault status        # Check vault status
anima vault sync          # Sync vault data
anima vault store         # Store a credential
anima vault store --generate-password  # Store a login with a vault-generated password
                          # (generated server-side, stays in the vault, only the
                          #  credential ref is returned; --length/--no-special etc.)
anima vault get           # Retrieve a credential
anima vault list          # List all credentials
anima vault search        # Search credentials
anima vault delete        # Delete a credential
anima vault generate      # Generate a password
anima vault totp          # Generate TOTP code
```

### `config` — Manage CLI configuration and profiles

```bash
anima config set <key> <value>   # Set a config value
anima config get <key>           # Get a config value
anima config list                # List all config values
anima config profile             # Manage named profiles
```

### `setup-mcp` — Configure MCP server for AI clients

```bash
anima setup-mcp install   # Install MCP config for a client
anima setup-mcp uninstall # Remove MCP config
anima setup-mcp status    # Check MCP integration status
anima setup-mcp verify    # Verify MCP server connectivity
```

### `extension` — Manage Anima Chrome extension

```bash
anima extension status    # Check extension status
```

### `admin` — Organization and team administration

```bash
anima admin org list          # List organizations
anima admin member invite     # Invite a team member
anima admin member role       # Update member role
anima admin key rotate        # Rotate org API key
anima admin key revoke        # Revoke an API key
anima admin usage             # View usage statistics
```

### `webhook` — Manage webhooks

```bash
anima webhook create      # Create a webhook
anima webhook list        # List all webhooks
anima webhook get <id>    # Get webhook details
anima webhook delete <id> # Delete a webhook
anima webhook test <id>   # Send a test event to a webhook
anima webhook deliveries <id>  # List webhook delivery history
```

`webhook create` also takes advanced settings — endpoint auth (in addition to the `X-Anima-Signature` HMAC) and a delivery throttle:

```bash
anima webhook create \
  --url https://example.com/hooks/anima \
  --events message.received,message.sent \
  --auth-config '{"type":"bearer","token":"whsec_..."}' \
  --rate-limit-per-minute 120 \
  --max-attempts 5
```

### `security` — Security monitoring and scanning

```bash
anima security events     # List security events
anima security scan <content>  # Scan content for security threats
```

### `init` — Set up Anima CLI

```bash
anima init                         # Interactive setup wizard
anima init --non-interactive \     # Scripted setup
  --api-key ak_... \
  --org my-org
```

## Configuration

The CLI reads configuration in this priority order:

1. **CLI flags** (`--token`, `--api-url`, `--json`, `--debug`)
2. **Environment variables** (`ANIMA_API_URL`, `ANIMA_API_KEY`)
3. **Active profile** (set via `anima config profile use <name>`)
4. **Default config** (set via `anima config set` or `anima init`)

Configuration files are stored in:
- **macOS**: `~/Library/Preferences/anima/`
- **Linux**: `~/.config/anima/`
- **Windows**: `%APPDATA%/anima/`

### Global Flags

| Flag | Description |
|------|-------------|
| `--json` | Output results as JSON |
| `--debug` | Enable debug output |
| `--token <token>` | API token (overrides stored auth) |
| `--api-url <url>` | API base URL (overrides stored config) |

## Building from Source

```bash
# Install dependencies
bun install

# Run in development
bun run dev -- <command>

# Build standalone binary
bun run build

# Run tests
bun test

# Type check
bun run typecheck
```

## Community

Join the [Anima Discord](https://discord.gg/pY3GK59Z9E) to ask questions, share what you're building in `#showcase`, and stay up to date with releases in `#announcements`.

## License

MIT - see [LICENSE](./LICENSE)

## Links

- [Documentation](https://docs.useanima.sh)
- [Discord](https://discord.gg/pY3GK59Z9E)
- [GitHub](https://github.com/anima-labs-ai/cli)
- [Issues](https://github.com/anima-labs-ai/cli/issues)
- [Anima Platform](https://useanima.sh)
