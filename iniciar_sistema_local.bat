@echo off
title Sistema Metalrib MES - Servidor Local
echo A iniciar Servidor Local...
cd server
start cmd /k "node index.js"
cd ..
echo A iniciar Painel Web na rede local (192.168.0.12)...
start cmd /k "npm run dev -- --host 192.168.0.12"
