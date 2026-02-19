# OpenClaw + A2H Integration Demo

> **Note:** This is a conceptual demonstration of the A2H protocol, not a production integration. It uses in-memory storage, has no real authentication, and simulates OpenClaw's behavior. It is meant to illustrate how A2H-based consent could complement an agent framework's existing approval flow.

This demo shows how OpenClaw could integrate with A2H to add cryptographic consent evidence to tool approvals.

## What this demonstrates

1. **OpenClaw agent** requests approval for a dangerous command (`rm -rf`)
2. **A2H Gateway** receives the AUTHORIZE intent and generates an approval link
3. **Human** authenticates with passkey (Touch ID, Face ID, etc.)
4. **A2H Gateway** returns signed evidence back to OpenClaw
5. **OpenClaw** proceeds with execution, attaching evidence to audit log

## Prerequisites

- Node.js >= 18
- A browser with WebAuthn support (Chrome, Safari, Firefox)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the A2H Gateway (terminal 1)
npm start

# 3. Run the OpenClaw simulator (terminal 2)
node openclaw-simulator.js

# 4. Click the approval link shown in terminal 1
# 5. Register a passkey (first time only), then approve
```

## What happens

### Terminal 1 (A2H Gateway)
```
A2H Gateway listening on http://localhost:3001
Run 'node openclaw-simulator.js' to test.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
→ A2H AUTHORIZE REQUEST
  Ticket: openclaw-exec-abc123
  Principal: did:example:alice
  Action: rm -rf /var/backups/old/*
  Assurance: passkey.webauthn.v1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔗 Approval Link: http://localhost:3001/decide?ticket=...
```

### Terminal 2 (OpenClaw Simulator)
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  OpenClaw + A2H Integration Demo
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[OpenClaw] User requested: "delete old backups"
[OpenClaw] Resolved command: rm -rf /var/backups/old/*
[OpenClaw] Command matches pattern "rm *" → assurance: HIGH
[OpenClaw] Sending AUTHORIZE to A2H Gateway...

[A2H] Request accepted, ticket: openclaw-exec-abc123
[A2H] Waiting for human approval...

[OpenClaw] Polling for response...
```

### After approval
```
[A2H] ✓ APPROVED with passkey evidence
[OpenClaw] Received cryptographic proof of consent
[OpenClaw] Evidence hash: sha256:abc123...
[OpenClaw] Executing command: rm -rf /var/backups/old/*
[OpenClaw] Audit log entry created with evidence attached
```

## Hypothetical OpenClaw Config

This is the proposed config format for A2H integration:

```json
{
  "tools": {
    "exec": {
      "ask": "a2h",
      "a2h": {
        "gateway": "http://localhost:3001",
        "assurance": {
          "rm *": "HIGH",
          "git push --force": "HIGH",
          "git push": "MEDIUM",
          "default": "LOW"
        }
      }
    }
  }
}
```

### Assurance Levels

| Level | Auth Method | Use Case |
|-------|-------------|----------|
| HIGH | Passkey (WebAuthn) | Destructive ops, financial transactions |
| MEDIUM | OTP (SMS/Email) | Significant changes, external actions |
| LOW | Link click | Low-risk confirmations |

## Files

- `server.js` - A2H Gateway with WebAuthn support
- `openclaw-simulator.js` - Simulates OpenClaw agent behavior
- `openclaw-config.example.json` - Hypothetical OpenClaw config

## How it differs from the reference demo

| Reference Demo (`/demo`) | This Example |
|--------------------------|--------------|
| Generic agent simulation | OpenClaw-specific flow |
| One-shot request | Polling for response |
| Minimal output | Detailed step-by-step logging |
| Port 3000 | Port 3001 (can run alongside) |

## Possible Integration Path

This example illustrates one way A2H could work with an agent framework like OpenClaw. A real integration would involve:

- Adding an `ask: "a2h"` mode to OpenClaw's exec tool config
- Implementing an A2H gateway client in OpenClaw core
- Wiring signed evidence into OpenClaw's existing audit logging

See OpenClaw's [exec approvals](https://docs.openclaw.ai/tools/exec-approvals) documentation for how its current approval system works.
