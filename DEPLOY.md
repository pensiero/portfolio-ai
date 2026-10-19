# Deploying portfolio-ai

**Read this before changing anything that has to reach production.** Deploying
is not `git push`. Nothing watches this repository: no CI, no registry
webhook, no reconciler. A deploy is a few manual steps across **two
repositories**, and skipping any of them leaves production on the old version
while both repos look up to date.

Live at **https://www.oscarfanelli.com**. Namespace and Helm release: `portfolio-ai`.

## The shape of it

```
portfolio-ai repo                 takamagahara repo                 cluster
─────────────────                 ─────────────────                 ───────
source ──docker buildx──▶ Docker Hub                           ┌─▶ pod pulls
                          pensiero/portfolio-ai:<tag>          │   the tag
                                    │                          │
                                    └──▶ image.tag + env in    │
                                         values/clusters/      │
                                         apps/portfolio-ai.yaml ──deploy.sh──┘
```

The platform repository is at **`~/Projects/_infrastructure/takamagahara`**.

What needs what:

| Change | Image rebuild? | Where |
|---|---|---|
| Code (`server.js`, `lib/`, `public/`) | **Yes**, plus a tag bump | this repo, then values `image.tag` |
| Model, provider, base URL | No | values `env:` (`OPENROUTER_MODEL`, `LLM_PROVIDER`) |
| The bio | No | sops secret `bootstrap/secrets/portfolio-ai/portfolio-ai-bio/` |
| API keys, Sheet webhook | No | sops secret `bootstrap/secrets/portfolio-ai/portfolio-ai-secrets.sops.env` |

- **The image tag is the deploy.** `imagePullPolicy: IfNotPresent` means a
  re-pushed tag is never re-pulled. Overwriting a tag is a no-op that looks
  like success. Always bump, never use `latest`.
- **The cluster is x86_64; the laptop is Apple silicon.** Without
  `--platform linux/amd64` the pod dies with `exec format error`.
- **The image is public.** `.dockerignore` is an allowlist (`server.js`, `lib`,
  `public`, package files). Keep it that way: `content/`, `interviews/`, `eval/`
  and `logs/` must never reach Docker Hub.
- **The chart lives in the other repository.** This repo has no Kubernetes manifests.

## Before you start

| Check | Command | If it fails |
|---|---|---|
| Platform repo present | `ls ~/Projects/_infrastructure/takamagahara` | **Stop.** You cannot deploy. Tell the user. |
| Docker running (code changes only) | `docker version` | Start OrbStack / Docker Desktop. |
| Logged in to the registry (code changes only) | `docker login` | Ask the user; do not guess credentials. |
| `yq` installed | `yq --version` | `brew install yq`. `deploy.sh` refuses without it. |
| Cluster reachable | `kubectl -n portfolio-ai get pods` | Open the tunnel, below. |

The K3s API is not publicly exposed. `~/.kube/config` points at
`127.0.0.1:6443`, so `kubectl` works from any directory while the tunnel is up:

```bash
export SSH_AUTH_SOCK="$HOME/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"
ssh -fN amaterasu
```

## The procedure: code change

```bash
npm start                                                       # smoke-test locally first
TAG=$(date +%Y%m%d-%H%M)
docker buildx build --platform linux/amd64 -t pensiero/portfolio-ai:$TAG --push .
# bump image.tag in ~/Projects/_infrastructure/takamagahara/values/clusters/apps/portfolio-ai.yaml
cd ~/Projects/_infrastructure/takamagahara
scripts/deploy.sh --dry-run portfolio-ai
scripts/deploy.sh portfolio-ai
```

Commit both repositories. The code change and the tag bump are one deploy in two commits.

## The procedure: switching model (no rebuild)

Pick the model with **`eval/PLAYBOOK.md`** first (about $0.20, dry run included). Then:

```bash
cd ~/Projects/_infrastructure/takamagahara
# edit OPENROUTER_MODEL under env: in values/clusters/apps/portfolio-ai.yaml
scripts/deploy.sh --dry-run portfolio-ai
scripts/deploy.sh portfolio-ai                 # env change rolls the pod
```

Also update the default in `lib/llm.js`, `.env.example` and the README table, so
local dev matches production. Add the outcome to the playbook's history.

**Fallback:** `anthropic/claude-haiku-5.5` (runner-up in the 2026-10-19 eval).
Switching to it is the same one-line change.

## The procedure: bio or secrets (no rebuild)

```bash
cd ~/Projects/_infrastructure/takamagahara
scripts/secrets.sh encrypt ~/Projects/portfolio-ai/content/private-context.md \
  --as bootstrap/secrets/portfolio-ai/portfolio-ai-bio/private-context.sops.md
# or, for keys: scripts/secrets.sh edit bootstrap/secrets/portfolio-ai/portfolio-ai-secrets.sops.env
scripts/deploy.sh portfolio-ai --allow-secret-change
```

Never `kubectl apply` a secret by hand: the cluster would drift from the repo.

## Verify

```bash
kubectl -n portfolio-ai rollout status deploy/web --timeout=120s
kubectl -n portfolio-ai get deploy web -o jsonpath='{.spec.template.spec.containers[*].image}{"\n"}'
kubectl -n portfolio-ai get deploy web -o jsonpath='{.spec.template.spec.containers[0].env}' | jq -r '.[] | select(.name=="OPENROUTER_MODEL").value'
curl -s -o /dev/null -w '%{http_code}\n' https://www.oscarfanelli.com/healthz   # 200
```

Then ask the live site one real question and check that the `model` in the
query log is the one you deployed: `kubectl -n portfolio-ai logs deploy/web --tail=5`.

## Downtime

None in practice. The app is stateless (no volume), `replicaCount: 1` with
`RollingUpdate`, so the new pod is Ready before the old one goes.

## Rolling back

Prefer reverting the values change (tag or env) and redeploying, so Git keeps
describing what is running. `helm -n portfolio-ai rollback portfolio-ai <revision>`
is faster but leaves Git out of step with the cluster.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `dial tcp 127.0.0.1:6443: connect: connection refused` | Tunnel closed | `ssh -fN amaterasu` (after exporting the 1Password `SSH_AUTH_SOCK`) |
| `TLS handshake timeout`, and reopening says `Address already in use` | Tunnel dead but still holding the port | `pkill -f "ssh -fN amaterasu"`, then reopen |
| `Permission denied (publickey)` on that ssh | Agent socket has no identities | Export the 1Password `SSH_AUTH_SOCK` above |
| `exec format error` | Built for arm64 | Rebuild with `--platform linux/amd64` |
| Deploy "succeeds", app unchanged | Tag not bumped | Bump, rebuild, push, redeploy |
| Every answer is a refusal | Bio secret missing/empty | Check the `portfolio-ai-bio` secret and the mount at `/data/private-context.md` |
| `… request failed: …` in the chat | Gateway/model error (bad id, key, quota) | `kubectl -n portfolio-ai logs deploy/web`; check the id exists on OpenRouter |
| Helm times out at 3m | Pod never became Ready | `kubectl -n portfolio-ai describe pod -l app.kubernetes.io/name=web` |

## Where the rest lives

The chart (`charts/apps/portfolio-ai`), values, encrypted secrets and the
runbook (`docs/apps/portfolio-ai.md`) are in takamagahara. The runbook is
authoritative for anything platform-side.
