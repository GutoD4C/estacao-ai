; Inno Setup Script para Estação-ai (Windows 10 e Windows 11 - 64-bit)
; Instala e configura tudo automaticamente (MCP, hooks, skills, serviço de login,
; modelos locais e atalhos na Área de Trabalho / Menu Iniciar) sem precisar de comandos.
#ifndef MyAppVersion
  #define MyAppVersion "1.7.6"
#endif

[Setup]
AppId={{8D4E6C1F-42B9-4E83-9C35-E57AC40A19B1}
AppName=Estação-ai
AppVersion={#MyAppVersion}
AppPublisher=GutoD4C
AppPublisherURL=https://github.com/GutoD4C/estacao-ai
DefaultDirName={localappdata}\Programs\estacao-ai
DefaultGroupName=Estação-ai
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.10240
CloseApplications=force
CloseApplicationsFilter=estacao-ai.exe
OutputDir=..\..\target\packages
OutputBaseFilename=Estacao-ai-Setup-win10-11-x64
SetupIconFile=estacao-ai.ico
UninstallDisplayIcon={app}\estacao-ai.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "..\..\target\release\estacao-ai.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "estacao-ai.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\NOTICE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\iniciar.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\hooks\*"; DestDir: "{app}\hooks"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Estação-ai"; Filename: "{app}\estacao-ai.exe"; Parameters: "app"; IconFilename: "{app}\estacao-ai.ico"; Comment: "Abrir a aplicação Estação-ai"
Name: "{autodesktop}\Estação-ai"; Filename: "{app}\estacao-ai.exe"; Parameters: "app"; IconFilename: "{app}\estacao-ai.ico"; Comment: "Abrir a aplicação Estação-ai"

[Run]
; O iniciador configura a primeira execução e abre o navegador padrão.
Filename: "{app}\estacao-ai.exe"; Parameters: "app"; Description: "Abrir Estação I.A"; Flags: nowait postinstall skipifsilent runhidden

[Code]
var
  ReiniciarSupervisor: Boolean;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Pasta, Estado: String;
  I: Integer;
begin
  Result := '';
  Pasta := ExpandConstant('{localappdata}\estacao-ai\');
  Estado := Pasta + 'service-host.json';
  if FileExists(Estado) then
  begin
    ReiniciarSupervisor := True;
    if SaveStringToFile(Pasta + 'service-host.stop', 'stop', False) then
      for I := 1 to 100 do begin
        if not FileExists(Estado) then begin
          ReiniciarSupervisor := True;
          Break;
        end;
        Sleep(100);
      end;
  end;
  // Restart Manager closes processes using this install's files before replacement.
end;

procedure RestaurarSupervisor();
var
  Codigo: Integer;
begin
  if ReiniciarSupervisor and WizardSilent() then
    if Exec(ExpandConstant('{app}\estacao-ai.exe'), 'service-host', '', SW_HIDE, ewNoWait, Codigo) then
      ReiniciarSupervisor := False;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then RestaurarSupervisor();
end;

procedure DeinitializeSetup();
begin
  RestaurarSupervisor();
end;
