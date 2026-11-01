' Starts Da Vinci Scanner without a console window.
' Double-click to open the app. "/tray" starts it quietly in the tray (used for Windows start-up).
Option Explicit
Dim fso, shell, dir, extra, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
extra = ""
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "/tray" Then extra = " -NoWindow"
End If
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File """ & dir & "\app\launcher.ps1""" & extra
shell.Run cmd, 0, False
