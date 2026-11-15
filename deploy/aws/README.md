# Hosting on AWS (Free plan)

The whole stack runs on one EC2 instance with Docker Compose, and Caddy handles HTTPS. On a
Free plan account (created after July 15, 2025), usage comes out of the $100–$200 sign-up
credits and the card is never charged. AWS closes the account after 6 months or when the
credits run out, whichever comes first.

Expected burn in `ap-southeast-2`: t3.small ~$19/month + 20 GB gp3 ~$1.90 + public IPv4 ~$3.60
≈ $25/month.

## Do not

- Upgrade to the Paid plan, or enable AWS Organizations, IAM Identity Center or Control Tower.
  Each of these moves the account to Paid, and you can't move it back.
- Add RDS, a load balancer, a NAT gateway or Secrets Manager. Each one drains credits.
- Leave an Elastic IP attached to a stopped instance. This setup doesn't need one.

## Steps

1. **Account.** Choose the Free plan at sign-up. Use the project's selected Region for everything
   (this project: `ap-southeast-2` Sydney). New-experience projects can't create resources
   in any other Region. In Billing → Budgets, create a $1 cost budget with an email alert. This
   also earns credits.
2. **Instance.** EC2 → Launch instance:
   - Ubuntu Server 24.04 LTS (x86), `t3.small`, new key pair, 20 GB gp3.
   - Security group: SSH 22 from **My IP** only, HTTP 80 and HTTPS 443 from anywhere.
     Don't open any other port.
3. **Bootstrap.** SSH in (`ssh -i key.pem ubuntu@<public-ip>`) and run
   [bootstrap.sh](bootstrap.sh). Then log out and back in.
4. **Configure.** In `~/Shopsphere`:
   ```bash
   cp deploy/aws/env.example deploy/aws/.env && chmod 600 deploy/aws/.env
   cp backend/config/config.env.example backend/config/config.env && chmod 600 backend/config/config.env
   ```
   - In `deploy/aws/.env`, replace `1-2-3-4` with the instance's public IP using dashes
     (for example `13-232-5-9.sslip.io`). Fill every secret with `openssl rand -hex 32`.
   - In `backend/config/config.env`, set `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
     `DEMO_PASSWORD` and any of `GROQ_API_KEY` / `EMAIL_*` / `GOOGLE_CLIENT_ID` you use. The
     database, Redis, Keycloak and frontend URLs are overridden by the compose overlay.
   - In `backend/config/config.env`, set `MCP_ACCOUNT_COHORT` to the ShopSphere account IDs
     allowed to use private MCP tools. If it's empty, every account is denied.
5. **Start.**
   ```bash
   docker compose -f docker-compose.yml -f deploy/aws/compose.yml --env-file deploy/aws/.env up -d --build
   ```
   The first build takes several minutes on a t3.small. Then open `https://<SHOP_HOST>`.
6. **Update later.** Run `git pull`, then the same `up -d --build` command.

## MCP

The MCP server is at `https://<MCP_PUBLIC_HOST>/mcp`, and its OAuth issuer is
`https://<AUTH_HOST>/realms/shopsphere`. `MCP_ENABLED=true` only turns the server on; each tool
also needs its own `MCP_TOOL_*_ENABLED=true` in `deploy/aws/.env`. Follow
[the phased release runbook](../../docs/mcp-phased-release-runbook.md) for which ones to enable.

The realm allows only one pre-registered client (`shopsphere-mcp-client`), and its only
redirect URI is MCP Inspector's (`http://localhost:6274/oauth/callback`). To connect another MCP
client, add its callback URL in the Keycloak admin console and in `MCP_CLIENT_REDIRECT_URIS`.
The console isn't public. Open it through an SSH tunnel:

```bash
ssh -i key.pem -L 8080:127.0.0.1:8080 ubuntu@<public-ip>
```

Then go to `http://localhost:8080/admin` and sign in with `KEYCLOAK_ADMIN_USERNAME` /
`KEYCLOAK_ADMIN_PASSWORD`. Open realm `shopsphere` → Clients → `shopsphere-mcp-client` → Valid
redirect URIs. The realm file is imported only on the first start, so later edits to
`infra/keycloak/realm-shopsphere.json` don't reach a running Keycloak.

The public IP changes if you stop and start the instance. If it does, update every host in
`.env` and re-run step 5.

## Before month 6

AWS emails you when 50%, 25% and 10% of credits remain. To keep the data, run this before
the account closes:

```bash
docker compose -f docker-compose.yml -f deploy/aws/compose.yml --env-file deploy/aws/.env \
  exec postgres pg_dump -U shopsphere shopsphere > shopsphere.sql
```

Copy the file off the box with `scp`. After that, either let the account close, or upgrade to
Paid knowing normal billing starts.
