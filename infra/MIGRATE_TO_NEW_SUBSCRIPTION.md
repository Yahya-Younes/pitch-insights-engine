# Migrating to a new Azure subscription

This repo currently runs on one teammate's Azure subscription (resource group
`pitch-hackathon-rg`, region `eastus`). To move it onto a different
teammate's fresh subscription, that teammate should clone this repo, open
Claude Code in it, and paste the prompt below verbatim. It is written to be
fully self-contained — everything Claude needs is in the prompt itself, with
no assumption that Claude has seen this project before.

Do not delete or cancel the old subscription until the person running this
prompt has confirmed the new deployment is fully live (health check passing,
a live match running end to end in the browser, full test suite green).

---

## Prompt to paste into your own Claude Code session

```
I'm taking over deployment of this project ("Pitch Insights Engine") on my
own, brand-new Azure subscription (fresh account, ~$200 free credit). A
teammate built and ran it on their own subscription until now; I need to
stand up an independent, fully working copy on mine, with no shared Azure
resources between us. Do not touch or assume access to their subscription —
I don't have credentials for it anyway. Walk through this end to end and
verify each stage actually works before moving to the next; don't just run
commands and assume success.

## 0. Prerequisites

- `az login` with MY account, then `az account set --subscription <mine>` --
  confirm with `az account show` before doing anything else.
- Install the Azure CLI, Bicep CLI (`az bicep install`), Node.js, Python
  3.11+, and the Static Web Apps CLI (`npm install -g @azure/static-web-apps-cli`)
  if not already present.
- Pick a single region and use it for everything: `eastus` is what the
  original deployment used (Azure OpenAI fine-tuning + the model this project
  uses were confirmed available there) -- stick with `eastus` unless you hit
  a quota wall, to avoid discovering a regional availability gap mid-deploy.

## 1. Create the Azure AI Foundry resource manually first

`infra/main.bicep` deliberately does NOT create the AI Foundry account --
it references one as `existing` and only wires RBAC + env vars to it. You
must create it yourself first, through the Azure AI Foundry portal
(https://ai.azure.com -> Create new -> Project), NOT via a raw ARM/Bicep
resource of kind `OpenAI` -- it needs to be the full multi-service "AI
Services" (kind `AIServices`) account + Foundry project, same as the
original. Name the account `pitch-insights-engine` (keeps the Bicep
template's default parameter working with zero edits) in resource group
`pitch-hackathon-rg` (create that resource group first), region `eastus`.

Inside that Foundry project, deploy the model `gpt-5-mini` (same deployment
name, `gpt-5-mini` -- the container app's env var hardcodes this exact
deployment name). If `gpt-5-mini` isn't available in your subscription/
region, tell me and we'll pick the closest available equivalent and I'll
adjust the one place that references it (`infra/main.bicep` line with
`AZURE_AI_FOUNDRY_CHAT_DEPLOYMENT`).

This same AI Services account also covers Azure AI Speech -- there is no
separate Speech resource in this project. You'll pull a key from this same
account later for speech synthesis.

## 2. Deploy the rest of the infrastructure via Bicep

From the repo root:

```
pwsh infra/deploy.ps1 -ResourceGroup pitch-hackathon-rg
```

Read `infra/deploy.ps1` and `infra/main.bicep` first so you understand what
it does: it deploys Container Registry, Cosmos DB (handoff-log storage),
Event Hubs (match-event ingestion), Web PubSub (live frontend overlay),
Log Analytics + Application Insights, a Container Apps environment + the
`pitch-orchestrator` container app (starts on a placeholder image), a
user-assigned managed identity, and RBAC role assignments wiring that
identity to Cosmos/Event Hubs/Web PubSub/the Foundry account (Cognitive
Services User role) -- all via `DefaultAzureCredential`, no API keys. It
then builds the real service image in the cloud via `az acr build` (no local
Docker required) and points the container app at it.

If `foundryAccountName` differs from `pitch-insights-engine` (e.g. you named
it something else in step 1), pass
`--parameters foundryAccountName=<your-name>` to the `az deployment group
create` call inside `deploy.ps1` (edit the script or pass
`-TemplateParameters` -- check what's cleanest given the script as written).

Verify after this step: `az containerapp show --name pitch-orchestrator
--resource-group pitch-hackathon-rg` exists and `GET
https://<its-fqdn>/health` returns 200 -- but expect some endpoints to 404
until step 3 below, since two required env vars aren't in the Bicep template.

## 3. Two env vars that are NOT in the Bicep template -- set manually

The live original deployment has `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION`
(for voice narration) and `MCP_ALLOWED_HOST` (for the `/mcp` server) set
directly on the container app, outside of Bicep. Set them on yours too:

```
az cognitiveservices account keys list --name pitch-insights-engine \
  --resource-group pitch-hackathon-rg --query key1 -o tsv
```

Then:

```
az containerapp secret set --name pitch-orchestrator \
  --resource-group pitch-hackathon-rg \
  --secrets azure-speech-key=<the key you just fetched>

az containerapp update --name pitch-orchestrator \
  --resource-group pitch-hackathon-rg \
  --set-env-vars \
    AZURE_SPEECH_REGION=eastus \
    AZURE_SPEECH_KEY=secretref:azure-speech-key \
    MCP_ALLOWED_HOST=<your container app's own FQDN, e.g. pitch-orchestrator.<something>.eastus.azurecontainerapps.io>
```

Get your container app's FQDN via `az containerapp show --name
pitch-orchestrator --resource-group pitch-hackathon-rg --query
properties.configuration.ingress.fqdn -o tsv`.

Re-check `/health` and also hit `/stats` and `/tactics-lab/formations` to
confirm the full API surface responds, not just health.

## 4. The fine-tuned narrator model -- cannot be migrated, must be retrained

Azure OpenAI/Foundry fine-tuning jobs and their resulting custom models are
permanently scoped to the specific Cognitive Services resource and region
they were trained in. There is no export/import or cross-subscription copy
mechanism for a fine-tuned model in this service -- it has to be retrained
against YOUR new Foundry resource. The good news: the training data is
already committed in this repo (`tools/finetune_data/narrator_distillation.jsonl`,
752 examples), so you don't need to regenerate it -- just launch a new job
against your resource using the existing file.

Read `tools/launch_finetune.py` FIRST -- its module docstring documents
several genuinely undocumented gotchas that cost real trial-and-error time
the first time around (the correct API surface is `/openai/v1/...`, not the
classic `api-version=` one; the field is snake_case `training_type` with
value `"developer"`, not Microsoft's documented camelCase; the "auto"
hyperparameter sentinels are the integers `-1` / `-1` / `2`, not the string
`"auto"` the SDK/docs show). Follow that script's instructions exactly.
If the REST path still misbehaves the way the docstring warns about, fall
back to submitting the fine-tuning job through the Azure AI Foundry portal's
own fine-tuning wizard UI instead (it works reliably), then use
`tools/deploy_finetuned_model.py` to deploy the resulting model.

This whole step (job + deploy) takes about 1.5 hours end to end mostly
waiting on the training job -- kick it off early, don't block other steps on
it. Note Developer-tier fine-tuned deployments auto-expire 24 hours after
creation (evaluation tier, not a bug) -- redeploy with
`tools/deploy_finetuned_model.py create <fine_tuned_model_id>` shortly
before you actually need to demo it, not days in advance.

## 5. Frontend

Update `frontend/.env.production` -- it currently hardcodes the OLD
container app's URL as `VITE_API_BASE_URL`. Point it at YOUR container
app's FQDN from step 3. Then:

```
cd frontend
npm install
npm run build
```

Create a new Static Web App resource (one isn't in `infra/main.bicep` as a
one-shot deployable target the way the rest is -- check
`infra/main.bicep`'s `staticWebApp` resource block for the exact
properties used, e.g. SKU, and either add it to your Bicep deploy or create
it directly via `az staticwebapp create --name <your-name> --resource-group
pitch-hackathon-rg --location eastus2 --sku Free`). Note the original used
`eastus2` for the static web app specifically (not `eastus` like everything
else) -- Static Web Apps has a smaller region list than most services.

Get a deployment token (`az staticwebapp secrets list --name <your-name>
--query properties.apiKey -o tsv`) and deploy:

```
npx -y @azure/static-web-apps-cli deploy ./dist --deployment-token <token> --env production
```

Backend CORS is already `allow_origins=["*"]` (see `service/main.py`), so no
backend change is needed for a new frontend origin.

## 6. Verify everything before telling anyone this is done

- `python -m pytest` -- full offline suite should be green with zero Azure
  dependency.
- `PITCH_E2E_BASE_URL=https://<your container app fqdn> python -m pytest
  tests/e2e -v -s` -- live smoke test against your real deployment.
- Open your new Static Web App URL in a browser, start a live match, confirm
  insights stream in with audio, try the Tactics Lab and persona-compare
  panels, confirm `/stats` chips all populate.
- Only once ALL of the above pass, report back that the migration is
  verified -- that's the signal the original subscription is safe to delete.

If you get stuck anywhere, especially the Foundry fine-tuning API quirks in
step 4 or the AI Foundry account/project creation in step 1 (those are the
two steps that aren't a plain `az deployment group create` away), stop and
ask me rather than guessing around undocumented Azure behavior.
```
