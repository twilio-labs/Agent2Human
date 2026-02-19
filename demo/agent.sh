#!/bin/bash
# agent.sh - Test the A2H Gateway AUTHORIZE flow via REST API

echo "Sending A2H AUTHORIZE request..."
echo ""

curl -s -X POST 'http://localhost:3000/v1/intent' \
  -H 'Authorization: Bearer a2h_demo_secret' \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "AUTHORIZE",
    "principal_id": "demo-user",
    "render": {
      "body": "Allow agent to delete old backup files?\n\nFiles: /var/backups/old/*\nAction: Permanent deletion"
    },
    "assurance": {
      "required_factors": ["passkey.webauthn.v1"]
    },
    "ttl_sec": 300
  }' | python3 -m json.tool 2>/dev/null || cat

echo ""
echo "Check the server console for the approval link."
echo "Open it in your browser to approve with your passkey."
