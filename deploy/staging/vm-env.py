"""Write the staging VM's root-only Compose environment from staging secrets.

Run on the dedicated VM as root. The VM service account needs access only to
the named staging Secret Manager secrets. No secret values are logged.
"""

import base64
import json
import os
import re
from pathlib import Path
from urllib.request import Request, urlopen


PROJECT = "shopsphere-mcp-stage-260923"
OUT = Path("/opt/shopsphere-stage/.env")
METADATA = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
SECRET_NAMES = {
    "APP_DB_PASSWORD": "stage-app-db-password",
    "KEYCLOAK_DB_PASSWORD": "stage-auth-db-password",
    "REDIS_PASSWORD": "stage-redis-password",
    "ASSISTANT_DB_PASSWORD": "stage-assistant-db-password",
    "ASSISTANT_PRIVATE_DB_PASSWORD": "stage-assistant-private-db-password",
    "ASSISTANT_API_TOKEN": "stage-assistant-api-token",
    "ASSISTANT_CURSOR_SECRET": "stage-assistant-cursor-secret",
    "JWT_SECRET": "stage-jwt-secret",
    "ADMIN_PASSWORD": "stage-admin-password",
    "DEMO_PASSWORD": "stage-demo-password",
    "ESEWA_SECRET_KEY": "stage-esewa-test-secret",
    "ASSISTANT_OAUTH_CLIENT_SECRET": "stage-assistant-oauth-secret",
    "KEYCLOAK_SYNC_CLIENT_SECRET": "stage-keycloak-sync-secret",
}


def read_json(url: str, headers: dict[str, str]) -> dict:
    with urlopen(Request(url, headers=headers), timeout=20) as response:
        return json.load(response)


token = read_json(METADATA, {"Metadata-Flavor": "Google"})["access_token"]
headers = {"Authorization": f"Bearer {token}"}
values = {
    key: base64.b64decode(
        read_json(
            f"https://secretmanager.googleapis.com/v1/projects/{PROJECT}/secrets/{name}/versions/latest:access",
            headers,
        )["payload"]["data"]
    ).decode("utf-8")
    for key, name in SECRET_NAMES.items()
}
for key, value in values.items():
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        invalid = [(index, ord(char)) for index, char in enumerate(value) if char not in "0123456789abcdef"]
        raise ValueError(f"{key} has length {len(value)} and non-hex characters {invalid}")
values.update(
    STAGE_VM_IP="10.42.0.2",
    STAGE_FRONTEND_URL="https://shopsphere-stage-frontend-697933410613.asia-south1.run.app",
    STAGE_AUTH_URL="https://shopsphere-stage-auth-697933410613.asia-south1.run.app",
    BACKEND_IMAGE=(
        "asia-south1-docker.pkg.dev/shopsphere-mcp-stage-260923/shopsphere-staging/"
        "backend@sha256:4cce899a026c015330b3daeb18ecdc255c6f2199ef9f12c6b3f4eb5d37df3872"
    ),
)
OUT.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
fd = os.open(OUT, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as file:
    for key, value in values.items():
        file.write(f"{key}={value}\n")
os.chmod(OUT, 0o600)
print(f"Wrote {len(values)} staging settings to root-only {OUT}")
