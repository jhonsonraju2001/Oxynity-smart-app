Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\HOME\.gemini\antigravity\brain\2c8be46e-561d-4cde-85c9-754756b0e6ba\.user_uploaded\media_1789560456082.png"
if (-not (Test-Path $srcPath)) {
    Write-Error "Source image not found: $srcPath"
    exit 1
}

$srcImage = [System.Drawing.Image]::FromFile($srcPath)
Write-Host "Source image loaded: $($srcImage.Width) x $($srcImage.Height)"

function Generate-Icon {
    param(
        [System.Drawing.Image]$Image,
        [int]$CanvasWidth,
        [int]$CanvasHeight,
        [double]$ContentScale = 1.0,
        [string]$DestinationPath,
        [bool]$DrawWhiteBackground = $false,
        [bool]$IsCircle = $false
    )

    $parentDir = Split-Path -Parent $DestinationPath
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }

    $destBitmap = New-Object System.Drawing.Bitmap $CanvasWidth, $CanvasHeight
    $graphics = [System.Drawing.Graphics]::FromImage($destBitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    $graphics.Clear([System.Drawing.Color]::Transparent)

    if ($DrawWhiteBackground) {
        $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
        if ($IsCircle) {
            $graphics.FillEllipse($brush, 0, 0, $CanvasWidth, $CanvasHeight)
        } else {
            $radius = [Math]::Round($CanvasWidth * 0.20)
            $diameter = $radius * 2
            $path = New-Object System.Drawing.Drawing2D.GraphicsPath
            $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
            $path.AddArc($CanvasWidth - $diameter, 0, $diameter, $diameter, 270, 90)
            $path.AddArc($CanvasWidth - $diameter, $CanvasHeight - $diameter, $diameter, $diameter, 0, 90)
            $path.AddArc(0, $CanvasHeight - $diameter, $diameter, $diameter, 90, 90)
            $path.CloseFigure()
            $graphics.FillPath($brush, $path)
            $path.Dispose()
        }
        $brush.Dispose()
    }

    $drawW = [Math]::Round($CanvasWidth * $ContentScale)
    $drawH = [Math]::Round($CanvasHeight * $ContentScale)
    $offsetX = [Math]::Round(($CanvasWidth - $drawW) / 2)
    $offsetY = [Math]::Round(($CanvasHeight - $drawH) / 2)

    $graphics.DrawImage($Image, $offsetX, $offsetY, $drawW, $drawH)
    $graphics.Dispose()

    $destBitmap.Save($DestinationPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $destBitmap.Dispose()
    Write-Host "Generated: $DestinationPath ($CanvasWidth x $CanvasHeight with scale $ContentScale)"
}

$baseDir = "c:\Users\HOME\Downloads\Oxynity-smart-main\Oxynity-smart-main"

# 1. Web Assets
Generate-Icon -Image $srcImage -CanvasWidth 1024 -CanvasHeight 1024 -ContentScale 1.0 -DestinationPath "$baseDir\src\assets\oxynity-logo.png"
Generate-Icon -Image $srcImage -CanvasWidth 512  -CanvasHeight 512  -ContentScale 1.0 -DestinationPath "$baseDir\public\logo.png"
Generate-Icon -Image $srcImage -CanvasWidth 180  -CanvasHeight 180  -ContentScale 0.82 -DestinationPath "$baseDir\public\apple-touch-icon.png" -DrawWhiteBackground $true -IsCircle $false
Generate-Icon -Image $srcImage -CanvasWidth 64   -CanvasHeight 64   -ContentScale 1.0 -DestinationPath "$baseDir\public\favicon.png"

# 2. Android Mipmap Icons
# Android Adaptive Icons rule: 108dp canvas with safe zone of 66-72dp diameter (0.62 - 0.65 scale)
$mipmaps = @(
    @{ folder = "mipmap-mdpi";    size = 48;  fgSize = 108 },
    @{ folder = "mipmap-hdpi";    size = 72;  fgSize = 162 },
    @{ folder = "mipmap-xhdpi";   size = 96;  fgSize = 216 },
    @{ folder = "mipmap-xxhdpi";  size = 144; fgSize = 324 },
    @{ folder = "mipmap-xxxhdpi"; size = 192; fgSize = 432 }
)

foreach ($m in $mipmaps) {
    $folderPath = "$baseDir\android\app\src\main\res\$($m.folder)"
    
    # Adaptive Foreground: Scaled to 0.64 (Android official 66dp/108dp safe zone) so launcher mask NEVER crops the logo
    Generate-Icon -Image $srcImage -CanvasWidth $m.fgSize -CanvasHeight $m.fgSize -ContentScale 0.64 -DestinationPath "$folderPath\ic_launcher_foreground.png"
    
    # Legacy Square Icon: White background with 80% centered logo
    Generate-Icon -Image $srcImage -CanvasWidth $m.size -CanvasHeight $m.size -ContentScale 0.80 -DestinationPath "$folderPath\ic_launcher.png" -DrawWhiteBackground $true -IsCircle $false
    
    # Legacy Round Icon: White circular background with 76% centered logo
    Generate-Icon -Image $srcImage -CanvasWidth $m.size -CanvasHeight $m.size -ContentScale 0.76 -DestinationPath "$folderPath\ic_launcher_round.png" -DrawWhiteBackground $true -IsCircle $true
}

# 3. Android Splash Screens (Centered with clean safe margin)
$splashFolders = @(
    "drawable", "drawable-port-mdpi", "drawable-port-hdpi", 
    "drawable-port-xhdpi", "drawable-port-xxhdpi", "drawable-port-xxxhdpi"
)
foreach ($sf in $splashFolders) {
    $splashPath = "$baseDir\android\app\src\main\res\$sf\splash.png"
    Generate-Icon -Image $srcImage -CanvasWidth 480 -CanvasHeight 480 -ContentScale 0.60 -DestinationPath $splashPath
}

$srcImage.Dispose()
Write-Host "All Android icons and splash screens generated with pixel-perfect safe zones!"
