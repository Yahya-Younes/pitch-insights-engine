// Pitch Insights Engine -- standalone Application Insights deployment.
//
// main.bicep already DECLARES this resource (and the Container App
// template already references its connection string as an env var), but
// it never actually got created in the live resource group -- likely a
// partial ARM deployment, since ARM deployments aren't atomic across
// resources. Re-running the full main.bicep against the live resource
// group is NOT safe: its Container App resource hardcodes a hello-world
// placeholder image (the real image is patched in later by a separate
// `az acr build` + `az containerapp update --image` step per deploy.ps1),
// so a full re-apply would roll the live, working revision back to that
// placeholder and take down the demo.
//
// This file creates exactly the one missing resource, safely, as an
// additive deployment: `az deployment group create --resource-group
// pitch-hackathon-rg --template-file infra/appinsights.bicep`. The
// Container App's env var is then patched separately and surgically via
// `az containerapp update --set-env-vars APPLICATIONINSIGHTS_CONNECTION_STRING=...`
// -- that command only changes what's explicitly passed, never the image.
targetScope = 'resourceGroup'

@description('Short, globally-unique-ish prefix used to derive resource names -- must match main.bicep\'s namePrefix.')
param namePrefix string = 'pitch'

param location string = resourceGroup().location

@description('Name of the already-existing Log Analytics workspace (created by main.bicep) to attach Application Insights to.')
param logAnalyticsName string = '${namePrefix}-logs'

var appInsightsName = '${namePrefix}-insights'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsName
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

output connectionString string = appInsights.properties.ConnectionString
