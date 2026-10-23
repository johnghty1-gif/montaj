@echo off
rem Builds the installer, uploads it to GitHub Releases, and publishes the release.
rem Bump "version" in package.json first. Needs a one-time scripts\github-login.cmd.
setlocal
cd /d "%~dp0.."
set GH="C:\Program Files\GitHub CLI\gh.exe"
for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set VERSION=%%v
for /f "delims=" %%t in ('%GH% auth token') do set GH_TOKEN=%%t
echo Publishing Montaj %VERSION% ...
call npm run release || goto :fail
%GH% release edit v%VERSION% --draft=false --latest --title "Montaj %VERSION%" || goto :fail
echo.
echo Released v%VERSION%. Installed copies will update automatically.
exit /b 0
:fail
echo.
echo Release failed. See the messages above.
exit /b 1
