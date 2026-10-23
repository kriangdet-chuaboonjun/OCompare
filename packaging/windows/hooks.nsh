; The former product name has different NSIS registry keys. Remove installations
; registered under those keys while keeping the app data and replacing the old files.
!macro MIGRATE_LEGACY_PRODUCT LEGACY_PRODUCT_NAME
  Push $0
  Push $1
  Push $2
  Push $3
  ; System-wide installations run their uninstaller elevated by the installer.
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LEGACY_PRODUCT_NAME}" "UninstallString"
  ${If} $0 != ""
    ReadRegStr $1 HKLM "Software\co\${LEGACY_PRODUCT_NAME}" ""
    ReadRegStr $2 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LEGACY_PRODUCT_NAME}" "DisplayVersion"
    nsis_tauri_utils::SemverCompare "${VERSION}" $2
    Pop $3
    ${If} $3 = -1
      MessageBox MB_OK|MB_ICONSTOP "A newer ${LEGACY_PRODUCT_NAME} version is installed. Use the latest installer." /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
    ; Only accept the standard Tauri uninstall command, never arbitrary registry arguments.
    ${If} $1 == ""
    ${OrIf} $0 != '$\"$1\uninstall.exe$\"'
    ${OrIfNot} ${FileExists} "$1\uninstall.exe"
      MessageBox MB_OK|MB_ICONSTOP "The previous installation is incomplete. Please uninstall it from Windows Settings before continuing." /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
    DetailPrint "Removing the previous system-wide installation ($2); keeping application data."
    ExecWait '$0 /UPDATE _?=$1' $3
    ${If} $3 != 0
      MessageBox MB_OK|MB_ICONSTOP "Unable to remove the previous system-wide installation. Please uninstall it from Windows Settings and try again." /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
    ${If} ${FileExists} "$1\${MAINBINARYNAME}.exe"
      MessageBox MB_OK|MB_ICONSTOP "The previous system-wide version is still installed. Close the app and uninstall it before trying again." /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
  ${EndIf}
  ; Older per-user installations belong to the current Windows user.
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LEGACY_PRODUCT_NAME}" "UninstallString"
  ${If} $0 != ""
    ReadRegStr $1 HKCU "Software\co\${LEGACY_PRODUCT_NAME}" ""
    ReadRegStr $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LEGACY_PRODUCT_NAME}" "DisplayVersion"
    nsis_tauri_utils::SemverCompare "${VERSION}" $2
    Pop $3
    ${If} $3 = -1
      MessageBox MB_OK|MB_ICONSTOP "A newer per-user ${LEGACY_PRODUCT_NAME} version is installed. Use the latest installer." /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
    ${If} $1 == ""
    ${OrIf} $0 != '$\"$1\uninstall.exe$\"'
    ${OrIfNot} ${FileExists} "$1\uninstall.exe"
      MessageBox MB_OK|MB_ICONSTOP "The previous per-user installation is incomplete. Please uninstall it from Windows Settings and try again." /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
    DetailPrint "Removing the previous per-user installation ($2); keeping application data."
    nsis_tauri_utils::RunAsUser "$1\uninstall.exe" "/S"
    Pop $0
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "Unable to start the previous uninstaller. Please uninstall the old version and try again." /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
    StrCpy $3 0
    ${Do}
      Sleep 500
      ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LEGACY_PRODUCT_NAME}" "UninstallString"
      ${If} $0 == ""
      ${AndIfNot} ${FileExists} "$1\${MAINBINARYNAME}.exe"
        ${ExitDo}
      ${EndIf}
      IntOp $3 $3 + 1
      ${If} $3 >= 240
        MessageBox MB_OK|MB_ICONSTOP "The previous version could not be removed. Close ${LEGACY_PRODUCT_NAME}, uninstall the old version, and try again." /SD IDOK
        SetErrorLevel 1
        Abort
      ${EndIf}
    ${Loop}
  ${EndIf}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro MIGRATE_LEGACY_PRODUCT "O_Compare Rust"
  !insertmacro MIGRATE_LEGACY_PRODUCT "O_Compare"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -File "$INSTDIR\resources\explorer\register.ps1" -InstallDirectory "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Explorer registration requires a signed, trusted package. See resources\explorer\README.md."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -File "$INSTDIR\resources\explorer\unregister.ps1" -InstallDirectory "$INSTDIR"'
  Pop $0
!macroend
