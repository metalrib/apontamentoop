@echo off
title Servidor MES Metalrib
echo Encerrando processos antigos...
taskkill /F /IM node.exe >nul 2>&1

echo Iniciando Backend (Porta 3001)...
start "MES Backend (3001)" cmd /k "node server/index.js"

timeout /t 2 /nobreak >nul

echo Iniciando Frontend (Porta 3000)...
start "MES Frontend (3000)" cmd /k "npx vite preview --host 0.0.0.0 --port 3000"

echo Sistemas iniciados com sucesso! Pode fechar esta janela de aviso.
timeout /t 4