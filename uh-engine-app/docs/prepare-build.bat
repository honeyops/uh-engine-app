@echo off
REM Preparation script to copy source files from uh-engine to service directory for Snowflake Native App build

echo Preparing Unified Honey Engine for Snowflake Native App build...

SET UH_ENGINE_DIR=..\..\uh-engine
SET SERVICE_DIR=.\service

REM Clean the service directory (except Dockerfile and start.sh)
echo Cleaning service directory...
cd %SERVICE_DIR%
for /d %%i in (*) do (
    if /i not "%%i"=="Dockerfile" if /i not "%%i"=="start.sh" rd /s /q "%%i" 2>nul
)
for %%i in (*) do (
    if /i not "%%i"=="Dockerfile" if /i not "%%i"=="start.sh" del /q "%%i" 2>nul
)
cd ..

REM Copy backend
echo Copying backend...
xcopy /E /I /Y "%UH_ENGINE_DIR%\backend" "%SERVICE_DIR%\backend"

REM Copy frontend
echo Copying frontend...
xcopy /E /I /Y "%UH_ENGINE_DIR%\frontend" "%SERVICE_DIR%\frontend"

REM Copy configuration if it exists
if exist "%UH_ENGINE_DIR%\configuration" (
    echo Copying configuration...
    xcopy /E /I /Y "%UH_ENGINE_DIR%\configuration" "%SERVICE_DIR%\configuration"
) else (
    echo No configuration directory found, skipping...
)

echo.
echo Build preparation complete!
echo You can now run: build-and-push.sh
pause
