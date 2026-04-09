# Run in PowerShell. Replace SHORT_LIVED_TOKEN with your token from Graph API Explorer (User, Generate Access Token).
# Then run: .\scripts\get-page-token.ps1
# Or: $short = "YOUR_TOKEN"; .\scripts\get-page-token.ps1 (and edit the script to use $short)

param(
    [Parameter(Mandatory=$false)]
    [string]$ShortLivedToken = "PASTE_SHORT_LIVED_USER_TOKEN_HERE"
)

# Remove spaces/newlines so paste errors don't break the token
$ShortLivedToken = $ShortLivedToken.Trim()

$clientId = "25050980797915261"
$clientSecret = "22729152de55e6b817e2f9f34ccfdbbf"

# 1. Exchange for long-lived User token
$exchangeUrl = "https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=$clientId&client_secret=$clientSecret&fb_exchange_token=$ShortLivedToken"
$exResp = Invoke-WebRequest $exchangeUrl -UseBasicParsing
$longLived = ($exResp.Content | ConvertFrom-Json).access_token

# 2. Get Page token via me/accounts (requires USER token; Page tokens don't have "accounts")
$longLived = $longLived.Trim()
$accountsUrl = "https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token&access_token=$longLived"
$accResp = Invoke-WebRequest $accountsUrl -UseBasicParsing
$accJson = $accResp.Content | ConvertFrom-Json
if (-not $accJson.data) {
    Write-Error "me/accounts returned no pages. Use a USER token (Graph API Explorer -> Get User Access Token), not a Page token."
    exit 1
}
$accounts = $accJson.data

# 3. First page is usually "Romania din Suflet"
$pageToken = $accounts[0].access_token
$pageName = $accounts[0].name
Write-Host "Page: $pageName"
Write-Host "PAGE TOKEN (copy this to Vercel FB_PAGE_TOKEN):"
Write-Host $pageToken
