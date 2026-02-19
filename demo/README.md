# A2H Gateway POC

> **Note:** This is a proof-of-concept demonstration of the A2H protocol. It uses in-memory storage, a hardcoded API key, and is not intended for production use.

One process, one port. MCP and REST are two interfaces to the same room.

## Quick Start

### Terminal 1: Start the Gateway

```bash
cd a2h-spec/demo
npm install
node server.js
```

### Terminal 2: Use with Claude Code

Add to your Claude Code MCP config (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "a2h": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Then ask Claude Code: *"Delete my temp files"* — it will call `human_authorize`, and you'll get an approval link in Terminal 1.

## MCP Tools

| Tool | Description |
|------|-------------|
| `human_authorize` | Request passkey-authenticated approval for high-stakes actions |
| `human_inform` | Send fire-and-forget notifications |
| `check_status` | Poll for authorization decision |

## State Machine

```
PENDING → SENT → WAITING_INPUT → ANSWERED | EXPIRED
```

## REST API

All `/v1/*` endpoints require `Authorization: Bearer a2h_demo_secret`.

```bash
# Request authorization
curl -X POST http://localhost:3000/v1/intent \
  -H "Authorization: Bearer a2h_demo_secret" \
  -H "Content-Type: application/json" \
  -d '{"type":"AUTHORIZE","principal_id":"user","render":{"body":"Delete temp files?"}}'

# Check status
curl http://localhost:3000/v1/status/INTERACTION_ID \
  -H "Authorization: Bearer a2h_demo_secret"
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `A2H_API_KEY` | `a2h_demo_secret` | Bearer token for agent auth |
| `BASE_URL` | `http://localhost:3000` | Public URL for approval links |
| `RP_ID` | `localhost` | WebAuthn Relying Party ID |

## Assurance Levels

| Method | Trust Level | Use Case |
|--------|-------------|----------|
| **WebAuthn/Passkey** | Cryptographic proof | Financial, deletions, system commands |
| Voice DTMF (future) | Attested consent | Phone-based confirmation |
| SMS reply (future) | Acknowledgment | Low-risk notifications |

This POC implements WebAuthn only — the highest assurance level.
