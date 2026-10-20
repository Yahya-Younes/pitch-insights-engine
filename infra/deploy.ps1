# One-command deploy: provisions infra (if not already), builds the service
# image in the cloud (no local Docker needed, via `az acr build`), and points
# the Container App at the freshly built image.
#
# Usage: pwsh infra/deploy.ps1 -ResourceGroup pitch-hackathon-rg

param(
    [string]$ResourceGroup = "pitch-hackathon-rg",
    [string]$TemplateFile = "infra/main.bicep"
)

$ErrorActionPreference = "Stop"

Write-Host "==> Deploying infrastructure ($TemplateFile) to $ResourceGroup" -ForegroundColor Cyan
$deployment = az deployment group create `
    --resource-group $ResourceGroup `
    --template-file $TemplateFile `
    --name "pitch-infra-$(Get-Date -UFormat %s)" `
    -o json | ConvertFrom-Json

$acrLoginServer = $deployment.properties.outputs.acrLoginServer.value
$containerAppFqdn = $deployment.properties.outputs.containerAppFqdn.value
Write-Host "==> ACR: $acrLoginServer" -ForegroundColor Cyan

Write-Host "==> Building service image in the cloud (az acr build)" -ForegroundColor Cyan
$imageTag = "$acrLoginServer/pitch-orchestrator:latest"
az acr build --registry ($acrLoginServer.Split('.')[0]) --image "pitch-orchestrator:latest" --file Dockerfile .

Write-Host "==> Pointing the Container App at the new image" -ForegroundColor Cyan
az containerapp update --name pitch-orchestrator --resource-group $ResourceGroup --image $imageTag

Write-Host "==> Done. Service URL: https://$containerAppFqdn" -ForegroundColor Green
Write-Host "    Health check:     https://$containerAppFqdn/health"
