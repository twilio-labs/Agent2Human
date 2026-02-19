# A2H Protocol Specification

Agent-to-Human (A2H) communication protocol for multi-channel approvals.

## Contents

| File | Description |
|------|-------------|
| `a2h_framework.md` | Protocol whitepaper and v1.0 specification |
| `a2h-protocol.yaml` | OpenAPI 3.1 schema definition |
| `demo/` | Runnable proof-of-concept (WebAuthn/Passkey) |
| `examples/openclaw-integration/` | OpenClaw agent integration example |
| `examples/twilio-sms/` | SMS channel example with Twilio |

## Quick Start (Demo)

```bash
cd demo
npm install
npm start
```

In another terminal:
```bash
cd demo
bash agent.sh
```

Then open the approval link printed in the server console.

## Documentation

See `a2h_framework.md` for the full protocol specification including:
- Core intent types (INFORM, COLLECT, AUTHORIZE, ESCALATE, RESULT)
- Message envelope structure
- State machine
- Authentication and security considerations
- Channel failover and webhooks

## OpenAPI Schema

The `a2h-protocol.yaml` file provides a machine-readable schema for:
- API endpoints (`/v1/intent`, `/v1/status/{id}`, `/v1/cancel/{id}`)
- Message type definitions
- Error response formats
- Gateway discovery (`/.well-known/a2h`)
