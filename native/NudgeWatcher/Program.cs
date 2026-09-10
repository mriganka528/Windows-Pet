namespace NudgeWatcher;

// ---------------------------------------------------------------------------
// Entry point + tiny CLI.
// ---------------------------------------------------------------------------
// Two modes:
//   (default)  watch  — observe toasts via the Windows notification platform
//                        (UserNotificationListener) and stream one JSON line per
//                        toast appeared/closed to stdout until Ctrl+C.
//   --scan            — list the toast notifications present right now once (app
//                        name + id only), then exit. Handy sanity check that
//                        notification access is granted.
//
// Flags:
//   -v, --verbose     — chatty diagnostics on stderr.
//   --discover        — log each observed notification (app name + id + target
//                        corner). Metadata only; the message text is never read.
//   --pipe <name>     — also stream the JSON protocol over the named pipe
//                        \\.\pipe\<name> (Phase 5). Electron passes a unique name,
//                        spawns this watcher, then connects as the pipe client.
//                        Ignored in --scan mode.
//   -h, --help, /?    — usage.
//
// STREAMS
//   stdout = machine-readable protocol (newline-delimited JSON). Always written.
//   pipe   = the SAME newline-delimited JSON, when --pipe is given. This is how the
//            Electron app consumes events in Phase 5 (see PipeServer.cs).
//   stderr = human diagnostics/logs. Keeping them on separate streams means a
//            consumer can parse the protocol without tripping over log noise.
//
// THREADING
//   Main is [MTAThread]. The detector's async work runs on thread-pool tasks (also
//   MTA), which is correct for the WinRT notification APIs. (UI Automation client
//   code, still present in the legacy ToastDetector, also wants MTA — so the
//   attribute stays regardless of which detector is active.)

internal static class Program
{
    // UIA event callbacks and the Ctrl+C handler run on different threads, so all
    // stdout writes go through this lock to keep JSON lines from interleaving.
    static readonly object StdoutLock = new();

    [MTAThread]
    static int Main(string[] args)
    {
        // Separate mode: never starts notification detection or requests access.
        if (args.Length == 1 && args[0] == "--audio-meter") return AudioMeter.Run();
        CliOptions opts = CliOptions.Parse(args);
        if (opts.ShowHelp)
        {
            PrintHelp();
            return 0;
        }

        // stderr logger — keeps stdout a pure JSON stream.
        void Log(string msg) => Console.Error.WriteLine($"[nudge-watcher] {msg}");

        string version = typeof(Program).Assembly.GetName().Version?.ToString() ?? "0.0.0";
        Log($"NudgeWatcher {version} starting (mode={(opts.Scan ? "scan" : "watch")}, verbose={opts.Verbose}, discover={opts.Discover}).");
        Log("privacy: notification message text is never read; only the app name + a dismiss id are used.");

        // Detection goes through the Windows notification platform
        // (UserNotificationListener), the ONLY API that reliably observes Windows 11
        // toasts — they are invisible to UI Automation and Win32 window enumeration.
        // We read app name + id only (never the message). See NotificationListenerDetector.cs.
        using var detector = new NotificationListenerDetector(opts.Verbose, opts.Discover, Log);

        // Phase 5 transport: if Electron passed --pipe <name>, also stream each line
        // over that named pipe. `using` on a null is a harmless no-op, so this
        // disposes cleanly on every return path (including scan mode below).
        using PipeServer? pipe =
            (!opts.Scan && !string.IsNullOrWhiteSpace(opts.PipeName))
                ? new PipeServer(opts.PipeName!, opts.Verbose, Log)
                : null;
        if (pipe is not null)
        {
            pipe.Start();
            // Phase 6 reverse channel: when the app sends {"cmd":"close","id":...}
            // over the pipe, dismiss that specific toast. Detection still stands on
            // its own — this only adds the ability to act on what we already found.
            pipe.CloseRequested += id => detector.CloseToast(id);
            Log($@"pipe: serving on \\.\pipe\{opts.PipeName} (client = Electron).");
        }

        // Dual-sink: build the JSON line once, send it to stdout (always) and to
        // the pipe (when enabled). Keeping stdout live is handy for debugging even
        // when Electron is the real consumer.
        void Emit(NotificationInfo n)
        {
            string line = n.ToJsonLine();
            WriteJsonLine(line);
            pipe?.Enqueue(line);
        }

        // Each detected event becomes exactly one JSON line per sink.
        detector.Appeared += Emit;
        detector.Closed += Emit;

        // --- one-shot scan mode -------------------------------------------------
        if (opts.Scan)
        {
            try
            {
                detector.ScanExisting();
                return 0;
            }
            catch (Exception ex)
            {
                Log($"fatal: scan failed: {ex.Message}");
                return 1;
            }
        }

        // --- live watch mode ----------------------------------------------------
        using var stop = new ManualResetEventSlim(false);

        // An installer may terminate the desktop app during an update. Stop
        // when its inherited stdin pipe closes so the helper cannot outlive it
        // or keep installed files locked. Interactive/manual runs are unchanged.
        if (pipe is not null && Console.IsInputRedirected)
        {
            _ = Task.Run(() =>
            {
                try { while (Console.ReadLine() is not null) { } }
                catch (System.IO.IOException) { }
                finally
                {
                    try { stop.Set(); } catch (ObjectDisposedException) { }
                }
            });
        }

        // Ctrl+C: unwind cleanly instead of hard-killing, so we can remove UIA
        // handlers (leaking them can destabilize the UIA service).
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            Log("shutdown requested (Ctrl+C).");
            stop.Set();
        };
        // Also honor a plain process-exit / SIGTERM (e.g. Electron killing the child).
        AppDomain.CurrentDomain.ProcessExit += (_, _) => stop.Set();

        try
        {
            detector.Start();
        }
        catch (Exception ex)
        {
            Log($"fatal: could not start the notification watcher: {ex.Message}");
            return 1;
        }

        stop.Wait();          // block here until Ctrl+C / exit
        detector.Stop();
        Log("stopped.");
        return 0;
    }

    /// <summary>Write one protocol line to stdout (thread-safe, flushed).</summary>
    static void WriteJsonLine(string line)
    {
        lock (StdoutLock)
        {
            Console.Out.WriteLine(line);
            Console.Out.Flush(); // push promptly so a pipe consumer sees it live
        }
    }

    static void PrintHelp()
    {
        // Help is user-facing, so stdout is fine here.
        Console.WriteLine(
"""
NudgeWatcher — Windows toast-notification watcher

USAGE
  NudgeWatcher [--scan] [--discover] [--verbose|-v] [--pipe <name>] [--help|-h]

HOW IT WORKS
  Detection goes through the Windows notification platform itself
  (Windows.UI.Notifications.Management.UserNotificationListener) — the only API
  that reliably observes Windows 11 toasts. They are drawn in a protected surface
  that is invisible to UI Automation and to Win32 window enumeration, so those
  window-based approaches were abandoned. Requires notification access to be ON
  (Settings > Privacy & security > Notifications).

MODES
  (no args)        Watch continuously. Emits one JSON line to stdout each time a
                   toast appears or is dismissed. Runs until Ctrl+C.
  --scan           List the toast notifications present right now once (app name
                   + id only), then exit. Quick check that access is granted.
  --audio-meter    Read the default playback device's peak level at 50 Hz.
                   No screen/audio capture. Send "stop" on stdin (or close stdin)
                   to stop. Emits {"type":"audio-level","level":0..1,"available":true|false}.

OPTIONS
  -v, --verbose    Verbose diagnostics on stderr.
  --discover       Log each observed notification (app name + id + the corner rect
                   the pet is aimed at). Metadata only. (`--trace` is an alias.)
  --pipe <name>    Also stream the JSON protocol over \\.\pipe\<name>. Electron
                   sets this and connects as the pipe client (Phase 5). The
                   `--pipe=<name>` form is also accepted. Ignored with --scan.
                   The pipe is duplex: the client may send {"cmd":"close","id":..}
                   back to dismiss a specific toast (Phase 6).
  -h, --help       Show this help.

OUTPUT (stdout, newline-delimited JSON)
  {"type":"notification_appeared","id":"<number>","appId":"<app display name>",
   "bounds":{"X":..,"Y":..,"Width":..,"Height":..},"interactive":false,
   "hasCloseButton":true,"ts":"<iso-8601>"}
  {"type":"notification_closed","id":"<number>","ts":"<iso-8601>"}

PRIVACY
  Notification title/body text is NEVER read or emitted. `appId` is the notifying
  app's display name (metadata) and `id` is an opaque dismiss handle — nothing more.
""");
    }
}

// ---------------------------------------------------------------------------
// Minimal, dependency-free CLI parsing.
// ---------------------------------------------------------------------------
internal sealed class CliOptions
{
    public bool Scan { get; private set; }
    public bool Verbose { get; private set; }
    public bool ShowHelp { get; private set; }
    /// <summary>Log each observed notification's app name + id + target corner rect
    /// (--discover / --trace). Metadata only; the message text is never read.</summary>
    public bool Discover { get; private set; }
    /// <summary>Named-pipe name from --pipe (without the \\.\pipe\ prefix), or null.</summary>
    public string? PipeName { get; private set; }

    public static CliOptions Parse(string[] args)
    {
        var o = new CliOptions();
        for (int i = 0; i < args.Length; i++)
        {
            string arg = args[i].Trim();
            string lower = arg.ToLowerInvariant();

            // --pipe=<name> (single token) — split before the lowercased switch check
            // so we preserve the pipe name's original casing.
            if (lower.StartsWith("--pipe=", StringComparison.Ordinal))
            {
                o.PipeName = arg.Substring("--pipe=".Length);
                continue;
            }

            switch (lower)
            {
                case "--scan":
                    o.Scan = true;
                    break;
                case "--discover":
                case "--trace":
                    o.Discover = true;
                    break;
                case "--verbose":
                case "-v":
                    o.Verbose = true;
                    break;
                case "--pipe":
                    // Two-token form: consume the following argument as the name.
                    if (i + 1 < args.Length)
                    {
                        o.PipeName = args[++i];
                    }
                    else
                    {
                        Console.Error.WriteLine("[nudge-watcher] --pipe requires a name; ignoring.");
                    }
                    break;
                case "--help":
                case "-h":
                case "/?":
                    o.ShowHelp = true;
                    break;
                default:
                    Console.Error.WriteLine($"[nudge-watcher] ignoring unknown argument: {arg}");
                    break;
            }
        }
        return o;
    }
}
