@echo off
title Servidor MES Metalrib (Auto-Reload)
cd /d "%~dp0"
taskkill /F /IM node.exe >nul 2>&1

start "MES Backend (3001)" /min cmd /k "node --watch server/index.js"
timeout /t 3 /nobreak >nul
start "MES Frontend (3000)" /min cmd /k "npx vite preview --host 0.0.0.0 --port 3000"
timeout /t 3 /nobreak >nul

start "" "chrome.exe" --start-maximized "http://192.168.0.12:3000" "https://metalrib.nomus.com.br/metalrib/Login.do?metodo=LogOff"