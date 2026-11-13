@echo off
title Servidor MES Metalrib (Auto-Reload)
cd /d "%~dp0"
taskkill /F /IM node.exe >nul 2>&1

start "MES Backend (3001)" /min cmd /c "for /l %%x in (1,0,2) do (node --watch server/index.js & timeout /t 2 >nul)"
timeout /t 3 /nobreak >nul
start "MES Frontend (3000)" /min cmd /c "for /l %%x in (1,0,2) do (npx vite preview --host 0.0.0.0 --port 3000 & timeout /t 2 >nul)"