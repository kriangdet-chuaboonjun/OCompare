; Inno Setup 6 script. Build with scripts/build-release.ps1 (passes /DAppVersion).
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\src-tauri\target\release"
#endif
#ifndef ExplorerDir
  #define ExplorerDir "..\..\src-tauri\explorer"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\src-tauri\target\release\installer"
#endif

#define AppName "OCompare"
#define AppExe "o-compare-rust.exe"
; Matches the Tauri identifier so taskbar grouping and app data stay the same.
#define AppUserModelId "th.co.fusionsoft.ocompare.rust"

[Setup]
; AppId must never change: Setup uses it to find the existing install and upgrade it in place.
AppId={{F19E4506-99AF-45B6-9062-079BC1220442}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=FusionSoft
VersionInfoVersion={#AppVersion}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
UsePreviousAppDir=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
SetupIconFile=..\..\src-tauri\icons\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
OutputDir={#OutputDir}
OutputBaseFilename=OCompare-{#AppVersion}-x64-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Ask Thai or English up front, preselecting the Windows UI language (Thai when it matches neither).
ShowLanguageDialog=yes
LanguageDetectionMethod=uilanguage
CloseApplications=no
RestartApplications=no

[Languages]
Name: "thai"; MessagesFile: "compiler:Languages\Thai.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

; Text used by [Code]; %1 is filled by FmtMessage and %n is a line break.
[CustomMessages]
thai.AppRunning=OCompare กำลังเปิดอยู่ ต้องปิดโปรแกรมก่อนดำเนินการต่อ%n%nต้องการให้ปิด OCompare ตอนนี้หรือไม่? (OCompare จะถามก่อนหากมีงานที่ยังไม่ได้บันทึก)
english.AppRunning=OCompare is running and must be closed before continuing.%n%nClose OCompare now? (OCompare asks first if there is unsaved work.)
thai.NewerInstalled=พบ OCompare เวอร์ชัน %1 ติดตั้งอยู่แล้ว ซึ่งใหม่กว่าตัวติดตั้งนี้ ({#AppVersion})%nยกเลิกการติดตั้งเพื่อป้องกันการลดเวอร์ชัน หากต้องการถอนการติดตั้ง ให้ใช้ Settings > Apps ของ Windows
english.NewerInstalled=OCompare version %1 is already installed, which is newer than this installer ({#AppVersion}).%nSetup was cancelled to prevent a downgrade. To uninstall, use Windows Settings > Apps.
thai.ModeTitle=พบ OCompare ในเครื่องแล้ว
english.ModeTitle=OCompare is already installed
thai.ModeSubtitle=เวอร์ชันที่ติดตั้งอยู่: %1
english.ModeSubtitle=Installed version: %1
thai.ModeInfo=เลือกสิ่งที่ต้องการทำ แล้วกด ถัดไป%nการตั้งค่าและประวัติการแก้ไขจะถูกเก็บไว้ทั้งสองกรณี
english.ModeInfo=Choose what to do, then click Next.%nYour settings and edit history are kept either way.
thai.ModeRepair=ติดตั้งซ้ำ (ซ่อมแซม) เวอร์ชัน {#AppVersion}
english.ModeRepair=Reinstall (repair) version {#AppVersion}
thai.ModeUpdate=อัปเดตจากเวอร์ชัน %1 เป็น {#AppVersion}
english.ModeUpdate=Update from version %1 to {#AppVersion}
thai.ModeUninstall=ถอนการติดตั้ง OCompare
english.ModeUninstall=Uninstall OCompare
thai.DesktopShortcut=สร้างทางลัดบนเดสก์ท็อป
english.DesktopShortcut=Create a desktop shortcut
thai.LaunchApp=เปิด OCompare
english.LaunchApp=Launch OCompare
thai.UninstallerMissing=ไม่พบตัวถอนการติดตั้ง ให้ถอนผ่าน Settings > Apps ของ Windows
english.UninstallerMissing=The uninstaller was not found. Uninstall from Windows Settings > Apps.
thai.UninstallerFailed=เปิดตัวถอนการติดตั้งไม่สำเร็จ (%1)
english.UninstallerFailed=Could not start the uninstaller (%1)
thai.StillRunning=OCompare ยังเปิดอยู่ จึงติดตั้งไม่ได้ บันทึกงานแล้วปิดโปรแกรม จากนั้นกด กลับ เพื่อลองใหม่ หรือกด ยกเลิก เพื่อออก
english.StillRunning=OCompare is still running, so Setup cannot continue. Save your work and close it, then click Back to try again, or click Cancel to exit.
thai.UninstallCancelled=ยกเลิกการถอนการติดตั้ง เพราะ OCompare ยังเปิดอยู่
english.UninstallCancelled=Uninstall cancelled because OCompare is still running.
thai.OldIncomplete=การติดตั้ง %1 ตัวเดิมไม่สมบูรณ์ ให้ถอนผ่าน Settings > Apps ของ Windows แล้วลองใหม่
english.OldIncomplete=The previous %1 installation is incomplete. Uninstall it from Windows Settings > Apps and try again.
thai.OldNeedsAdmin=ต้องใช้สิทธิ์ผู้ดูแลระบบหนึ่งครั้งเพื่อลบ %1 ตัวเดิมที่ติดตั้งให้ทุกผู้ใช้ เปิดตัวติดตั้งอีกครั้งแล้วกดอนุญาต หรือถอนตัวเดิมผ่าน Settings > Apps ของ Windows
english.OldNeedsAdmin=Administrator permission is needed once to remove the previous system-wide %1. Run Setup again and allow it, or uninstall the old version from Windows Settings > Apps.
thai.OldRemoveFailed=ลบ %1 ตัวเดิมไม่สำเร็จ ปิดโปรแกรม แล้วถอนผ่าน Settings > Apps ของ Windows จากนั้นลองใหม่
english.OldRemoveFailed=The previous %1 could not be removed. Close it, uninstall it from Windows Settings > Apps, and try again.
thai.WebView2Failed=ติดตั้ง Microsoft WebView2 ไม่สำเร็จ OCompare ต้องใช้ WebView2 ตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่
english.WebView2Failed=Microsoft WebView2 could not be installed, and OCompare needs it. Check the internet connection and try again.

; No [Tasks] or [Run] postinstall entries: Inno's check-list box clips its checkbox/radio glyphs at
; 200% DPI, so those choices use standard Windows checkbox/radio controls created in [Code].

[Files]
Source: "{#SourceDir}\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ExplorerDir}\*"; DestDir: "{app}\resources\explorer"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; AppUserModelID: "{#AppUserModelId}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; AppUserModelID: "{#AppUserModelId}"; Check: WantDesktopIcon

[Run]
; Registration needs a signed, trusted package; without one the script reports it and Setup continues.
Filename: "powershell.exe"; Parameters: "-NoProfile -NonInteractive -File ""{app}\resources\explorer\register.ps1"" -InstallDirectory ""{app}"""; Flags: runhidden

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -NonInteractive -File ""{app}\resources\explorer\unregister.ps1"" -InstallDirectory ""{app}"""; Flags: runhidden; RunOnceId: "UnregisterExplorer"

[Code]
const
  UninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{F19E4506-99AF-45B6-9062-079BC1220442}_is1';
  NsisUninstallRoot = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\';
  WebView2Client = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

// App data (%APPDATA% and %LOCALAPPDATA%\{#AppUserModelId}) is deliberately left in place,
// so an update, reinstall or uninstall keeps settings and edit history.

var
  ModePage: TWizardPage;
  UpdateRadio, UninstallRadio: TNewRadioButton;
  DesktopCheck, LaunchCheck: TNewCheckBox;
  InstalledVer: String;
  ClosingForUninstall: Boolean;

function InstalledVersion(): String;
begin
  Result := '';
  if not RegQueryStringValue(HKCU, UninstallKey, 'DisplayVersion', Result) then
    if not RegQueryStringValue(HKLM, UninstallKey, 'DisplayVersion', Result) then
      Result := '';
end;

function CompareVersions(const A, B: String): Integer;
var
  PA, PB: Int64;
begin
  if not (StrToVersion(A, PA) and StrToVersion(B, PB)) then
  begin
    Result := 0;
    Exit;
  end;
  Result := ComparePackedVersion(PA, PB);
end;

// The Tauri updater starts Setup with NSIS-style switches; Inno ignores them, so detect updates here.
function HasParam(const Name: String): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), Name) = 0 then Result := True;
end;

function WantDesktopIcon(): Boolean;
begin
  Result := (DesktopCheck <> nil) and DesktopCheck.Checked;
end;

function IsAppRunning(): Boolean;
var
  Locator, Service, Processes: Variant;
begin
  Result := False;
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Service := Locator.ConnectServer('.', 'root\CIMV2');
    Processes := Service.ExecQuery('SELECT ProcessId FROM Win32_Process WHERE Name = ''{#AppExe}''');
    Result := Processes.Count > 0;
  except
    Result := False;
  end;
end;

function WaitForAppExit(Attempts: Integer): Boolean;
var
  Attempt: Integer;
begin
  for Attempt := 1 to Attempts do
  begin
    if not IsAppRunning() then Break;
    Sleep(250);
  end;
  Result := not IsAppRunning();
end;

// Ask before closing; returns False when the user keeps the app open or it does not close.
function CloseRunningApp(): Boolean;
var
  ResultCode: Integer;
begin
  // After an in-app update OCompare has already resolved unsaved work and is exiting.
  if HasParam('/UPDATE') and WaitForAppExit(40) then
  begin
    Result := True;
    Exit;
  end;
  Result := True;
  if not IsAppRunning() then Exit;
  if SuppressibleMsgBox(CustomMessage('AppRunning'), mbConfirmation, MB_YESNO, IDYES) <> IDYES then
  begin
    Result := False;
    Exit;
  end;
  // A polite close lets OCompare ask about unsaved documents; never force-kill an editor.
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM {#AppExe}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := WaitForAppExit(40);
end;

// Removes an installation made by the former Tauri NSIS Setup (0.4.5 and earlier, or older product
// names). Its uninstaller keeps app data when run with /S. Returns '' on success or an error message.
function RemoveNsisInstall(RootKey: Integer; const Product: String): String;
var
  Key, Uninstaller, Dir: String;
  ResultCode, Attempt: Integer;
  Started: Boolean;
begin
  Result := '';
  Key := NsisUninstallRoot + Product;
  if not RegQueryStringValue(RootKey, Key, 'UninstallString', Uninstaller) then Exit;
  // Only accept the standard Tauri uninstall command, never arbitrary registry arguments.
  if not RegQueryStringValue(RootKey, 'Software\co\' + Product, '', Dir) or
     (Uninstaller <> '"' + Dir + '\uninstall.exe"') or not FileExists(Dir + '\uninstall.exe') then
  begin
    Result := FmtMessage(CustomMessage('OldIncomplete'), [Product]);
    Exit;
  end;
  if RootKey = HKLM then
    // Only this one-time removal of a Program Files copy needs administrator permission.
    Started := ShellExec('runas', Dir + '\uninstall.exe', '/S', '', SW_HIDE, ewWaitUntilTerminated, ResultCode)
  else
    Started := Exec(Dir + '\uninstall.exe', '/S', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if not Started then
  begin
    if RootKey = HKLM then
      Result := FmtMessage(CustomMessage('OldNeedsAdmin'), [Product])
    else
      Result := FmtMessage(CustomMessage('OldRemoveFailed'), [Product]);
    Exit;
  end;
  // The NSIS uninstaller copies itself to a temporary folder and returns at once, so wait for it.
  for Attempt := 1 to 240 do
  begin
    if not RegValueExists(RootKey, Key, 'UninstallString') and not FileExists(Dir + '\{#AppExe}') then Exit;
    Sleep(500);
  end;
  Result := FmtMessage(CustomMessage('OldRemoveFailed'), [Product]);
end;

function NsisVersion(const Product: String): String;
begin
  if not RegQueryStringValue(HKCU, NsisUninstallRoot + Product, 'DisplayVersion', Result) then
    if not RegQueryStringValue(HKLM, NsisUninstallRoot + Product, 'DisplayVersion', Result) then
      Result := '';
end;

function RemovePreviousInstalls(): String;
var
  Products: array[0..2] of String;
  I: Integer;
begin
  Products[0] := 'O_Compare Rust';
  Products[1] := 'O_Compare';
  Products[2] := '{#AppName}';
  Result := '';
  for I := 0 to 2 do
  begin
    Result := RemoveNsisInstall(HKLM, Products[I]);
    if Result = '' then Result := RemoveNsisInstall(HKCU, Products[I]);
    if Result <> '' then Exit;
  end;
end;

function WebView2Installed(): Boolean;
var
  Version: String;
begin
  Result := (RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
             RegQueryStringValue(HKCU, WebView2Client, 'pv', Version)) and (Version <> '') and (Version <> '0.0.0.0');
end;

// Windows 11 ships WebView2; older Windows 10 machines get Microsoft's bootstrapper.
function EnsureWebView2(): String;
var
  ResultCode: Integer;
begin
  Result := '';
  if WebView2Installed() then Exit;
  try
    DownloadTemporaryFile('https://go.microsoft.com/fwlink/p/?LinkId=2124703', 'MicrosoftEdgeWebview2Setup.exe', '', nil);
    Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  except
  end;
  if not WebView2Installed() then Result := CustomMessage('WebView2Failed');
end;

function InitializeSetup(): Boolean;
var
  Newest: String;
begin
  Result := True;
  InstalledVer := InstalledVersion();
  Newest := InstalledVer;
  if Newest = '' then Newest := NsisVersion('{#AppName}');
  if (Newest <> '') and (CompareVersions(Newest, '{#AppVersion}') > 0) then
  begin
    SuppressibleMsgBox(FmtMessage(CustomMessage('NewerInstalled'), [Newest]), mbInformation, MB_OK, IDOK);
    Result := False;
  end;
end;

procedure CreateModePage();
var
  Info: TNewStaticText;
begin
  ModePage := CreateCustomPage(wpWelcome, CustomMessage('ModeTitle'), FmtMessage(CustomMessage('ModeSubtitle'), [InstalledVer]));
  Info := TNewStaticText.Create(ModePage);
  Info.Parent := ModePage.Surface;
  Info.Width := ModePage.SurfaceWidth;
  Info.WordWrap := True;
  Info.Caption := CustomMessage('ModeInfo');

  UpdateRadio := TNewRadioButton.Create(ModePage);
  UpdateRadio.Parent := ModePage.Surface;
  UpdateRadio.Top := Info.Top + Info.Height + ScaleY(16);
  UpdateRadio.Width := ModePage.SurfaceWidth;
  UpdateRadio.Height := ScaleY(20);
  if CompareVersions(InstalledVer, '{#AppVersion}') = 0 then
    UpdateRadio.Caption := CustomMessage('ModeRepair')
  else
    UpdateRadio.Caption := FmtMessage(CustomMessage('ModeUpdate'), [InstalledVer]);
  UpdateRadio.Checked := True;

  UninstallRadio := TNewRadioButton.Create(ModePage);
  UninstallRadio.Parent := ModePage.Surface;
  UninstallRadio.Top := UpdateRadio.Top + UpdateRadio.Height + ScaleY(8);
  UninstallRadio.Width := ModePage.SurfaceWidth;
  UninstallRadio.Height := ScaleY(20);
  UninstallRadio.Caption := CustomMessage('ModeUninstall');
end;

procedure InitializeWizard();
begin
  if InstalledVer <> '' then CreateModePage();

  // Shown on the Ready page so fresh installs and updates both get the choice.
  WizardForm.ReadyMemo.Height := WizardForm.ReadyMemo.Height - ScaleY(32);
  DesktopCheck := TNewCheckBox.Create(WizardForm);
  DesktopCheck.Parent := WizardForm.ReadyPage;
  DesktopCheck.Left := WizardForm.ReadyMemo.Left;
  DesktopCheck.Top := WizardForm.ReadyMemo.Top + WizardForm.ReadyMemo.Height + ScaleY(12);
  DesktopCheck.Width := WizardForm.ReadyMemo.Width;
  DesktopCheck.Height := ScaleY(20);
  DesktopCheck.Caption := CustomMessage('DesktopShortcut');
  // A former system-wide install put its shortcut on the shared desktop; keep the user's choice.
  DesktopCheck.Checked := FileExists(ExpandConstant('{autodesktop}\{#AppName}.lnk')) or
    FileExists(ExpandConstant('{commondesktop}\{#AppName}.lnk'));

  LaunchCheck := TNewCheckBox.Create(WizardForm);
  LaunchCheck.Parent := WizardForm.FinishedPage;
  LaunchCheck.Height := ScaleY(20);
  LaunchCheck.Caption := CustomMessage('LaunchApp');
  LaunchCheck.Checked := True;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
  begin
    // FinishedLabel is resized when the page is shown, so place the checkbox afterwards.
    LaunchCheck.Left := WizardForm.FinishedLabel.Left;
    LaunchCheck.Top := WizardForm.FinishedLabel.Top + WizardForm.FinishedLabel.Height + ScaleY(16);
    LaunchCheck.Width := WizardForm.FinishedLabel.Width;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  // A silent in-app update has no Finished page, so reopen OCompare here.
  if (CurStep = ssDone) and WizardSilent and HasParam('/UPDATE') then
    if not ExecAsOriginalUser(ExpandConstant('{app}\{#AppExe}'), '', '', SW_SHOW, ewNoWait, ResultCode) then
      Log('relaunch failed: ' + SysErrorMessage(ResultCode));
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Uninstaller: String;
  ResultCode: Integer;
begin
  Result := True;
  if (CurPageID = wpFinished) and LaunchCheck.Checked and not WizardSilent then
    ExecAsOriginalUser(ExpandConstant('{app}\{#AppExe}'), '', '', SW_SHOW, ewNoWait, ResultCode);
  if (ModePage = nil) or (CurPageID <> ModePage.ID) or not UninstallRadio.Checked then Exit;
  Result := False;
  if not RegQueryStringValue(HKCU, UninstallKey, 'UninstallString', Uninstaller) then
    if not RegQueryStringValue(HKLM, UninstallKey, 'UninstallString', Uninstaller) then
    begin
      MsgBox(CustomMessage('UninstallerMissing'), mbError, MB_OK);
      Exit;
    end;
  // The uninstaller asks for confirmation and to close the running app itself.
  if Exec(RemoveQuotes(Uninstaller), '', '', SW_SHOW, ewNoWait, ResultCode) then
  begin
    ClosingForUninstall := True;
    WizardForm.Close;
  end
  else
    MsgBox(FmtMessage(CustomMessage('UninstallerFailed'), [SysErrorMessage(ResultCode)]), mbError, MB_OK);
end;

procedure CancelButtonClick(CurPageID: Integer; var Cancel, Confirm: Boolean);
begin
  if ClosingForUninstall then
  begin
    Cancel := True;
    Confirm := False;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  if not CloseRunningApp() then
  begin
    Result := CustomMessage('StillRunning');
    Exit;
  end;
  Result := EnsureWebView2();
  if Result = '' then Result := RemovePreviousInstalls();
end;

function InitializeUninstall(): Boolean;
begin
  Result := CloseRunningApp();
  if not Result then
    SuppressibleMsgBox(CustomMessage('UninstallCancelled'), mbInformation, MB_OK, IDOK);
end;
