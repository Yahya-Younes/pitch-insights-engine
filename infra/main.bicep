// Pitch Insights Engine -- one-command infra for the deployed half of the pipeline.
// Pre-existing (created earlier, not managed here): the AI Foundry account
// `pitch-insights-engine` + project `pitch-match-engine` + gpt-5-mini deployment,
// in this same resource group.
targetScope = 'resourceGroup'

@description('Short, globally-unique-ish prefix used to derive resource names.')
param namePrefix string = 'pitch'

param location string = resourceGroup().location

@description('Name of the pre-existing AI Foundry (Cognitive Services) account in this resource group.')
param foundryAccountName string = 'pitch-insights-engine'

var uniqueSuffix = uniqueString(resourceGroup().id)
var acrName = toLower('${namePrefix}acr${uniqueSuffix}')
var cosmosAccountName = toLower('${namePrefix}-cosmos-${uniqueSuffix}')
var ehNamespaceName = toLower('${namePrefix}-eh-${uniqueSuffix}')
var webPubSubName = toLower('${namePrefix}-pubsub-${uniqueSuffix}')
var logAnalyticsName = '${namePrefix}-logs'
var appInsightsName = '${namePrefix}-insights'
var containerAppEnvName = '${namePrefix}-cae'
var containerAppName = '${namePrefix}-orchestrator'
var identityName = '${namePrefix}-orchestrator-identity'

// ---------- Identity ----------

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
}

// ---------- Observability ----------

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
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

// ---------- Container Registry ----------

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

resource acrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, 'AcrPull')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d') // AcrPull
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------- Event Hubs (ingestion transport for Scout) ----------

resource ehNamespace 'Microsoft.EventHub/namespaces@2023-01-01-preview' = {
  name: ehNamespaceName
  location: location
  sku: {
    name: 'Basic'
    tier: 'Basic'
    capacity: 1
  }
  properties: {}
}

resource eventHub 'Microsoft.EventHub/namespaces/eventhubs@2023-01-01-preview' = {
  parent: ehNamespace
  name: 'pitch-events'
  properties: {
    partitionCount: 2
    messageRetentionInDays: 1
  }
}

resource ehDataReceiverRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(ehNamespace.id, identity.id, 'EventHubsDataReceiver')
  scope: ehNamespace
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'a638d3c7-ab3a-418d-83e6-5f17a39d4fde') // Azure Event Hubs Data Receiver
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource ehDataSenderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(ehNamespace.id, identity.id, 'EventHubsDataSender')
  scope: ehNamespace
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '2b629674-e913-4c01-ae53-ef4638d8f975') // Azure Event Hubs Data Sender
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------- Cosmos DB (handoff log + match state) ----------

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    capabilities: [ { name: 'EnableServerless' } ]
    locations: [
      { locationName: location, failoverPriority: 0, isZoneRedundant: false }
    ]
    disableLocalAuth: false
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: 'pitch'
  properties: {
    resource: { id: 'pitch' }
  }
}

resource handoffLogContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDb
  name: 'handoff_log'
  properties: {
    resource: {
      id: 'handoff_log'
      partitionKey: { paths: [ '/match_id' ], kind: 'Hash' }
    }
  }
}

resource matchStateContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDb
  name: 'match_state'
  properties: {
    resource: {
      id: 'match_state'
      partitionKey: { paths: [ '/match_id' ], kind: 'Hash' }
    }
  }
}

// Cosmos data-plane RBAC uses its own role-assignment resource type, not Microsoft.Authorization.
var cosmosDataContributorRoleId = '${cosmos.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'

resource cosmosDataRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmos
  name: guid(cosmos.id, identity.id, 'CosmosDataContributor')
  properties: {
    roleDefinitionId: cosmosDataContributorRoleId
    principalId: identity.properties.principalId
    scope: cosmos.id
  }
}

// ---------- Web PubSub (live overlay feed to the frontend) ----------

resource webPubSub 'Microsoft.SignalRService/webPubSub@2023-08-01-preview' = {
  name: webPubSubName
  location: location
  sku: {
    name: 'Free_F1'
    tier: 'Free'
    capacity: 1
  }
  properties: {}
}

resource webPubSubHub 'Microsoft.SignalRService/webPubSub/hubs@2023-08-01-preview' = {
  parent: webPubSub
  name: 'pitch_overlay'
  properties: {
    // Clients always connect with a short-lived token minted by our own
    // /negotiate endpoint (see service/main.py) -- anonymous access is never
    // relied on, so it stays denied.
    anonymousConnectPolicy: 'deny'
  }
}

resource webPubSubOwnerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(webPubSub.id, identity.id, 'WebPubSubServiceOwner')
  scope: webPubSub
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '12cf5a90-567b-43ae-8102-96cf46c7d9b4') // Web PubSub Service Owner
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------- AI Foundry access for the orchestrator identity ----------

resource foundryAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: foundryAccountName
}

resource foundryUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryAccount.id, identity.id, 'CognitiveServicesUser')
  scope: foundryAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'a97b65f3-24c7-4388-baec-2e87135dc908') // Cognitive Services User
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------- Container Apps (hosts the Scout->Analyst0->Narrator->{Broadcaster,Concierge} orchestrator) ----------

resource containerAppEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: containerAppEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto'
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: identity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'orchestrator'
          // Placeholder image; replaced post-deploy by `az acr build` + `az containerapp update`
          // once the real service image exists (see infra/deploy.ps1).
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            // agent-framework pulls in a very large dependency tree (redis,
            // mistral, django/fastapi instrumentation, openai-agents, a2a-sdk,
            // full opentelemetry suite, etc.) -- 0.5 vCPU/1Gi was tight enough
            // under real request load to trigger periodic health-probe
            // restarts that silently killed in-flight background match
            // processing. 1.0/2Gi gives real headroom.
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: [
            { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
            { name: 'AZURE_AI_FOUNDRY_ENDPOINT', value: foundryAccount.properties.endpoint }
            { name: 'AZURE_AI_FOUNDRY_CHAT_DEPLOYMENT', value: 'gpt-5-mini' }
            { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
            { name: 'EVENTHUB_FQDN', value: '${ehNamespaceName}.servicebus.windows.net' }
            { name: 'EVENTHUB_NAME', value: 'pitch-events' }
            { name: 'EVENTHUB_CONSUMER_GROUP', value: '$Default' } // Basic tier only supports the default consumer group
            { name: 'WEBPUBSUB_ENDPOINT', value: 'https://${webPubSub.properties.hostName}' }
            { name: 'WEBPUBSUB_HUB', value: 'pitch_overlay' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
  dependsOn: [
    acrPullRoleAssignment
  ]
}

// ---------- Static Web App (frontend hosting) ----------

// Static Web Apps is only available in a handful of regions, distinct from
// where the rest of this stack lives.
var staticWebAppLocation = 'eastus2'

resource staticWebApp 'Microsoft.Web/staticSites@2024-04-01' = {
  name: '${namePrefix}-frontend'
  location: staticWebAppLocation
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {}
}

output staticWebAppHostname string = staticWebApp.properties.defaultHostname
output acrLoginServer string = acr.properties.loginServer
output containerAppFqdn string = containerApp.properties.configuration.ingress.fqdn
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output eventHubNamespace string = '${ehNamespaceName}.servicebus.windows.net'
output webPubSubEndpoint string = 'https://${webPubSub.properties.hostName}'
output identityClientId string = identity.properties.clientId
output identityPrincipalId string = identity.properties.principalId
