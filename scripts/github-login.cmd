@echo off
rem One-time GitHub sign-in for publishing releases. Opens the browser; follow the prompts.
"C:\Program Files\GitHub CLI\gh.exe" auth login --hostname github.com --git-protocol https --web --scopes "repo,workflow"
"C:\Program Files\GitHub CLI\gh.exe" auth setup-git
echo.
echo Done. Go back to Claude and say it is finished.
