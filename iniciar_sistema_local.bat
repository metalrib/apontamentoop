@echo off
chcp 65001 >nul
title Sistema Metalrib MES - Servidor de Producao (Zero-Downtime)
echo =========================================================================
echo       METALRIB MES - INICIALIZANDO SERVIDOR EM MODO PRODUCAO
echo =========================================================================
echo.

echo [1/3] Verificando e garantindo build de producao (dist)...
if not exist "dist\index.html" (
    echo Build de producao nao encontrado. Executando compilacao inicial...
    call npm run build
) else (
    echo Build de producao (dist) verificado.
)

echo.
echo [2/3] Iniciando Servidor Backend MES (SQLite + Socket.io na porta 3001)...
cd server
start "Metalrib MES - Backend (Porta 3001)" cmd /k "title Metalrib MES - Backend (3001) && node index.js"
cd ..

echo.
echo [3/3] Iniciando Frontend de Producao (vite preview --host 0.0.0.0 --port 3000)...
start "Metalrib MES - Frontend Producao (Porta 3000)" cmd /k "title Metalrib MES - Frontend (3000) && :loop && npm start && timeout /t 1 >nul && goto loop"

echo.
echo =========================================================================
echo   SISTEMA ONLINE E PRONTO PARA OS TERMINAIS:
echo   - Frontend Terminais: http://192.168.0.12:3000 (ou http://localhost:3000)
echo   - Backend MES:        http://192.168.0.12:3001 (ou http://localhost:3001)
echo   - Modo:               PRODUCAO ATOMICA (Zero-Downtime)
echo =========================================================================
echo.
timeout /t 5 >nul
