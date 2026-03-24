@echo off
setlocal
set PYTHONPATH=C:\Users\every\SportSync\.pydeps313;C:\Users\every\SportSync\backend
cd /d C:\Users\every\SportSync\backend
echo [%date% %time%] launching backend >> C:\Users\every\SportSync\backend-dev.log
"C:\Users\every\Anaconda3\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8000 >> C:\Users\every\SportSync\backend-dev.log 2>> C:\Users\every\SportSync\backend-dev.err.log
echo [%date% %time%] backend exited with %errorlevel% >> C:\Users\every\SportSync\backend-dev.log
