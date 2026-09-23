$ErrorActionPreference = 'Stop'

# Staging only. Run after the staging VM and private Keycloak service are healthy.
$project = 'shopsphere-mcp-stage-260923'
$origin = 'https://shopsphere-stage-auth-697933410613.asia-south1.run.app'
$realm = "$origin/admin/realms/shopsphere"
$adminPassword = gcloud secrets versions access latest --secret=stage-keycloak-admin-password --project=$project
$identityToken = gcloud auth print-identity-token
if (-not $adminPassword -or -not $identityToken) { throw 'Staging credentials unavailable' }

try {
  $adminToken = Invoke-RestMethod -Method Post -Uri "$origin/realms/master/protocol/openid-connect/token" `
    -Headers @{ 'X-Serverless-Authorization' = "Bearer $identityToken" } `
    -ContentType 'application/x-www-form-urlencoded' `
    -Body @{ grant_type='password'; client_id='admin-cli'; username='stageadmin'; password=$adminPassword } `
    -TimeoutSec 45
  $headers = @{
    'X-Serverless-Authorization' = "Bearer $identityToken"
    Authorization = "Bearer $($adminToken.access_token)"
  }

  $profile = Invoke-RestMethod -Uri "$realm/users/profile" -Headers $headers -TimeoutSec 45
  foreach ($name in @('shopsphere_user_id', 'shopsphere_role', 'shopsphere_verified')) {
    $attribute = @($profile.attributes | Where-Object name -eq $name)[0]
    if (-not $attribute) {
      $profile.attributes += @{ name=$name; displayName=$name; multivalued=$false;
        permissions=@{ view=@('admin'); edit=@('admin') } }
    } else {
      $attribute.permissions = @{ view=@('admin'); edit=@('admin') }
    }
  }
  Invoke-RestMethod -Method Put -Uri "$realm/users/profile" -Headers $headers `
    -ContentType 'application/json' -Body ($profile | ConvertTo-Json -Depth 30 -Compress) -TimeoutSec 45 | Out-Null
  $storedProfile = Invoke-RestMethod -Uri "$realm/users/profile" -Headers $headers -TimeoutSec 45
  foreach ($name in @('shopsphere_user_id', 'shopsphere_role', 'shopsphere_verified')) {
    $attribute = @($storedProfile.attributes | Where-Object name -eq $name)[0]
    if (-not $attribute -or ($attribute.permissions.view -join ',') -ne 'admin' -or
        ($attribute.permissions.edit -join ',') -ne 'admin') { throw "Staging profile attribute $name not secured" }
  }
  Write-Output 'identityProfile=admin-only'

  $mcpClients = Invoke-RestMethod -Uri "$realm/clients?clientId=shopsphere-mcp-client" -Headers $headers -TimeoutSec 45
  $mcpClient = @($mcpClients | Where-Object clientId -eq 'shopsphere-mcp-client')[0]
  if (-not $mcpClient.id) { throw 'Staging MCP client missing' }
  $mcpClient.redirectUris = @('http://localhost:6274/oauth/callback', 'http://127.0.0.1:6274/oauth/callback')
  $mcpClient.webOrigins = @('http://localhost:6274', 'http://127.0.0.1:6274')
  Invoke-RestMethod -Method Put -Uri "$realm/clients/$($mcpClient.id)" -Headers $headers `
    -ContentType 'application/json' -Body ($mcpClient | ConvertTo-Json -Depth 30 -Compress) -TimeoutSec 45 | Out-Null
  Write-Output 'mcpRedirects=exact-loopback-only'

  $syncClients = Invoke-RestMethod -Uri "$realm/clients?clientId=shopsphere-account-sync" -Headers $headers -TimeoutSec 45
  $syncClient = @($syncClients | Where-Object clientId -eq 'shopsphere-account-sync')[0]
  $managementClients = Invoke-RestMethod -Uri "$realm/clients?clientId=realm-management" -Headers $headers -TimeoutSec 45
  $managementClient = @($managementClients | Where-Object clientId -eq 'realm-management')[0]
  if (-not $syncClient.id -or -not $managementClient.id) { throw 'Staging account-management client missing' }
  $serviceUser = Invoke-RestMethod -Uri "$realm/clients/$($syncClient.id)/service-account-user" -Headers $headers -TimeoutSec 45
  if (-not $serviceUser.id) { throw 'Staging account-sync service user missing' }
  $mappingUri = "$realm/users/$($serviceUser.id)/role-mappings/clients/$($managementClient.id)"
  $mapped = Invoke-RestMethod -Uri $mappingUri -Headers $headers -TimeoutSec 45
  foreach ($name in @('manage-users', 'view-users')) {
    if (@($mapped | ForEach-Object name) -notcontains $name) {
      $role = Invoke-RestMethod -Uri "$realm/clients/$($managementClient.id)/roles/$name" -Headers $headers -TimeoutSec 45
      Invoke-RestMethod -Method Post -Uri $mappingUri -Headers $headers -ContentType 'application/json' `
        -Body (ConvertTo-Json -InputObject @($role) -Depth 10 -Compress) -TimeoutSec 45 | Out-Null
    }
  }
  $mapped = Invoke-RestMethod -Uri $mappingUri -Headers $headers -TimeoutSec 45
  if (@($mapped | ForEach-Object name) -notcontains 'manage-users' -or
      @($mapped | ForEach-Object name) -notcontains 'view-users') { throw 'Staging account-sync roles missing' }
  Write-Output 'accountSyncRoles=manage-users,view-users'
} finally {
  $adminPassword = $null
  $adminToken = $null
  $identityToken = $null
}
