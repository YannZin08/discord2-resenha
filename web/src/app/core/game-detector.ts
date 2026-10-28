// The Windows game detector: a .cmd file that runs a PowerShell loop on the person's PC and
// tells the server what they're playing ("Jogando X"), like Discord's game detection.
// Steam games are found through Steam's own registry key; others through the process list.
// The script text stays ASCII-only: Windows PowerShell reads the file in the local code page.

/** Games outside Steam: process name (without .exe) → the name people see. */
const KNOWN_GAMES: Record<string, string> = {
  'VALORANT-Win64-Shipping': 'VALORANT',
  'League of Legends': 'League of Legends',
  'FortniteClient-Win64-Shipping': 'Fortnite',
  'Minecraft.Windows': 'Minecraft',
  javaw: 'Minecraft',
  RobloxPlayerBeta: 'Roblox',
  GTA5: 'Grand Theft Auto V',
  GTA5_Enhanced: 'Grand Theft Auto V',
  GenshinImpact: 'Genshin Impact',
  ZenlessZoneZero: 'Zenless Zone Zero',
  StarRail: 'Honkai: Star Rail',
  Overwatch: 'Overwatch 2',
  RocketLeague: 'Rocket League',
  r5apex: 'Apex Legends',
  r5apex_dx12: 'Apex Legends',
  cod: 'Call of Duty',
  Wow: 'World of Warcraft',
  'Diablo IV': 'Diablo IV',
  'FC25': 'EA SPORTS FC 25',
  'FC26': 'EA SPORTS FC 26',
  'CrimsonDesert': 'Crimson Desert',
  'RainbowSix': 'Rainbow Six Siege',
  'TslGame': 'PUBG: BATTLEGROUNDS',
  'EscapeFromTarkov': 'Escape from Tarkov',
  'Brawlhalla': 'Brawlhalla',
  'osu!': 'osu!',
};

/** The detector for this person, with their key inside, as Windows line endings. */
export function detectorScript(apiUrl: string, token: string): string {
  const games = Object.entries(KNOWN_GAMES)
    .map(([proc, name]) => `  '${proc.replace(/'/g, "''")}' = '${name.replace(/'/g, "''")}'`)
    .join('\n');
  const ps = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$Api = '${apiUrl}'
$Token = '${token}'
# Games outside Steam: process name = name shown in Resenha. Add your own here.
$Games = @{
${games}
}

function Get-SteamGame {
  $id = (Get-ItemProperty 'HKCU:\Software\Valve\Steam').RunningAppID
  if (-not $id -or $id -eq 0) { return $null }
  $name = (Get-ItemProperty "HKCU:\Software\Valve\Steam\Apps\$id").Name
  if ($name) { return $name }
  $steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam').SteamPath
  if (-not $steam) { return $null }
  $libs = @("$steam\steamapps")
  $vdf = Get-Content -LiteralPath "$steam\steamapps\libraryfolders.vdf" -Raw -Encoding UTF8
  foreach ($m in [regex]::Matches($vdf, '"path"\s+"([^"]+)"')) { $libs += ($m.Groups[1].Value -replace '\\\\', '\') + '\steamapps' }
  foreach ($lib in $libs) {
    $acf = Get-Content -LiteralPath "$lib\appmanifest_$id.acf" -Raw -Encoding UTF8
    if ($acf -match '"name"\s+"([^"]+)"') { return $Matches[1] }
  }
  return $null
}

function Get-Game {
  $steam = Get-SteamGame
  if ($steam) { return $steam }
  foreach ($p in (Get-Process | Select-Object -ExpandProperty ProcessName -Unique)) {
    if ($Games.ContainsKey($p)) { return $Games[$p] }
  }
  return $null
}

function Send-Game($game) {
  $body = @{ name = $game; auto = $true } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Put -Uri $Api -Headers @{ Authorization = "Activity $Token" } -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ErrorAction Stop | Out-Null
}

Write-Host 'Detector de jogos do Resenha ligado.'
Write-Host 'Deixe esta janela aberta (pode minimizar). Feche para parar.'
$last = $null
$sent = [datetime]::MinValue
while ($true) {
  $game = Get-Game
  if ($game -ne $last -or ($game -and ((Get-Date) - $sent).TotalSeconds -ge 60)) {
    try {
      Send-Game $game
      if ($game -ne $last) { if ($game) { Write-Host "Jogando: $game" } else { Write-Host 'Nenhum jogo aberto.' } }
      $last = $game
      $sent = Get-Date
    } catch {
      Write-Host ('Nao deu para avisar o Resenha: ' + $_.Exception.Message)
    }
  }
  Start-Sleep -Seconds 15
}
`;
  // The batch part hands everything after the second marker to PowerShell, so the file
  // runs with a double-click even where .ps1 scripts are blocked.
  const cmd = `@echo off\ntitle Resenha - detector de jogos\npowershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((Get-Content -LiteralPath '%~f0' -Raw) -split '#PS#')[2]"\nexit /b\n#PS#\n${ps}`;
  return cmd.replace(/\r?\n/g, '\r\n');
}
