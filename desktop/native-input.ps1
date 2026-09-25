$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
public static class OpenInputNative {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  public static void Click() {
    mouse_event(0x0002,0,0,0,UIntPtr.Zero);
    mouse_event(0x0004,0,0,0,UIntPtr.Zero);
  }
  public static void Wheel(int delta) { mouse_event(0x0800,0,0,unchecked((uint)delta),UIntPtr.Zero); }
  public static void WatchKeyboard() {
    Task.Run(() => {
      bool[] down = new bool[256];
      while (true) {
        bool pressed = false;
        bool ctrl = (GetAsyncKeyState(0x11) & 0x8000) != 0;
        bool shift = (GetAsyncKeyState(0x10) & 0x8000) != 0;
        bool alt = (GetAsyncKeyState(0x12) & 0x8000) != 0;
        for (int key = 8; key <= 254; key++) {
          bool held = (GetAsyncKeyState(key) & 0x8000) != 0;
          bool shortcut = (ctrl && shift && (key == 0x20 || key == 0x4F)) || (ctrl && alt && key == 0x4F);
          if (held && !down[key] && key != 0x10 && key != 0x11 && key != 0x12 && !shortcut) pressed = true;
          down[key] = held;
        }
        if (pressed) Console.WriteLine("OPENINPUT_KEYBOARD");
        Thread.Sleep(35);
      }
    });
  }
}
'@
[void][OpenInputNative]::SetProcessDPIAware()
[OpenInputNative]::WatchKeyboard()
Write-Output 'OPENINPUT_READY'
while ($true) {
  $line = [Console]::ReadLine()
  if ($null -eq $line) { break }
  try {
    $message = $line | ConvertFrom-Json
    if ($message.type -eq 'move') {
      $left = [OpenInputNative]::GetSystemMetrics(76)
      $top = [OpenInputNative]::GetSystemMetrics(77)
      $width = [OpenInputNative]::GetSystemMetrics(78)
      $height = [OpenInputNative]::GetSystemMetrics(79)
      $x = $left + [int]([double]$message.x * ($width - 1))
      $y = $top + [int]([double]$message.y * ($height - 1))
      [void][OpenInputNative]::SetCursorPos($x, $y)
    } elseif ($message.type -eq 'click') {
      [OpenInputNative]::Click()
    } elseif ($message.type -eq 'wheel') {
      [OpenInputNative]::Wheel([int]$message.delta)
    }
  } catch { [Console]::Error.WriteLine($_.Exception.Message) }
}
