param([string]$Version = '0.4.1')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$release = Join-Path $root "release/$Version"
$manifest = Get-Content -LiteralPath (Join-Path $release 'manifest.json') -Raw | ConvertFrom-Json
$checks = 0
foreach ($file in $manifest.files) {
    $path = Join-Path $release $file.name
    if ((Get-Item -LiteralPath $path).Length -ne $file.bytes -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw "Package checksum mismatch: $($file.name)" }
    $checks++
}
function Test-Entry($archive, [string]$name, [string]$source) {
    $entry = $archive.GetEntry($name)
    if ($null -eq $entry) { throw "Missing package entry: $name" }
    $stream = $entry.Open()
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $hasher.Dispose() }
    if ($hash -ne (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()) { throw "Packaged entry differs: $name" }
}
$apk = [IO.Compression.ZipFile]::OpenRead((Join-Path $release "ew4-mod-editor-$Version-arm64.apk"))
$web = [IO.Compression.ZipFile]::OpenRead((Join-Path $release "ew4-mod-editor-$Version-windows-web.zip"))
try {
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $root 'dist') -File -Recurse) {
        $relative = [IO.Path]::GetRelativePath((Join-Path $root 'dist'), $file.FullName).Replace('\', '/')
        Test-Entry $apk "assets/www/$relative" $file.FullName
        Test-Entry $web "server/wwwroot/$relative" $file.FullName
        $checks += 2
    }
    Test-Entry $apk 'assets/www/native.js' (Join-Path $root 'android/native.js')
    Test-Entry $web 'server/Ew4.Editor.dll' (Join-Path $release 'web/server/Ew4.Editor.dll')
    foreach ($archive in @($apk, $web)) {
        if ($archive.Entries | Where-Object FullName -match '(^|/)(author\.json|session\.json|.*\.keystore|.*\.jks)$') { throw 'Author, player data or signing material entered package' }
    }
    $checks += 4
}
finally { $apk.Dispose(); $web.Dispose() }
$result = [ordered]@{ version = $Version; checks = $checks; errors = 0; androidDeviceTested = $false }
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $release 'verification.json') -Encoding utf8
$result | ConvertTo-Json -Compress
