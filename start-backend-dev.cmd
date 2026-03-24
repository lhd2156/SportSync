@echo off
setlocal
set PYTHONPATH=C:\Users\every\SportSync\.pydeps313;C:\Users\every\SportSync\backend
set WATCHFILES_FORCE_POLLING=true
cd /d C:\Users\every\SportSync\backend
echo [%date% %time%] launching backend dev >> C:\Users\every\SportSync\backend-dev.log
"C:\Users\every\Anaconda3\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload --reload-dir C:\Users\every\SportSync\backend\routers --reload-dir C:\Users\every\SportSync\backend\schemas --reload-dir C:\Users\every\SportSync\backend\services --reload-dir C:\Users\every\SportSync\backend\models --reload-dir C:\Users\every\SportSync\backend\ml >> C:\Users\every\SportSync\backend-dev.log 2>> C:\Users\every\SportSync\backend-dev.err.log
echo [%date% %time%] backend dev exited with %errorlevel% >> C:\Users\every\SportSync\backend-dev.log
