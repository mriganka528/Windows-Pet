using System.ComponentModel;
using System.Runtime.InteropServices;

namespace NudgeWatcher;

/// <summary>Read-only diagnostics for verifying the installed overlay's real OS layer.</summary>
internal sealed record WindowLayerInfo(uint ProcessId, bool UiAccess, uint? WindowBand)
{
    [DllImport("user32.dll", SetLastError = true)]
    static extern uint GetWindowThreadProcessId(nint window, out uint processId);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetWindowBand(nint window, out uint band);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern nint OpenProcess(uint access, bool inheritHandle, uint processId);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool OpenProcessToken(nint process, uint access, out nint token);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetTokenInformation(nint token, int infoClass, out uint value, int length, out int returned);
    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool CloseHandle(nint handle);

    public static WindowLayerInfo Read(nint window)
    {
        if (GetWindowThreadProcessId(window, out uint processId) == 0) throw new Win32Exception();
        nint process = OpenProcess(0x1000, false, processId); // QUERY_LIMITED_INFORMATION
        if (process == 0) throw new Win32Exception();
        try
        {
            if (!OpenProcessToken(process, 0x0008, out nint token)) throw new Win32Exception();
            try
            {
                if (!GetTokenInformation(token, 26, out uint uiAccess, sizeof(uint), out _))
                    throw new Win32Exception();
                uint? band = null;
                // The band query is diagnostic only; never use SetWindowBand,
                // token impersonation, or changes to Windows security policy.
                try { if (GetWindowBand(window, out uint value)) band = value; }
                catch (EntryPointNotFoundException) { }
                return new WindowLayerInfo(processId, uiAccess != 0, band);
            }
            finally { CloseHandle(token); }
        }
        finally { CloseHandle(process); }
    }
}
