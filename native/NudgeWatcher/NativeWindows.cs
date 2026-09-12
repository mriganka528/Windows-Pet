using System.Collections.Generic;      // List<> — this UseWPF SDK trims the implicit
                                       // usings set (System.IO was confirmed missing),
                                       // so import the generic collections explicitly.
using System.Runtime.InteropServices;  // DllImport / P-Invoke into user32 + dwmapi
using System.Text;                     // StringBuilder for GetClassName

namespace NudgeWatcher;

// ---------------------------------------------------------------------------
// Win32 top-level window enumeration (user32 EnumWindows) — the reliable way to
// SEE a Windows 11 toast.
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (Phase 6 follow-up, 2026-09-09)
//   We first tried to detect toasts through UI Automation: the WindowOpened event,
//   then active polling of AutomationElement.RootElement.FindAll(children). BOTH
//   were proven blind to toasts on the user's Windows 11 machine — a real WhatsApp
//   toast was plainly on screen, yet every UIA enumeration listed every OTHER
//   top-level window (VS Code, Brave, the taskbar, even WhatsApp's hidden main
//   window) and never the toast itself. Modern UWP/WinUI notification surfaces are
//   "cloaked"/virtualized out of the UIA desktop tree, so UIA simply cannot see
//   them from the root.
//
//   But a toast is still an ordinary top-level Win32 window (HWND) — it has to be,
//   to host its reply box and buttons. The classic user32 EnumWindows API returns
//   those HWNDs regardless of UIA cloaking. So we enumerate at the Win32 level here,
//   then (in ToastDetector) bridge the ONE toast HWND we care about back into UIA
//   with AutomationElement.FromHandle — which works on any valid HWND no matter
//   where it sits in the automation tree — to classify it and find its close button.
//
// PRIVACY (ARCHITECTURE.md §7)
//   We read only window METADATA here: class name, owning process id, and the
//   window rectangle. We never call GetWindowText / read a title, and never touch
//   notification body text. Geometry + class + host process only.
//
// DPI
//   app.manifest declares Per-Monitor-V2 DPI awareness, so GetWindowRect returns
//   real PHYSICAL screen pixels — the same space the Electron overlay maps from.
internal static class NativeWindows
{
    /// <summary>
    /// One visible top-level window: its HWND plus the cheap metadata we gate on.
    /// Coordinates are physical screen pixels (see DPI note above).
    /// </summary>
    internal readonly record struct TopWindow(
        nint Hwnd, string ClassName, int ProcessId, int X, int Y, int Width, int Height);

    // --- user32 / dwmapi imports ---------------------------------------------
    // The callback user32 invokes once per top-level window. Return true to keep
    // enumerating, false to stop. We always return true (we want them all).
    private delegate bool EnumWindowsProc(nint hWnd, nint lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, nint lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern nint FindWindowEx(nint parent, nint after, string className, string? title);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(nint hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(nint hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(nint hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(nint hWnd);

    // Primary-monitor size in PHYSICAL pixels (app.manifest declares Per-Monitor-V2
    // DPI awareness, so these are real device pixels, not scaled). Used to aim the
    // pet at the bottom-right corner where Windows 11 shows toasts — the notification
    // platform API (UserNotificationListener) reports no on-screen geometry, so we
    // derive the target from where toasts always appear.
    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    private const int SM_CXSCREEN = 0; // primary monitor width
    private const int SM_CYSCREEN = 1; // primary monitor height

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SystemParametersInfo(uint action, uint param, out RECT rect, uint flags);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForSystem();

    [DllImport("user32.dll")]
    private static extern nint MonitorFromPoint(POINT point, uint flags);

    [DllImport("shcore.dll")]
    private static extern int GetDpiForMonitor(nint monitor, int dpiType, out uint dpiX, out uint dpiY);

    // DWM "cloaked" attribute: UWP/WinUI windows are often present-but-hidden
    // (composed off-screen). A live, shown toast is NOT cloaked; its dormant host
    // windows ARE — checking this drops most of the invisible noise.
    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(nint hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

    private const int DWMWA_CLOAKED = 14;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    /// <summary>
    /// Enumerate every top-level window that is actually shown to the user right now
    /// (visible, not DWM-cloaked, with a real non-empty on-screen rectangle) and
    /// return light metadata for each. Never throws: a failure enumerating or reading
    /// any single window is swallowed, and a total failure yields an empty list, so
    /// a bad cycle degrades to "found nothing" rather than taking the watcher down.
    /// </summary>
    internal static List<TopWindow> EnumerateVisibleTopWindows()
    {
        var result = new List<TopWindow>();

        // NOTE: EnumWindows is synchronous — it returns only after the callback has
        // run for every window — so the delegate we pass stays alive for the whole
        // call and cannot be collected mid-enumeration.
        try
        {
            EnumWindows(
                (hwnd, _) =>
                {
                    try
                    {
                        if (!IsWindowVisible(hwnd)) return true;         // hidden — skip, keep going
                        if (IsCloaked(hwnd)) return true;                // composed-away UWP — skip
                        if (!GetWindowRect(hwnd, out RECT r)) return true;

                        int w = r.Right - r.Left;
                        int h = r.Bottom - r.Top;
                        if (w <= 0 || h <= 0) return true;               // zero-area — skip

                        string cls = ClassOf(hwnd);
                        GetWindowThreadProcessId(hwnd, out uint pid);
                        result.Add(new TopWindow(hwnd, cls, (int)pid, r.Left, r.Top, w, h));
                    }
                    catch
                    {
                        // Reading this one window failed (it may have vanished mid-
                        // enumeration). Ignore it and keep enumerating the rest.
                    }

                    return true; // always continue to the next window
                },
                nint.Zero);
        }
        catch
        {
            // Enumeration itself failed — return whatever we managed to collect.
        }

        return result;
    }

    /// <summary>
    /// Find shell surfaces directly by class. On Windows 8+ EnumWindows omits
    /// some immersive windows; an empty EnumWindows result is not proof that a
    /// toast has no HWND. No window titles or notification content are read.
    /// </summary>
    internal static List<TopWindow> FindToastWindows()
    {
        var windows = new List<TopWindow>();
        foreach (string className in ToastHeuristics.CandidateWindowClasses)
        {
            nint previous = 0;
            for (int index = 0; index < 64; index++)
            {
                nint hwnd = FindWindowEx(0, previous, className, null);
                if (hwnd == 0 || hwnd == previous) break;
                previous = hwnd;
                try
                {
                    if (!IsWindowVisible(hwnd) || IsCloaked(hwnd) || !GetWindowRect(hwnd, out RECT r)) continue;
                    GetWindowThreadProcessId(hwnd, out uint pid);
                    using var process = System.Diagnostics.Process.GetProcessById((int)pid);
                    if (!ToastHeuristics.IsToastHostProcess(process.ProcessName)) continue;
                    windows.Add(new TopWindow(hwnd, className, (int)pid, r.Left, r.Top,
                        r.Right - r.Left, r.Bottom - r.Top));
                }
                catch { /* The shell may destroy the banner while we inspect it. */ }
            }
        }
        return windows;
    }

    private static bool IsCloaked(nint hwnd)
    {
        try
        {
            if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out int cloaked, sizeof(int)) == 0)
                return cloaked != 0;
        }
        catch
        {
            // dwmapi unavailable or the call failed — treat the window as not cloaked
            // so we err toward SEEING windows (a missed toast is worse than noise).
        }
        return false;
    }

    private static string ClassOf(nint hwnd)
    {
        var sb = new StringBuilder(256);
        int n = GetClassName(hwnd, sb, sb.Capacity);
        return n > 0 ? sb.ToString() : string.Empty;
    }

    /// <summary>
    /// Primary-monitor size in physical pixels, e.g. (1920, 1080). Returns a safe
    /// 1920x1080 fallback if the call fails so callers always get a usable rect.
    /// </summary>
    internal static (int Width, int Height) PrimaryScreenSize()
    {
        try
        {
            int w = GetSystemMetrics(SM_CXSCREEN);
            int h = GetSystemMetrics(SM_CYSCREEN);
            if (w > 0 && h > 0) return (w, h);
        }
        catch
        {
            // fall through to the default below
        }
        return (1920, 1080);
    }

    /// <summary>Primary usable desktop in physical pixels, excluding the taskbar.</summary>
    internal static Bounds PrimaryWorkArea()
    {
        const uint SPI_GETWORKAREA = 0x0030;
        if (SystemParametersInfo(SPI_GETWORKAREA, 0, out RECT rect, 0))
            return new Bounds(rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top);
        (int width, int height) = PrimaryScreenSize();
        return new Bounds(0, 0, width, height);
    }

    internal static double PrimaryScaleFactor()
    {
        // The primary monitor contains (0, 0). Read its current effective DPI;
        // system DPI alone can be stale after changing the primary display.
        const uint MONITOR_DEFAULTTOPRIMARY = 1;
        const int MDT_EFFECTIVE_DPI = 0;
        nint monitor = MonitorFromPoint(new POINT(), MONITOR_DEFAULTTOPRIMARY);
        if (GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, out uint dpi, out _) == 0 && dpi > 0)
            return dpi / 96.0;
        return Math.Max(96u, GetDpiForSystem()) / 96.0;
    }
}
