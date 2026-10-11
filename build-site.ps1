param(
    [string]$Login = 'yf',
    [string]$PoemsDir = (Join-Path $PSScriptRoot 'poems'),
    [string]$SiteDir = (Join-Path $PSScriptRoot 'site')
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding $false

$index = Import-Csv (Join-Path $PoemsDir 'index.csv') -Encoding UTF8
$author = ''
$sections = New-Object System.Collections.ArrayList
$sectionIds = @{}

$poems = foreach ($row in $index) {
    if (-not $sectionIds.ContainsKey($row.Section)) {
        $sectionIds[$row.Section] = $sections.Count
        [void]$sections.Add($row.Section)
    }

    $raw = [IO.File]::ReadAllText((Join-Path $PoemsDir $row.File), $utf8) -replace "`r", ''
    $sep = $raw.LastIndexOf("`n---`n")
    $body = if ($sep -ge 0) { $raw.Substring(0, $sep) } else { $raw }
    $footer = if ($sep -ge 0) { $raw.Substring($sep + 5) } else { '' }
    if (-not $author -and $footer) { $author = ($footer -split ',')[0].Trim() }

    $nl = $body.IndexOf("`n")
    $text = if ($nl -ge 0) { $body.Substring($nl + 1) } else { '' }

    [ordered]@{
        id    = $row.Number
        s     = $sectionIds[$row.Section]
        title = $row.Title
        info  = $row.Info
        url   = $row.Url
        text  = $text.Trim("`n")
    }
}

$photo = $null
$photoPath = Join-Path $PoemsDir 'author.jpg'
if (Test-Path $photoPath) {
    Add-Type -AssemblyName System.Drawing
    $image = [Drawing.Image]::FromFile($photoPath)
    $photo = [ordered]@{
        width  = $image.Width
        height = $image.Height
        base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($photoPath))
    }
    $image.Dispose()
}

$data = [ordered]@{
    author    = $author
    authorUrl = "https://stihi.ru/avtor/$Login"
    photo     = $photo
    sections  = @($sections)
    poems     = @($poems)
}

New-Item -ItemType Directory -Force $SiteDir | Out-Null
$json = $data | ConvertTo-Json -Depth 4 -Compress
[IO.File]::WriteAllText((Join-Path $SiteDir 'data.js'), "window.STIHI = $json;`n", $utf8)
Write-Host "site/data.js: $(@($poems).Count) poems, $($sections.Count) sections"
