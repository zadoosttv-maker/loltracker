' Startet den LoL Rank Tracker unsichtbar im Hintergrund
' (funktioniert aus jedem Ordner heraus)
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "node.exe server.js", 0, False
