<#
.SYNOPSIS
  Downloads (or updates) the latest Lavalink server and runs it with pm2.

.DESCRIPTION
  - Checks that Java 17 or newer is installed
  - Downloads the newest Lavalink.jar from GitHub (skipped when already up to date)
  - Writes application.yml with YouTube (OAuth/Cipher), LavaSrc (Spotify) and SoundCloud
  - Uses LAVALINK_PASSWORD, SPOTIFY_* and YOUTUBE_REFRESH_TOKEN from .env
  - Starts or restarts Lavalink under pm2 and waits until it answers

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup-lavalink.ps1
#>
param(
  [string]$InstallDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'lavalink'),
  [int]$Port = 2333,
  [string]$Password = '',
  [string]$YouTubeRefreshToken = '',
  [int]$MemoryMB = 1024,
  [string]$Name = 'lavalink'
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RepoRoot = Split-Path $PSScriptRoot -Parent
$EnvFile = Join-Path $RepoRoot '.env'
$GitHubHeaders = @{ 'User-Agent' = 'luko-lavalink-setup' }

function Write-Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "    $text" -ForegroundColor Green }
function Fail($text) { Write-Host "`n[x] $text" -ForegroundColor Red; exit 1 }

function Write-TextFile($path, $text) {
  [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $false))
}

function Get-LatestRelease($repo) {
  return Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers $GitHubHeaders
}

function Get-EnvVar($varName) {
  if (Test-Path $EnvFile) {
    $line = Get-Content $EnvFile | Where-Object { $_ -match "^\s*$varName\s*=" } | Select-Object -First 1
    if ($line) { return ($line -split '=', 2)[1].Trim().Trim('"').Trim("'") }
  }
  return ''
}

# ---------- Java ----------
Write-Step 'Checking Java'
$javaCmd = Get-Command java -ErrorAction SilentlyContinue
if (-not $javaCmd) {
  Fail "Java was not found. Lavalink needs Java 17 or newer. Install it:`n    winget install EclipseAdoptium.Temurin.21.JRE"
}
$javaPath = $javaCmd.Source
$versionLine = (& cmd /c "`"$javaPath`" -version 2>&1" | Select-Object -First 1)
$javaMajor = 0
if ($versionLine -match 'version "(\d+)(\.(\d+))?') {
  $javaMajor = [int]$Matches[1]
  if ($javaMajor -eq 1) { $javaMajor = [int]$Matches[3] }
}
if ($javaMajor -lt 17) {
  Fail "Found Java $javaMajor ($versionLine), but Lavalink needs Java 17 or newer."
}
Write-Ok "Java $javaMajor at $javaPath"

# ---------- pm2 ----------
Write-Step 'Checking pm2'
$pm2 = $null
$localPm2 = Join-Path $RepoRoot 'node_modules\.bin\pm2.cmd'
$globalPm2 = Get-Command pm2 -ErrorAction SilentlyContinue
if (Test-Path $localPm2) { $pm2 = $localPm2 }
elseif ($globalPm2) { $pm2 = $globalPm2.Source }
else { Fail "pm2 was not found. Run 'npm install' in the bot folder (or 'npm install -g pm2') first." }
Write-Ok "pm2 at $pm2"

# ---------- Credentials (.env) ----------
Write-Step 'Checking credentials'
$passwordSource = 'the -Password parameter'
if (-not $Password) {
  $envPass = Get-EnvVar 'LAVALINK_PASSWORD'
  if ($envPass) {
    $Password = $envPass
    $passwordSource = '.env'
  }
}
if (-not $Password) {
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $Password = [Convert]::ToBase64String($bytes) -replace '[+/=]', ''
  if (Test-Path $EnvFile) {
    $content = (Get-Content $EnvFile -Raw)
    if ($null -eq $content) { $content = '' }
    Write-TextFile $EnvFile ($content.TrimEnd() + "`nLAVALINK_PASSWORD=$Password`n")
    Write-Ok 'Generated new password and saved to .env'
  }
} else {
  Write-Ok "Using Lavalink password from $passwordSource"
}

# YouTube Refresh Token
if (-not $YouTubeRefreshToken) {
  $YouTubeRefreshToken = Get-EnvVar 'YOUTUBE_REFRESH_TOKEN'
}
if ($YouTubeRefreshToken) {
  Write-Ok "Found YouTube Refresh Token in .env"
} else {
  Write-Host "    [i] YOUTUBE_REFRESH_TOKEN not found in .env (Add it to bypass bot-checks)" -ForegroundColor Yellow
}

# Spotify Credentials
$spotifyClientId = Get-EnvVar 'SPOTIFY_CLIENT_ID'
$spotifyClientSecret = Get-EnvVar 'SPOTIFY_CLIENT_SECRET'
if ($spotifyClientId) {
  Write-Ok "Found Spotify credentials in .env"
} else {
  Write-Host "    [i] SPOTIFY_CLIENT_ID not found in .env (Add it later to enable Spotify)" -ForegroundColor Yellow
}

# ---------- Download ----------
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$InstallDir = (Resolve-Path $InstallDir).Path
$jarPath = Join-Path $InstallDir 'Lavalink.jar'
$versionFile = Join-Path $InstallDir 'VERSION'

Write-Step 'Looking up latest plugin & Lavalink releases'
$lavalinkRelease = Get-LatestRelease 'lavalink-devs/Lavalink'
$youtubeRelease  = Get-LatestRelease 'lavalink-devs/youtube-source'
$lavasrcRelease  = Get-LatestRelease 'topi314/LavaSrc'

$lavalinkVersion = $lavalinkRelease.tag_name
$youtubeVersion  = $youtubeRelease.tag_name
$lavasrcVersion  = $lavasrcRelease.tag_name -replace '^v', ''
Write-Ok "Lavalink: $lavalinkVersion | YouTube: $youtubeVersion | LavaSrc: $lavasrcVersion"

$installed = if (Test-Path $versionFile) { (Get-Content $versionFile -Raw).Trim() } else { '' }
if ($installed -eq $lavalinkVersion -and (Test-Path $jarPath)) {
  Write-Ok "Lavalink $lavalinkVersion is already up to date"
} else {
  $asset = $lavalinkRelease.assets | Where-Object { $_.name -eq 'Lavalink.jar' } | Select-Object -First 1
  if (-not $asset) { Fail 'Latest release has no Lavalink.jar.' }
  Write-Step "Downloading Lavalink $lavalinkVersion ($([math]::Round($asset.size / 1MB)) MB)"
  $tmp = "$jarPath.download"
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tmp -UseBasicParsing -Headers $GitHubHeaders
  Move-Item -Force $tmp $jarPath
  Write-TextFile $versionFile $lavalinkVersion
  Write-Ok "Saved to $jarPath"
}

# ---------- application.yml ----------
Write-Step 'Configuring application.yml'
$configPath = Join-Path $InstallDir 'application.yml'
$ytPluginDep = "dev.lavalink.youtube:youtube-plugin:$youtubeVersion"
$srcPluginDep = "com.github.topi314.lavasrc:lavasrc-plugin:$lavasrcVersion"

if (Test-Path $configPath) {
  $config = Get-Content $configPath -Raw
  $config = [regex]::Replace($config, 'dev\.lavalink\.youtube:youtube-plugin:[^"\s]+', $ytPluginDep)
  if ($config -match 'com\.github\.topi314\.lavasrc:lavasrc-plugin:') {
    $config = [regex]::Replace($config, 'com\.github\.topi314\.lavasrc:lavasrc-plugin:[^"\s]+', $srcPluginDep)
  }
  $config = ([regex]'(?ms)(^lavalink:.*?^[ \t]+password:[ \t]*)[^\r\n]*').Replace($config, "`${1}`"$Password`"", 1)
  
  if ($YouTubeRefreshToken) {
    $config = ([regex]'(?m)(refreshToken:[ \t]*)[^\r\n]*').Replace($config, "`${1}`"$YouTubeRefreshToken`"", 1)
  }

  if ($spotifyClientId) {
    $config = ([regex]'(?m)(clientId:[ \t]*)[^\r\n]*').Replace($config, "`${1}`"$spotifyClientId`"", 1)
  }
  if ($spotifyClientSecret) {
    $config = ([regex]'(?m)(clientSecret:[ \t]*)[^\r\n]*').Replace($config, "`${1}`"$spotifyClientSecret`"", 1)
  }

  # Ensure WEB and MWEB playback are not disabled when remoteCipher is present
  $config = [regex]::Replace($config, '(?ms)(^\s+WEB:\r?\n\s+playback:\s*)false', '${1}true')
  $config = [regex]::Replace($config, '(?ms)(^\s+MWEB:\r?\n\s+playback:\s*)false', '${1}true')

  Write-TextFile $configPath $config
  Write-Ok 'Updated existing config with versions, password and refresh token'
} else {
  $yaml = @"
server:
  port: $Port
  address: 0.0.0.0
  http2:
    enabled: false

plugins:
  youtube:
    enabled: true
    oauth:
      enabled: true
      fallback: true
      refreshToken: "$YouTubeRefreshToken"
      skipInitialization: false
    allowSearch: true
    allowDirectVideoIds: true
    allowDirectPlaylistIds: true
    remoteCipher:
      url: "https://cipher.kikkia.dev/"
      userAgent: "luko"
    clients:
      - MUSIC
      - WEB
      - MWEB
      - WEBEMBEDDED
      - IOS
      - ANDROID_VR
      - TVHTML5_SIMPLY
      - TV

    clientOptions:
      MUSIC:
        playback: false
        playlistLoading: false
        searching: true
        videoLoading: false
      WEB:
        playback: true
        playlistLoading: true
        searching: true
        videoLoading: true
      MWEB:
        playback: true
        playlistLoading: true
        searching: true
        videoLoading: true
      WEBEMBEDDED:
        playback: true
        playlistLoading: false
        searching: false
        videoLoading: true
      IOS:
        playback: true
        playlistLoading: false
        searching: false
        videoLoading: true
      ANDROID_VR:
        playback: true
        playlistLoading: true
        searching: true
        videoLoading: true
      TVHTML5_SIMPLY:
        playback: true
        playlistLoading: false
        searching: false
        videoLoading: true
      TV:
        playback: true
        playlistLoading: false
        searching: false
        videoLoading: false

  lavasrc:
    providers:
      - "ytmsearch:\"%ISRC%\""
      - "ytmsearch:%QUERY%"
      - "ytsearch:\"%ISRC%\""
      - "ytsearch:%QUERY%"
      - "scsearch:%QUERY%"
    sources:
      spotify: true
      applemusic: true
      deezer: false
      yandexmusic: false
      flowerytts: true
      youtube: false
    spotify:
      clientId: "$spotifyClientId"
      clientSecret: "$spotifyClientSecret"
      countryCode: "DE"
      playlistLoadLimit: 6
      albumLoadLimit: 6
      resolveArtistsInSearch: true
    applemusic:
      countryCode: "DE"
      playlistLoadLimit: 6
      albumLoadLimit: 6
    flowerytts:
      voice: "anna"

lavalink:
  plugins:
    - dependency: "$ytPluginDep"
      snapshot: false
    - dependency: "$srcPluginDep"
      repository: "https://maven.lavalink.dev/releases"
      snapshot: false
  server:
    password: "$Password"
    sources:
      youtube: false
      bandcamp: true
      soundcloud: true
      twitch: true
      vimeo: true
      nico: true
      http: true
      local: false
    filters:
      volume: true
      equalizer: true
      karaoke: true
      timescale: true
      tremolo: true
      vibrato: true
      distortion: true
      rotation: true
      channelMix: true
      lowPass: true
    bufferDurationMs: 400
    frameBufferDurationMs: 5000
    opusEncodingQuality: 10
    resamplingQuality: LOW
    trackStuckThresholdMs: 10000
    timeouts:
      connectTimeoutMs: 10000
      connectionRequestTimeoutMs: 10000
      socketTimeoutMs: 10000
    useSeekGhosting: true
    youtubePlaylistLoadLimit: 6
    playerUpdateInterval: 5
    youtubeSearchEnabled: true
    soundcloudSearchEnabled: true
    gc-warnings: true

metrics:
  prometheus:
    enabled: false
    endpoint: /metrics

logging:
  file:
    path: ./logs/
  level:
    root: INFO
    lavalink: INFO
  logback:
    rollingpolicy:
      max-file-size: 10MB
      max-history: 7
"@
  Write-TextFile $configPath $yaml
  Write-Ok "Created application.yml with full YouTube OAuth, Cipher, SoundCloud and LavaSrc"
}

# ---------- SoundCloud Opus MIME Fix + YouTube VisionOS/yt-dlp Fallback Plugin ----------
$pluginsDir = Join-Path $InstallDir 'plugins'
New-Item -ItemType Directory -Force -Path $pluginsDir | Out-Null
$scFixJarPath = Join-Path $pluginsDir 'soundcloud-opus-plugin-1.0.0.jar'
$scFixBase64 = 'UEsDBAoAAAgAAEoIWV0AAAAAAAAAAAAAAAAJAAQATUVUQS1JTkYv/soAAFBLAwQUAAgICABKCFldAAAAAAAAAAAAAAAAFAAAAE1FVEEtSU5GL01BTklGRVNULk1G803My0xLLS7RDUstKs7Mz7NSMNQz4OVyLkpNLElN0XWqtFIwMtUz0DNW0HBNzsksKE5VcEzJLyjJLM3V5OXi5QIAUEsHCBiFWuFCAAAAQAAAAFBLAwQKAAAIAABqB1ldAAAAAAAAAAAAAAAAEQAAAGxhdmFsaW5rLXBsdWdpbnMvUEsDBBQACAgIAGoHWV0AAAAAAAAAAAAAAAAyAAAAbGF2YWxpbmstcGx1Z2lucy9zb3VuZGNsb3VkLW9wdXMtcGx1Z2luLnByb3BlcnRpZXNFysENwCAIAMA/u0jsAA5DqmmJCKQU5++z9z6lNVpYaj/FshfzjOKSFys4vXeTnIZCm4R14j9hjyfYtB1YscIHUEsHCJz3MnJAAAAASAAAAFBLAwQKAAAIAABhB1ldAAAAAAAAAAAAAAAABQAAAGx1a28vUEsDBAoAAAgAAGEHWV0AAAAAAAAAAAAAAAAOAAAAbHVrby9sYXZhbGluay9QSwMECgAACAAASQhZXQAAAAAAAAAAAAAAABkAAABsdWtvL2xhdmFsaW5rL3NvdW5kY2xvdWQvUEsDBBQACAgIAEkIWV0AAAAAAAAAAAAAAAA7AAAAbHVrby9sYXZhbGluay9zb3VuZGNsb3VkL0ZpeGVkU291bmRDbG91ZEZvcm1hdEhhbmRsZXIuY2xhc3OtVt1TE1cU/13ysSGugkHQULGhBQ0fkpaqtQGtGkSxCaDBj4DVLtlLWLPZG3bvIjy3f0TpY1/sdHyw7YxWO9o+2Zk+9qX/SvtQ7dlNUIToOB1mMvfe/d1zz/mdj3tu/nj26AmAE1iNogkBBUEVIYQZLhZFJeVwvcJN011K6YZTFLaeMrVlrWpqq9xOOcK1i9ybLL1oCldPjfEFzTVl3kMyHjIu7Iomz2uWbnKbITxqWIY8yRBI9l3ZgQiaFURV7IDKcP5/2HtpaMbWiuWaNYYdJS6nbSFFUZgMe5J92VukhVRZpVRe2oZVGvGM71LR4ln2xHNGhc+sVnkUuxFT0KZij7fVuvkgSUuRFbe5ndEcX7pDxV7sI9/4kquZDkN7coO5qflbvChH+mZjFOROFe9gP8PeilbmGWEVNXnVkIu0cqRmSTp7MLmVagP2nt0DKt5FgiFKZ23peIo22V4/P9uM9/C+gh4VvTjIcNR0y8IPrGlY5Y3xHDdWuP7a7KnjU5dyp2duzhSmz+YprnNzjeKaRJ+CfhUDGGTY5Qu40jBTWcOh1EQMyW1NClLXsZ4Xf3uijpOGIaQUfKDiQwwzxLaKMCiLmjPJV6RfSLPeiSMqjuIYQ9Dy4VdzXk9ClMJwXMUnSJMGcqy4yCnkSw1C1gDZruqkdCgYZeh8aeKSa0kqv7MrRV6VhrAioBvSM2boCUvIhM4lkU9o1mrCcatVYUuuJxZ8XU4UIzjl3dfTr0m9f8kyKsa8YlapzrNClN3qZduMgWHcq8dzDMffKgQN6jBGLaNTwQWGtga1EEGWErRoOhFMMjRrrm6IlCiVIphmaJpKR3CJyrcGV6qc8BnCLxN+ha5Z1RYlmzuOscwjuEYbOUpbMCN0ztCSNSw+6VbmuT2jzZuE7MxLCnFOq9a/W4uLQjj8DHfkele4nsy+Wo3k0bZlVfEuVnPeKFmadG0i8N1ma6PbZ+zkdjKnypl3DbN+2Sd0TsW4YHj3/UZyG6t+a3lQMxgtmvUHIZr3FY0bXvK639SHhjxFlOAzQkhH2lo1x+Wi0KnIqP81Maq6W97MIqDeH7iWZi1hWFEIVBUseQVPnvW8JGNYy6LM65xqPXlcK1KXWWX4euO9qAvWrNW4OD2169SoX7zmoPfGNBCfa/BkbFWR0UwzTw2UQqdOWBa9QabmONxR4DL0vhVVBbcZDrxZlN6ymjC6qWM20cNF7cp7OmgVojX9PaCxQF9dNDMP7X8A9oMvOEtj2Afpafd6bV10jRSFaJ4bfIr2wYdQGJ5CpcVOht8RCtytYffROlkDaZUOHu6/j/Y1HIoHB2jxDTpp8Qhx0G7XN1B9uGsNSvAOgoG7pL7JJ9Dhm2qhuRX7ECMv2nCYXvQ5QlsR6mD/YlTBbvoFTnkeXMfndNKj+T0C1DGB2R/RnRt8cjJwLNge7PoWmcH24HA6NPAQhxjS4Xj4IQ4zcqrXW33E8BsiaSUeCgzHQ8HhuPIzPl5DOK7cu/P8r6+C7M7zx79gpBA78QCf/vqC5QEKEciZDoruESrMMezHOUIvEDaNhM+2E6FniCq4wYhzm4IJBUPJf9D0N3l409f0BfHXMF8P85fEP0zzuU38h2r81xkO+ATb4qHQMLl0huERzgL3fKp/riPnCdkU0l6aD9J4iF7bXnp8+n2SuxBYJ9nvEYug+KJE5n0ngQvhx5goBGjcXQjEPssXgrFcvhCKTeVpuRG96KF5QkN19PIL9Go+/xO6N9dZhFzWfZ4cCzTvoe8K7ZT80fDHMhzaidJKYhkriP8HUEsHCEfkoYk7BQAA9woAAFBLAwQUAAgICABJCFldAAAAAAAAAAAAAAAAMwAAAGx1a28vbGF2YWxpbmsvc291bmRjbG91ZC9Tb3VuZENsb3VkT3B1c1BsdWdpbi5jbGFzc7VX+X8TxxX/jix5hb2AEQ4gMCBSQ+RDVkIDBAkTTjemsnFsYtemabuWxvLi1a7YXflIeqWlV9L7SqBt2tLDTc8YWmFDk0LTM03v+25/7X/QlJa+2ZXwteZDw6fw8c5q3ps3b77v+968ff4/F58F0Iq/V8GHCgl+GQFUMtScUEaVuKbo2fjRwRM8bTNU7lF11d7LUBFt6K1CEMskVMmohswQ0wojBqmPKpqqj8Qto6Bn0ppRyMR7xOtB8Xo0X7C6tEJW1RlW5hU7PTwrY7g3mkobubjFMzmuaYWT8YxqpQ0z4xjNa8oEN+OlYX8hoxpdznuHoitZbiYbeiWsmOf1sWGTK5kQHa5GxiqEyG2zQDs/Ek39T74mb8mt1KxD3QVdVwY1ngyilgAQTsQm7JgDBDersBxrBPZrGRqiXsvmzPXYpqpnkyIKyxGWsR4bGJZZ3D6k8JxBh/RHB1zhRhmbRDgDlq2YdjUi2CLhdhkvQz1D4qWfjGFVltuEl5nmpSmLIRQtHbhgq1o8pVp2shrbcIeEqIwGNDKsmC9mCKo2NxXbIItr5q1uL82ThWbEJLTIiONO2mOxCoM0rFidfNx2uDkgVmyX8XLcTUjoznRtdG4oXEYnJey8GRAs55QuCPNOLOEehqM3u96TZ4uNBpFgWD5kmDnFvk/RM5rgxh60Stgr417sI+rMHuSgpliEew3F4hBPa4rJM20q1yidYlEPvsyZMvmQRhjEHfVkFQ7goIRDMg4LKq1dQo8cI5LtT6e5ZanESbHsFTLuQzsBTz4wbIsuhtkT+Vcy7FgyD9vUcZ6ZBaltPhhHUCE27pRxFF20sSU2vsNjYw9XepdR3eqW0YNjtFIzskSolGFm45Y2dPeJeMrIirQNopehvcvJzEzkRtGKjKn2cERUi0hHe8fhWJ7wUscjbvgiw67L1XgV+iUMyDiOV1O0Fu5HLFX1IYPhNq+gUWV7DcPqWcHh8TTP26qhB/E6huY2RdXIS9uIOKXkhu4KTwZlpEGhDHDTFLnT6LFpal4dNcacAtTQG4D7LyNKy7AMFSdEadE4z4uac6ShNwiNoSXDR1vKcW2ZMAp2YZC39Lujl1M7oMswQEaCxKISqVfPS1lnMikywZRhgSIukWqnkuMLk7t0hCqMYkzCuIwJPDTvZnAV6D7jJwuKZi2AvcyUAbHX62W8AW8kX2ivLtOwSUK4HzJyirjEbi/va/F0wVTtifhCHfLizXhEwltkvBWnGDbdWJ3yS5zfyHAXIIa6RVvMSsn42/EOCe+U8S48yrBuKUWGajKbMtKK2IqwKBvVuR1/oDtF6fjuctKXphy4U4aSEVXuvQzyXKETMAHPB2R8EB+iql6OmruCIbw4dq6IfH4MHxH33EfFPXd8vh9LrBG0eoJSXNSLWV7N1osytbrKV+kenJHxMXycSEKZ6JKk1YPmA0ttuIh4QTxJTHcSTJj/lIxP4yzduXTwDm4PG5RP+zw2OL7IkFcNdi0QNJ/F5yR8XsYkvlAOp4ciMVfVR40ROtRuD+Yev8kK/MV5ReV6mofA8GUZX8FXiRI5ZYQfNHQiTh/VOXqjNkK3nZRp98i5IJ5mSB5Tc1SPKCSRMUW1aV6Uw8iS6S8ql8mz1A249emcjPOiTPrHFJNY9g0UJVyQMY0Zcmhh6WxT0tQATLiRKFfTrVEP2BcVeQmXGO6hUhVXTMKExNevIiWvevQ8dPwhNVswS1nkFwlGt3FK1XlnITfIzWMCP3IlXVKk94durau9lcVUTHpsJT3SoeRLjoU0JTeYUeqv+1dP/VRwT1or9fVVblzaVKEc9mqGWwSuJKOm1KYo96pOG7Bf1w3bQYWYEXWRzgtCDJmUemOGSZc7BZcb9kSex3u4OapS9aI6dMAwbMs2lbxLbKsGlSsDeF58W/xIxhXIQfyYYefCG25pKhl6RLFtnsvbEbayEj+tws/wcwm/kPFL/IoK9iwt3AyKpxxEaHtlqMyk6tzcXy/M5VJpkeut249Y9SnDGCnkPdrzpRYeIxRemtDd8sZrGxZLDyqa1kN9dpIg+U0VfovfSfi9SPE/MNQv0na9d7P+eno98f+HwaNkepSvhUeiq6ld1yk5RZpzS8KfKf9vylUJfy1fyEuqUql1lbGFOOmj0niR/taL9pHaoAC908cyPb9JvzbSyMRs4wWwKXpheIaelc7kKno+i2+VVNvhRwWNWxqbipAuYXl/Y9NFrARCqy/gto5mfxHrmouoa3r6upk1CJSea+l5JzbgLmzGdvKJvr9LZv9BZiUaJ5pmsJlhBlsZOppn0MRwGkP0chfDZezojF3BrtPojl3GroQ/tCu0u4hkIhAO0Lb7w4EwDW2JynDlFRw5gw1i4hKO9F9AqoiOc7g/9MAM+nx0R61KBMTP14YDM1AqMHnt8SlypBkZZPEgOSbc3kmNonhuxi6S7KbGIYEk/T9El2gKrRjAXtI/QCv2UTe5HwWSjNNHyGVatQGBq5AlNP8bfRJ2SNh1QMKD/8TyF+Gr8Yny4J6b9RHIy2jBcxWtdTXbz+J8Lfg0sg64c6DojJWgmIiVoaDjj4T9M8gxFHGyiMJp9IeCRTxcxJuKeFsicAmP9fufwXv6K8KBHqH5PqH5/gv4cKIy9Lg/XDmN0wkpLIU+QVp7+itCvp4iPpkIhoOMJny0zE8Tn+mbmrx2ahK1nQRY3UV8CYg5mE2d8rHJaw6qX5vBlA9ThFsQZ6i7eIoamCed0UWyG7X0XEfS9VhB2KxGHX3hbiSsNpFsMxSiqE7f9eOox6PYSja2kYUo2WgmKw04i0ay3oRzZGMaLfg2fU4LlNdDugofu4o6QvpfeJjAJZifqnmRqBYkrTK9tzg8BpaFgtP4+nncv5DiIWLfczT68B18tzT7PRq/78h8+AlR/gf4If39miQv4I80X0Vvf8Jf8DeE/wtQSwcIRT2q25UIAACKEgAAUEsDBBQACAgIAEkIWV0AAAAAAAAAAAAAAAAtAAAAbHVrby9sYXZhbGluay9zb3VuZGNsb3VkL1Zpc2lvbk9zQ2xpZW50LmNsYXNzlVV7UxNXFP9dgmSJy8NVsOKDbaU1iZBlUYQW1AIWiASCBoPSB93s3iTXLLtxd0OHfoJ+mP7R1pno1Jl+gH6oTs9NMkGx0wGYOefuPed33vfk73/+/AvAfVQT6EEsjl4V59DHcMtt1HzDtQ4tV3g1I/QbnmO7fsMxiiIUvpcPV1zBvYhhwA64FfF8PaLrkCGTTOUcfniMPfIbUaPEDbsFCI02sKO/kICC/jgSKs5DZZj6X2jWD3dFVN2pNg5KniVchr5F4YnoAYORPIvXVDGOQYb06SEJDGBYBnmBIZZMFeX3RRWXMMJwPuTRtmsdlSy7xtCb3GuLL6v4RIqHSFwUDvdzvuUIryJlYyquSpnWgboijN4TX1dxQ4pVEhe4FdhVEvRTi3QVn+IzqnoxW8jmt/ZX8lur2TWG26fJfsX3yqJCJZ/A53F8oeIWkgypUyMpN9uvH1GXTtfjjj8FaQalHXC+IL0PK5hiaGz6PwvXtYzZzLSe3LRs4UV+WF3Qs17EXZ0u9HxBf66b0/vm7P5cSl+q112+y0sbIjLuTc9mzIw5qyc31nc2c5O6K2pcX+N2zU/pRR7IITXMebJcsMpWILoA6d9QMQ2TqvgTTdOzkAdLldYsP0zmXlJKlJdXMQpRQEVfOEum0vYdFXel7UFpuy3dsg64gnvyrbS+O+EpmKdZms6YEvaVigUs0rAcw1YFdx2GJ/8R1Hs3+dJLbkdnClMBPZgE6Qubb1o1iu1rhnOt6ipYpnnuiHyHuwoeMVx4yslsdPSodW/enTQVrNLj88N2auvU38P2XigoeMzQ74fdJHPky8zcycyY+bk5Am4x9FTJ7jZxTvKnDMOub9e4Q53i0ZF0m8AOnsVRVLGL5+T/ON1l33e55THEKdMGz5cZRunB5T7SaDVjT8W3sqrdRndq2rtCTqjYOeHxLVomPNixSi7dXKzwaNkK+YdjX07mbP/ACLlzwF238cpwRGj7gdOqd52eLw+MiNyGhvCN9SiqywkOypbNz9QXCqjSXgc82LYC64DW6aVk6uP2U0KkmHUIKsqCBxR3wF81RMDb4IIdiHrUWlR71JpF8tbekomC3whsvipauX64yjPSDW2XHtrIAMMVuWnoFKczrT2i39HXBMkZcSX9FuwN4r+3dL8nKn9BgBHSH6Uz/Yp0EI87iBvvMPDiDYY20r1NaJKMpmNNXJHkWvq3rp0xQoK8K3QaoC2p4Rou4zrRG+jFD9jv2B0nLj3G/8B4EzePDfS13N0k+iOsjvIYcXnbw07qJYmWunpXO3oxLXVScYqoDeekwdivJ/RmKHLerdcviEH+rb/DBGV/W5tsIqOlmpjRZrW5Jr7U7msPJVvSViT7RluTLKttSLap5SV7EnuLQhMvXmP8uN4Z6grQT/8JDNJ5BCrVaIASH0QaQzAxjHmK4wFVcI20aIxlvKj8C1BLBwiF01i3OQQAAPUHAABQSwMEFAAICAgASQhZXQAAAAAAAAAAAAAAAC0AAABsdWtvL2xhdmFsaW5rL3NvdW5kY2xvdWQvWW91dHViZVBhdGNoZXIuY2xhc3OdVst3E1UY/928bpJOaUkpEBBIoUBCW6KABRpA0yaVaPqQ1GCLWifJTTrNdCZkJoWKgA98e9y58Rw3bFz7OIXCkcPKhce1f4sr8ZskJWmb9oCbO3e+/L7X73tk/vz3wSMA5/GtFzbYORwSnHAxdM7Li3JYlbVCeCIzL7Img+ucoinmBQZ7MJTmcDMcz4lFwizKqqIVw0t6xaxkRHi69oxWcoqe0ivlrBiTNbkgym54GXhWVYRmGl5IaOfYJqEDnQwdDX8jqmwYFEFBmDGRVeWyyI0qQs0xDASTDVjKLCtaIRJqEpVFXqVQw1V4xAsfujh2SOjGToZdm+AY2g1hRrNZYRhKRhUMjuBMKG1p75bgxx5KmEJhONLsvUbKGu91EccLDOEryZbc1JMPG0WhClPXKFlLQEr7Gbqqtiqmooaj5bK8lFQM04t9Vll6GI6qlaLesGjoFS2XVfVKLpxWDEXXJoyaLS8CsLehF4c5jkg4iiDDtoZlyyhlJOco8e5WGc24cYxiuRwfno2PDcdjsXhsdjIZnY5fakM/BjiOSwjjRYb+58mQWCYSEzm6KnlFlBl2BEMbq+nFCZzkOCXhZSvuzvUA6kJxtSKrBsdpimBTSqbNmFoalVU1I2eLq7wM1ngZkhDBOepEU6/SzBAMXmlBRAuZ1RQXJLyCV4lCw2qKoy0obGEr7cEwRjhiEuIY3aqY9emZlM3snEWTXdUpa19SLxfChpo/NR9O6gUapogbFxlm4tqcrGVFLrDp1AWuKeZcIJ1IJSbGJ1IBWSPsVCw5GcjX6QnUSxYImropq+dv3AwNBW7c9OJ1vMGRlDCGcYbtjaQSmikKVmycwq+IiTzDzmCiuZp1BPE1iTc5LklIYWq1nI0Gpyl3GWZZyAu0S1rWINnQqAGtPqBHxEdbKy3hMt5mcMqlkkplPBBsxucrWtakuQiP1i+RNszgCsc7Et7Fe6sLYaNt4nxBLjGcCW5pbfPYLD/vS5CRofxMvTZxvjXBWTLC5SA48hIKmCN21peYNpGi5XWGsy323rO1nRfzKHKoEhagUcrrXYzKWVMvE3cems5Vr4eb3VW3MSW7of8ouhE9R+uyI6loYryykBHlKbm6QJ0lq3s32S9pWgUpk/puTC7V8d749awoWazSXC+uLsKq1tNfGNznqFFr/0DeWoePKpZ219qROW4pE5vDum5SXeTSmDDn9JzRiT0dHvR14hbDcPD51nOLTdXhwkdefIxPOD6VcAefMRxsgBRtUS+KcFJeyORkCkDOrxLdttD89lczQ3WlWrwXaVBVYfQmdb1YKUW2bIA1ilNLJfH/fqy53Fo3tPHXEdojKcUU1BFSQtNEudoygkr5JfXSM6XH8TXD/q2hNEs1MHpol9po/hn2WNuUbna602cLnTq97aMno6fz2D2wn6vAEp2uqrAdHlxFmQwQlEVJzUPSB8cegyd93OdZRttYv2MZ2/v7lrHrMfaOP8S+6Xs4MOTwOx4iQNeDKzhkw+WBPxAZGHL6nY8GXfZB3s27XXcR8ju7+Ykhty/kd6+gj2EZL/2Adr/DerW07nD205O/LVODZOpMTeh32H9H/wrO2kAeh5z9fX7nMs7/gqjvNbJ/Hwm/8z4mHuAtYAXTNjpmGR1ZB6z8bNX8xtFF53bKyEdZdtG5A3vp26cXO3ESu3Aau2kd+zFLtCl017Eft3AA39EHw/dE6o84iLs4hN/ovkJaBlnrgf0Jse3msHFwDh/HXo5eOhmReeQfcmYSzEHUVuDGtac16KmSDXh8w/eh/Iro+jpso6Jdr8a+hA/oKZH0Nslu4EPcxOck8ZLkC3yFb+D/D1BLBwjBeDDQXQUAAKcKAABQSwMEFAAICAgASghZXQAAAAAAAAAAAAAAADIAAABsdWtvL2xhdmFsaW5rL3NvdW5kY2xvdWQvWXREbHBGYWxsYmFja0NsaWVudC5jbGFzc51XCXhU1RX+T7b3MnkhyZCFAYRhNQkkg4ihTEAlAUpCMMiEZQDBl5mX5CUv7w3vvUmISLVVW23VtnYTu1jtQhdsEdtJBJW2trTaxdZqF7vZzc+vtbafXax7z30zCQkMGAv57rx77znnnnuW/5z76OvHHgKwitb6kINcCXkK8lFAWGwk+6yQoQ6ohm72hRwracZjhpWMh6LuGiOxTjWMTjXW12zomukSimO2prpae8LVLdMh1FfXtMW1gVMChqykm+zUQjGPwQmlGTP0jT7IKJTgU1AEhVB3TtYWy9mmuz0dPcn+TlPVDULBSt3U3YsJoeq3cmrNVglTCLWTZ/GhGKVCyTJCbnXNVjGfqqAcFYQiR3M3GeqQMAshr3pHertKwTSxXcLbW/W4ZrVZalw3u8XedAUzxJ4/w2rojjtu+zwFs8S2wtsRTbVjPbwhIcgrvaxuSLdC63RDkzGXMLc5vGuTbXXban9QLDq7oh11a9o27Rpy6+JGol7bp/kwG/OF8gsIFdVtnghDNbtDEddmwY1C39k4X0E1atimuiPkePfcITYWKViMOr5It+au7nQsI+lqm1S3h1DOzj5DmowQC0mfLuMCQn60g/URYXahgmWepC7djHvh1KSbqj3k50hsULAcbyNU9at9WrNlxlRXOJu/HFdlfxAWZlP9zCUJYcK0U8tsnJjmOE1J3YhrtoSVhNLTmWRwDOXU7ZVxKYd0XZ1p1SUybpHRNLo0qNomEzsy1gjqLhnrCEs6NVYwGdetndo+d9Wg1tl/RWjiWv8yddySjPWCu9WHFWgVXtlAqKzemd0tK7BRwWVoJ0y1tbhuazF3rW1bNpNoaj/hPI62trPdtVHwX65gMyLsBT7edkUAZGFgo21hYaPB1TTkaqttWx1qT7qJpJs+zIcOlPqwHVEJOxTsxC5C2RmSCFM4TFrMMTb26OiJLHncBmu3G3skXKlARSdfMAsNpxP/xFn76p1NNS1ChbgCDV28MmjrLkepxDstLcJWu9GjQBcZms+A5WgS+kalehp29NjWoNppcD70ol+BCYs9q8bjkWQiYbPuGh80bXyQjXGwL/KR/ldSCAeuhKSCAQyOGi3p6kYoxlGbtG1GjVCH3q9tYWhi/SJrm9svW8MemN12TtJGYdshBVdhP3MNqrq7zrIJ86pb34RPZOl2HFDwDuHnkjgHmm0NMXNM7zSGJFw73rbta/fFNA/T/CA0+HAN5ku4njDr1LVbTFez7WTC1eJj1D68G++RcKOCm/DeCRnERvJcVJxRbHQ+ERzSq41CzM0KbhFeKtRHz5HxfsbCNGQE9VOnC+0+KFLkNgbrLNl/FlcJc3xYwUfwUT5E26e7W1UjmQa0Fj/D0O0Cag6KVGjJgh+F+Dg+IeGTCj6FOwlzPAKTbRfrUW0GZKZTzbhqx5vTcw75/C0d6/Ywdk1vO4M4Q8QXvwt3S/iMgs8KBJx2NkKOeFPt10Skf17BIYGIsmulVfOhEV9U8CUhII9XOCUP4x4JX1HwVRwhLI1Z/SGO4n7NMJJ7Q3HdiVl23KtwAs00O+RaluGEWh3LbGJzORrHV35CnEtYnxVd37pExv+jbOqkbQjtvqbg60K1XAYFMR9WMJJWn4FR3OeYguOi6ki6s7Y/4XIpyEWDjIeYxaM4jG8o+KZgkR21S+vgRRkPc4FRY1Zci8n4DlMywApZ31XwPTzCwantTaqG09JtWrbWrIrbZS17O2R8n1XpT6TZf6jgR3iMD+Ikc1VddDMzxrMJD0VYtGbGNI/5JxxeHqSHWISMn3IMe0o5q+YKmfXLltQvnevDk/iZhJ8r+AV+yeXasrtDakKN9WihHtdNhDhjdHcoxHXOFckzlGBtC9JNFaH13EE/5qY3F8pu+RXBl1ZXFCkZvxE5m9HXSiSduTJ+xzfqsux+1d2jx4Xxf6/gD/ijMLfTZpndor1prWmV8We2utppj4LitZmP3Gdl/JUt2CUaEf0q7lD+5lX79GyPyjhr7ZPxd64SniZ7OPpNUzOcUUE5Ev7JTWTWxsy1ucEKpdULpevDOm/iwwv4t4CJ/xCS1ZMxRktra+tkLDuZlR3c7xUyqvxXwUt4me1iWGwnv6eGY3Qt6w21Wd3dXmK8SlizWeMOakCLB6NWsoOvFXS8mwT5XsH9B4IDuhrMAGFXptUOVuuu2r1q/4HFQdFN7D9QI+H1CRDc3tnLjYGPQCRRjkK5lDehNgtA7xbJLg0IJGzvEh3HBOzLUDQWUQFJEskKFRLLKz39EhwAutnFdbM6S2SO72HSKolOm5RJObRDTNL+dHw0hUokKlWojPycvKfqX7NlGCw3/dYodvhUQ3Mts40bNcL86iwKjCuegqrRR0VUzsFC3F8vqD59N2sXRlU0TaKAQtNpBrczp9tknRpzLXuIU4dBbtRMCyYgh6Fyj1VzZkiwOZs5AzlH2nRTu4zfNZrdIaoYX47LTKxvo5oYnYu2Ki5iuUsXB3A/uDfJDeEmD4cjMVtPsAlKY6q5nsuToW0WSCWsUmTwwyJjWMI9Z3koRdO/q0VWRqykHdM2qqYqdJxsDWBcWc/p5jUPXSpDZDagemtx0CjRgrMFz1kVluh8wvL/U2mJuBbl7OSW3zfW+jgSLeY+LKsWzQxfltukicebaB/llfx8TD9JfWmt0m+paVkez/XCPuyyJstyGQTUxEbN7bHijkxLue0Q0OWEQ6HBwcH6zGn14lKDqhvruWRgFcm0jDAzgxUuN4PxIJN5ODIgnptBpmggBDIUog9ikkF+UwUF6ottbi7mZbZtzU3aJhOY1igicQn3pFFJAYV91EgrJVrFrRPx5eaf8q1uDlh9WsbF6YfbWEbcPj4LMoTpW6aD1JnfZll9ycS5gXYCo4ffk8OeM0U0swMibAdOPKWFC4/tZabGHl7NKTspVSVqntAsZyPlepkmxhwuDDLXNe4NRXXgL5m/i1DGUD2TZ/N5n8Rq7QhoGNK9gpbO41G8l8FcEmbwdz4KMhytGY5Zx1EcHUbJhtq8FPy1uSlUiiEghpm1R8bkTGdOpuZzZ6MYQfhZpyrMxUzMY7n8HM/I3cCNl5AbOI7ZUf+cYczbUJvCwoOsWgq1R/z1QmSOJ9KPPB7PZ/ZqvkgNKrGIZqWv9ioqJT6IaPaY4BksVgjO9S85pVWBt7SEZ0EWkCacniHMyT18Gt1FPJuDR8bR5WSlC/NsLs1jNZkuN4FSTGOywAiWhvPqjrEYhPOPY0W0VH4QjdHcQF4kmudfFYnm+y+JRAv8qyNRyd8cicr+tZFoaYH/7TxKgfzIMFrCBYECNmzbtkBBCpvC0nF0sPG3huWAlMK2cGFZEA/IYV+gMOBL4YpoQ1HOnSgNyAFfbkVRCrFDbzwbKDyJhYHCFLoPYZagPInyzFQJFwV8AaYzAr4TAakciaOwU9h3B6qE+Ku3Hcc1Udb/ncAw3nXiEKrChSO4IYX3iQ3/rYHCYXzghCD90EFUiDXv+xg+lmYIyEdxRwqfTuFzKXwhXBhg7i+zCj7/vSncl0KKzy86iSKhwv0HUZY57oEMt8//oEd2Iqzw97cy38X+bweUFE7egeJAsf/RFH5wEOX+H/sfH8ET4SlluLmh5BDK/E/5f51ZeKWhhNl/y+wVJaz70zc2lPL8TzwvxzM8L8ez+vIyXvoLL/HPc/zD9nma/5ZP5fnzHuU/xJTv+EI0MKWitLKscmplRaCIiPJyh/GvcNVRvOh/peBBvBbNrWPvVpSO4A12cECJ3E/5uThORdFA1QgV0zBNPcIhH8MNuA29OMivvbv49x48hsdxXSbS7+YIB5o5/dZw8qzl/+1owyZEcDl2YTNzR5hnC/ZhK8vZzpI2s4Qd/KTZyY+WXSxLZWm78QT24ClciWeY43lwnUA3laKHqqBzuPbSEvTRxTCpFRZthU29cMiBS/sxQNdjkG7CVXQQ++kwrqaHcYAexzX0HG7JKcKtXubdgJI3WJEiiRtomi/RQgmNo38rJGyX0CFht0R8m5f5lSqh9w1MeVNylkg8yC8hZ06ThOumBl5HyCM6zGPxa1iUZip9DcUSniSq9TIxhxbxu12mujGUm+NlJ1Dozxmhyvvw4r2nJW4Vcqnew5cQ20KkeB6tYIoLvPFCb7zIG5fTJR44El1KTbQGgf8BUEsHCKA9MnEmDAAAyRYAAFBLAQIKAAoAAAgAAEoIWV0AAAAAAAAAAAAAAAAJAAQAAAAAAAAAAAAAAAAAAABNRVRBLUlORi/+ygAAUEsBAhQAFAAICAgASghZXRiFWuFCAAAAQAAAABQAAAAAAAAAAAAAAAAAKwAAAE1FVEEtSU5GL01BTklGRVNULk1GUEsBAgoACgAACAAAagdZXQAAAAAAAAAAAAAAABEAAAAAAAAAAAAAAAAArwAAAGxhdmFsaW5rLXBsdWdpbnMvUEsBAhQAFAAICAgAagdZXZz3MnJAAAAASAAAADIAAAAAAAAAAAAAAAAA3gAAAGxhdmFsaW5rLXBsdWdpbnMvc291bmRjbG91ZC1vcHVzLXBsdWdpbi5wcm9wZXJ0aWVzUEsBAgoACgAACAAAYQdZXQAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAAAfgEAAGx1a28vUEsBAgoACgAACAAAYQdZXQAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAoQEAAGx1a28vbGF2YWxpbmsvUEsBAgoACgAACAAASQhZXQAAAAAAAAAAAAAAABkAAAAAAAAAAAAAAAAAzQEAAGx1a28vbGF2YWxpbmsvc291bmRjbG91ZC9QSwECFAAUAAgICABJCFldR+ShiTsFAAD3CgAAOwAAAAAAAAAAAAAAAAAEAgAAbHVrby9sYXZhbGluay9zb3VuZGNsb3VkL0ZpeGVkU291bmRDbG91ZEZvcm1hdEhhbmRsZXIuY2xhc3NQSwECFAAUAAgICABJCFldRT2q25UIAACKEgAAMwAAAAAAAAAAAAAAAACoBwAAbHVrby9sYXZhbGluay9zb3VuZGNsb3VkL1NvdW5kQ2xvdWRPcHVzUGx1Z2luLmNsYXNzUEsBAhQAFAAICAgASQhZXYXTWLc5BAAA9QcAAC0AAAAAAAAAAAAAAAAAnhAAAGx1a28vbGF2YWxpbmsvc291bmRjbG91ZC9WaXNpb25Pc0NsaWVudC5jbGFzc1BLAQIUABQACAgIAEkIWV3BeDDQXQUAAKcKAAAtAAAAAAAAAAAAAAAAADIVAABsdWtvL2xhdmFsaW5rL3NvdW5kY2xvdWQvWW91dHViZVBhdGNoZXIuY2xhc3NQSwECFAAUAAgICABKCFldoD0ycSYMAADJFgAAMgAAAAAAAAAAAAAAAADqGgAAbHVrby9sYXZhbGluay9zb3VuZGNsb3VkL1l0RGxwRmFsbGJhY2tDbGllbnQuY2xhc3NQSwUGAAAAAAwADACyAwAAcCcAAAAA'
[IO.File]::WriteAllBytes($scFixJarPath, [Convert]::FromBase64String($scFixBase64))
Write-Ok 'Installed SoundCloud Opus + YouTube VisionOS/yt-dlp fallback plugin'

# ---------- pm2 ----------
Write-Step "Starting Lavalink with pm2 as '$Name'"
$ecosystemPath = Join-Path $InstallDir 'ecosystem.config.js'
$ecosystem = @"
module.exports = {
  apps: [{
    name: '$Name',
    cwd: __dirname,
    script: $(ConvertTo-Json $javaPath),
    args: ['-Xmx${MemoryMB}M', '-jar', 'Lavalink.jar'],
    interpreter: 'none',
    autorestart: true,
    restart_delay: 5000,
    max_restarts: 10
  }]
};
"@
Write-TextFile $ecosystemPath $ecosystem

& $pm2 startOrReload $ecosystemPath --update-env | Out-Host
if ($LASTEXITCODE -ne 0) { Fail 'pm2 could not start Lavalink.' }
& $pm2 save | Out-Null

# ---------- Wait until ready ----------
Write-Step 'Waiting for Lavalink to start (downloading plugins on first launch)...'
$configuredPort = $Port
$portMatch = Select-String -Path $configPath -Pattern '^\s*port:\s*(\d+)' | Select-Object -First 1
if ($portMatch) { $configuredPort = [int]$portMatch.Matches[0].Groups[1].Value }

$ready = $false
for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
  Start-Sleep -Seconds 2
  try {
    $version = Invoke-RestMethod -Uri "http://127.0.0.1:$configuredPort/version" -Headers @{ Authorization = $Password } -TimeoutSec 3
    $ready = $true
    Write-Ok "Lavalink $version is running on port $configuredPort"
  } catch { }
}

if (-not $ready) {
  Write-Host "`n[!] Lavalink did not answer within 2 minutes. Check the logs with: pm2 logs $Name" -ForegroundColor Yellow
  exit 1
}

Write-Host @"

Done!
  * Lavalink is online on port $configuredPort.
  * YouTube OAuth, Cipher, SoundCloud and LavaSrc (Spotify) are configured.
  * Check PM2 output: pm2 logs $Name
"@ -ForegroundColor Green