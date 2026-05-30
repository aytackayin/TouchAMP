
$ProgressPreference = 'SilentlyContinue'
Start-Sleep -Seconds 3

$zipPath = 'C:/Users/EYETOU~1/AppData/Local/Temp/touchamp-update.zip'
$extractPath = 'C:/Users/EYETOU~1/AppData/Local/Temp/touchamp-extracted'
$targetPath = 'H:/Projeler/TouchAMP'

try {
    if (Test-Path $extractPath) { Remove-Item -Recurse -Force $extractPath }
    Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
} catch {
    exit 1
}

$binFile = Get-ChildItem -Path $extractPath -Filter 'TouchAMP.exe' -Recurse | Select-Object -First 1
if (!$binFile) {
    exit 1
}
$sourceRoot = $binFile.Directory.FullName

function Copy-FilesWithExclusions($src, $dest) {
    $excludeFolders = @('www', 'data', 'backups', 'mysql_exports', 'versions', 'ssl', 'sites-enabled')
    $excludeFiles = @('settings.json', 'cron.json')
    
    Get-ChildItem -Path $src | ForEach-Object {
        $name = $_.Name
        $isContainer = $_.PSIsContainer
        $destPath = Join-Path $dest $name
        
        if ($isContainer) {
            if ($excludeFolders -contains $name) { return }
            if ($name -eq 'etc') {
                if (!(Test-Path $destPath)) { New-Item -ItemType Directory -Path $destPath -Force | Out-Null }
                Copy-EtcSubfolders (Join-Path $src 'etc') $destPath
                return
            }
            if ($name -eq 'bin') {
                if (!(Test-Path $destPath)) { New-Item -ItemType Directory -Path $destPath -Force | Out-Null }
                Copy-BinSubfolders (Join-Path $src 'bin') $destPath
                return
            }
            if (!(Test-Path $destPath)) { New-Item -ItemType Directory -Path $destPath -Force | Out-Null }
            Copy-FilesWithExclusions $_.FullName $destPath
        } else {
            if ($excludeFiles -contains $name) { return }
            if ($name -eq 'quick_access.json' -and (Test-Path $destPath)) { return }
            Copy-Item -Path $_.FullName -Destination $destPath -Force
        }
    }
}

function Copy-EtcSubfolders($src, $dest) {
    Get-ChildItem -Path $src | ForEach-Object {
        $name = $_.Name
        $destPath = Join-Path $dest $name
        if ($_.PSIsContainer) {
            if ($name -eq 'ssl') { return }
            if ($name -eq 'apache2') {
                if (!(Test-Path $destPath)) { New-Item -ItemType Directory -Path $destPath -Force | Out-Null }
                Copy-Apache2Subfolders $_.FullName $destPath
                return
            }
            if (!(Test-Path $destPath)) { New-Item -ItemType Directory -Path $destPath -Force | Out-Null }
            Copy-FilesWithExclusions $_.FullName $destPath
        } else {
            Copy-Item -Path $_.FullName -Destination $destPath -Force
        }
    }
}

function Copy-Apache2Subfolders($src, $dest) {
    Get-ChildItem -Path $src | ForEach-Object {
        $name = $_.Name
        $destPath = Join-Path $dest $name
        if ($_.PSIsContainer) {
            if ($name -eq 'sites-enabled') { return }
            if (!(Test-Path $destPath)) { New-Item -ItemType Directory -Path $destPath -Force | Out-Null }
            Copy-FilesWithExclusions $_.FullName $destPath
        } else {
            Copy-Item -Path $_.FullName -Destination $destPath -Force
        }
    }
}

function Copy-BinSubfolders($src, $dest) {
    Get-ChildItem -Path $src | ForEach-Object {
        $name = $_.Name
        $destPath = Join-Path $dest $name
        if ($_.PSIsContainer) {
            if ($name -eq 'versions') { return }
            if (!(Test-Path $destPath)) { New-Item -ItemType Directory -Path $destPath -Force | Out-Null }
            Copy-FilesWithExclusions $_.FullName $destPath
        } else {
            Copy-Item -Path $_.FullName -Destination $destPath -Force
        }
    }
}

Copy-FilesWithExclusions $sourceRoot $targetPath

$exePath = Join-Path $targetPath 'TouchAMP.exe'
if (Test-Path $exePath) {
    Start-Process -FilePath $exePath -WorkingDirectory $targetPath
}

Start-Job -ScriptBlock {
    Start-Sleep -Seconds 5
    Remove-Item -Path $args[0] -Force
    Remove-Item -Path $args[1] -Recurse -Force
    Remove-Item -Path $args[2] -Force
} -ArgumentList $zipPath, $extractPath, $MyInvocation.MyCommand.Path
