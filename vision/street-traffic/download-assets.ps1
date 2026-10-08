param([string]$CacheDir = '')
$ErrorActionPreference = 'Stop'
if (-not $CacheDir) {
    $CacheDir = if (Test-Path 'F:\') { 'F:\AllurVisionCache' } else { Join-Path $PSScriptRoot 'cache' }
}
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
function Save-Asset([string]$Url, [string]$Name) {
    $target = Join-Path $CacheDir $Name
    if (-not (Test-Path -LiteralPath $target)) {
        $partial = "$target.$([guid]::NewGuid().ToString('N')).part"
        Invoke-WebRequest -Uri $Url -OutFile $partial
        Move-Item -LiteralPath $partial -Destination $target
    }
    return $target
}
$modelPath = Save-Asset 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/object_detection_yolox/object_detection_yolox_2022nov.onnx' 'object_detection_yolox_2022nov.onnx'
$expected = 'C5C2D13E59AE883E6AF3B45DAEA64AF4833A4951C92D116EC270D9DDBE998063'
if ((Get-FileHash -LiteralPath $modelPath -Algorithm SHA256).Hash -ne $expected) {
    throw 'Model checksum differs. Existing file preserved; inspect before replacing.'
}
$videoPath = Save-Asset 'https://upload.wikimedia.org/wikipedia/commons/7/70/Street_traffic.webm' 'street-traffic.webm'
if ((Get-FileHash -LiteralPath $videoPath -Algorithm SHA256).Hash -ne 'E5FACB24BAF755F0C1193999D823E99F6032661AD2BDEF5CC28CC1CBBFDE03E2') {
    throw 'Video checksum differs. Existing file preserved; inspect before replacing.'
}
Write-Output "Model: $modelPath"
Write-Output "Video: $videoPath"
Write-Output 'Street traffic - Editor, CC BY 3.0. Real road video, not Allur.'
