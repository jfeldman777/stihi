param(
    [string]$Author = 'yf',
    [string]$OutDir = (Join-Path $PSScriptRoot 'poems'),
    [int]$DelayMs = 700
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$base = 'https://stihi.ru'
$cp1251 = [Text.Encoding]::GetEncoding(1251)
$utf8 = New-Object Text.UTF8Encoding $false

function Get-Page([string]$path) {
    for ($attempt = 1; ; $attempt++) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri ($base + $path) -TimeoutSec 60
            Start-Sleep -Milliseconds $DelayMs
            return $cp1251.GetString($r.RawContentStream.ToArray())
        } catch {
            if ($attempt -ge 4) { throw }
            Start-Sleep -Seconds (5 * $attempt)
        }
    }
}

function ConvertFrom-Html([string]$s) {
    $s = $s -replace '(?i)<br\s*/?>\r?\n?', "`n"
    $s = $s -replace '(?i)</p>\r?\n?', "`n"
    $s = $s -replace '<[^>]+>', ''
    $s = [Net.WebUtility]::HtmlDecode($s).Replace([char]0xA0, ' ')
    ($s -replace "`r", '').Trim()
}

function Get-SafeName([string]$s) {
    ($s -replace '[\\/:*?"<>|]', '_').Trim().TrimEnd('.')
}

# Collects poems of one section, following the "&s=50" pagination links.
function Get-SectionPoems([string]$path) {
    $poems = New-Object System.Collections.ArrayList
    $seen = @{}
    $offset = 0
    while ($true) {
        $page = if ($offset -eq 0) { $path } else { "$path&s=$offset" }
        $html = Get-Page $page
        $items = [regex]::Matches($html, '<li><a href="(/[^"]+)" class="poemlink">(.*?)</a>\s*<small>(.*?)</small>')
        foreach ($m in $items) {
            $url = $m.Groups[1].Value
            if ($seen.ContainsKey($url)) { continue }
            $seen[$url] = $true
            [void]$poems.Add([pscustomobject]@{
                Url   = $url
                Title = ConvertFrom-Html $m.Groups[2].Value
                Info  = ((ConvertFrom-Html $m.Groups[3].Value) -replace '^-\s*', '')
            })
        }
        $offset += 50
        if ($html -notmatch [regex]::Escape("&s=$offset")) { break }
    }
    , $poems
}

$mainHtml = Get-Page "/avtor/$Author"
$authorName = ConvertFrom-Html ([regex]::Match($mainHtml, '<h1>(.*?)</h1>').Groups[1].Value)

$books = foreach ($m in [regex]::Matches($mainHtml, '<div ID="bookheader"><a href="/avtor/' + [regex]::Escape($Author) + '&book=(\d+)#\d+">(.*?)</a>')) {
    [pscustomobject]@{ Path = "/avtor/$Author&book=$($m.Groups[1].Value)"; Name = ConvertFrom-Html $m.Groups[2].Value }
}

$unsortedName = 'Unsorted'
if ($books) {
    $bookHtml = Get-Page $books[0].Path
    $m = [regex]::Match($bookHtml, '<div ID="bookheader"><a href="/avtor/' + [regex]::Escape($Author) + '">(.*?)</a>')
    if ($m.Success) { $unsortedName = ConvertFrom-Html $m.Groups[1].Value }
}

$sections = @([pscustomobject]@{ Path = "/avtor/$Author"; Name = $unsortedName }) + @($books)

Write-Host "Author: $Author, sections: $($sections.Count)"
$plan = New-Object System.Collections.ArrayList
$sectionNo = 0
foreach ($section in $sections) {
    $sectionNo++
    $folder = '{0:D2} {1}' -f $sectionNo, (Get-SafeName $section.Name)
    $poems = Get-SectionPoems $section.Path
    Write-Host ("section {0:D2}: {1} poems" -f $sectionNo, $poems.Count)
    foreach ($p in $poems) {
        [void]$plan.Add([pscustomobject]@{ Section = $section.Name; Folder = $folder; Poem = $p })
    }
}

$total = $plan.Count
Write-Host "Total poems: $total"
New-Item -ItemType Directory -Force $OutDir | Out-Null

$photoMatch = [regex]::Match($mainHtml, '<span class="authorsphoto"><img src="([^"]+)"')
if ($photoMatch.Success) {
    $photo = Invoke-WebRequest -UseBasicParsing -Uri ($base + $photoMatch.Groups[1].Value) -TimeoutSec 60
    [IO.File]::WriteAllBytes((Join-Path $OutDir 'author.jpg'), $photo.RawContentStream.ToArray())
}

$index = New-Object System.Collections.ArrayList
$failed = 0
for ($i = 0; $i -lt $total; $i++) {
    $item = $plan[$i]
    $number = '{0:D4}' -f ($i + 1)
    $dir = Join-Path $OutDir $item.Folder
    $file = Join-Path $dir "$number.txt"
    New-Item -ItemType Directory -Force $dir | Out-Null

    [void]$index.Add([pscustomobject]@{
        Number  = $number
        Section = $item.Section
        Title   = $item.Poem.Title
        Info    = $item.Poem.Info
        Url     = $base + $item.Poem.Url
        File    = "$($item.Folder)\$number.txt"
    })

    if ((Test-Path $file) -and (Get-Item $file).Length -gt 0) { continue }

    try {
        $html = Get-Page $item.Poem.Url
        $title = ConvertFrom-Html ([regex]::Match($html, '(?s)<h1>(.*?)</h1>').Groups[1].Value)
        $textMatch = [regex]::Match($html, '(?s)<div class="text">(.*?)</div>')
        if (-not $textMatch.Success) { throw 'poem text not found' }
        $text = ConvertFrom-Html $textMatch.Groups[1].Value
        if (-not $title) { $title = $item.Poem.Title }

        $content = "$title`n`n$text`n`n---`n$authorName, $($item.Poem.Info)`n$base$($item.Poem.Url)`n"
        [IO.File]::WriteAllText($file, $content, $utf8)
        Write-Host "$number/$total ok"
    } catch {
        $failed++
        Write-Host "$number/$total FAILED $($item.Poem.Url): $_"
    }
}

$index | Export-Csv -Path (Join-Path $OutDir 'index.csv') -NoTypeInformation -Encoding UTF8
Write-Host "Done. Total: $total, failed: $failed"
