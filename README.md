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

Primary binary: **`am`**
Alias binary: **`anima`**

## Command Reference

### `auth` — Authentication and session management

```bash
am auth login          # Authenticate with Anima
am auth logout         # Clear stored credentials
am auth whoami         # Show current user info
```

### `identity` — Manage agent identities

```bash
am identity create     # Create a new agent identity
am identity list       # List all identities
am identity get <id>   # Get identity details
am identity update     # Update identity properties
am identity delete     # Delete an identity
am identity rotate-key # Rotate identity signing key
```

### `email` — Send and manage emails

```bash
am email send          # Send an email
am email list          # List received emails
am email get <id>      # Get email details
```

#### `email domains` — Custom domain management

```bash
am email domains add       # Add a custom domain
am email domains list      # List configured domains
am email domains get       # Get domain details
am email domains verify    # Verify domain DNS records
am email domains dns       # Show required DNS records
am email domains deliverability  # Check deliverability status
am email domains delete    # Remove a domain
```

### `phone` — Manage phone numbers and SMS

```bash
am phone search        # Search available phone numbers
am phone provision     # Provision a new phone number
am phone list          # List provisioned numbers
am phone release       # Release a phone number
am phone send-sms      # Send an SMS message
```

### `card` — Manage virtual payment cards

```bash
am card create         # Create a virtual card
am card list           # List all cards
am card get <id>       # Get card details
am card update         # Update card settings
am card delete         # Delete a card
am card transactions   # List card transactions
am card kill-switch    # Emergency disable all cards
```

### `vault` — Manage password vault credentials

```bash
am vault provision     # Provision vault for an identity
am vault deprovision   # Remove vault from an identity
am vault status        # Check vault status
am vault sync          # Sync vault data
am vault store         # Store a credential
am vault get           # Retrieve a credential
am vault list          # List all credentials
am vault search        # Search credentials
am vault delete        # Delete a credential
am vault generate      # Generate a password
am vault totp          # Generate TOTP code
```

### `config` — Manage CLI configuration and profiles

```bash
am config set <key> <value>   # Set a config value
am config get <key>           # Get a config value
am config list                # List all config values
am config profile             # Manage named profiles
```

### `setup-mcp` — Configure MCP server for AI clients

```bash
am setup-mcp install   # Install MCP config for a client
am setup-mcp uninstall # Remove MCP config
am setup-mcp status    # Check MCP integration status
am setup-mcp verify    # Verify MCP server connectivity
```

### `extension` — Manage Anima Chrome extension

```bash
am extension install   # Install the Chrome extension
am extension status    # Check extension status
```

### `admin` — Organization and team administration

```bash
am admin org list          # List organizations
am admin member invite     # Invite a team member
am admin member role       # Update member role
am admin key rotate        # Rotate org API key
am admin key revoke        # Revoke an API key
am admin kyb status        # Check KYB verification status
am admin usage             # View usage statistics
```

### `webhook` — Manage webhooks

```bash
am webhook create      # Create a webhook
am webhook list        # List all webhooks
am webhook get <id>    # Get webhook details
am webhook delete <id> # Delete a webhook
am webhook test <id>   # Send a test event to a webhook
am webhook deliveries <id>  # List webhook delivery history
```

### `security` — Security monitoring and scanning

```bash
am security events     # List security events
am security scan <content>  # Scan content for security threats
```

### `init` — Set up Anima CLI

```bash
am init                         # Interactive setup wizard
am init --non-interactive \     # Scripted setup
  --api-key ak_... \
  --org my-org
```

## Configuration

The CLI reads configuration in this priority order:

1. **CLI flags** (`--token`, `--api-url`, `--json`, `--debug`)
2. **Environment variables** (`ANIMA_API_URL`, `ANIMA_API_KEY`, `AM_TOKEN`, `AM_API_URL`)
3. **Active profile** (set via `am config profile use <name>`)
4. **Default config** (set via `am config set` or `am init`)

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

## License

MIT - see [LICENSE](./LICENSE)

## Links

- [Documentation](https://docs.useanima.sh)
- [GitHub](https://github.com/anima-labs-ai/cli)
- [Issues](https://github.com/anima-labs-ai/cli/issues)
- [Anima Platform](https://useanima.sh)
