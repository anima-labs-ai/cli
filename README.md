# @anima-labs/cli

Official command-line interface for [Anima](https://useanima.sh) — identity infrastructure for AI agents. Manage agent identities, email, phone numbers, virtual cards, password vaults, and runtime configuration from your terminal.

## Installation

### Bun (recommended)

```bash
bun add -g @anima-labs/cli
```

### npm

```bash
npm install -g @anima-labs/cli
```

## Quick Start

```bash
# Set up your CLI (guided wizard)
anima init

# Authenticate
anima auth login

# Create an agent identity
anima identity create --name "my-agent" --display-name "My Agent"

# Send an email
anima email send --from agent@yourdomain.com --to user@example.com --subject "Hello" --body "Hi there"
```

Primary binary: **`anima`**

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

### `card` — Manage virtual payment cards

```bash
anima card create         # Create a virtual card
anima card list           # List all cards
anima card get <id>       # Get card details
anima card update         # Update card settings
anima card delete         # Delete a card
anima card transactions   # List card transactions
anima card kill-switch    # Emergency disable all cards
```

### `vault` — Manage password vault credentials

```bash
anima vault provision     # Provision vault for an identity
anima vault deprovision   # Remove vault from an identity
anima vault status        # Check vault status
anima vault sync          # Sync vault data
anima vault store         # Store a credential
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
anima extension install   # Install the Chrome extension
anima extension status    # Check extension status
```

### `admin` — Organization and team administration

```bash
anima admin org list          # List organizations
anima admin member invite     # Invite a team member
anima admin member role       # Update member role
anima admin key rotate        # Rotate org API key
anima admin key revoke        # Revoke an API key
anima admin kyb status        # Check KYB verification status
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
