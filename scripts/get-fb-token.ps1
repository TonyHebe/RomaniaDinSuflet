# Run this in PowerShell. Replace YOUR_SHORT_LIVED_TOKEN with your token from Graph API Explorer if the one below is expired.
$shortLivedToken = "EAFjZCuZCu8IH0BQ7CDqGUCrZBNQoOi5Ma0X54a9Aavbj7g7qvQbZCpz5mt1ApS7nqHkXkfUYku5BbHbKXuPi8rnZA1ZCwJp5ced2xBaQvQTuvj5UUpZAqwsxyQR6L7R2GecMYarctZARpjdZB6vUdJPLD1SmvsXXUdstNkikxQYUreKdZAX1D74No9eNd2l3PR8ot9R6IXLYwDmZCqR8ZCEBmqMxYtZB1ypNAmWAYxZBNgfv1SQbt0sXynyLzIozpsTIrJt5MJTeap299ImPV5mkZAZAOjXGPG2FIqegajnhHwZDZD"
$url = "https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=25050980797915261&client_secret=22729152de55e6b817e2f9f34ccfdbbf&fb_exchange_token=$shortLivedToken"
$r = Invoke-WebRequest $url -UseBasicParsing
$token = ($r.Content | ConvertFrom-Json).access_token
$token | Set-Content -Path "fb-longlived-token.txt" -NoNewline
Write-Host "Long-lived token saved to fb-longlived-token.txt - open that file to copy the full token."
