using System;
using System.Collections.Concurrent;               // ConcurrentDictionary — trimmed-usings safety
using System.Collections.Generic;                   // IReadOnlyList<>, HashSet<>, KeyValuePair<>
using System.Globalization;                          // uint.Parse/ToString with InvariantCulture
using System.Threading;                              // CancellationTokenSource
using System.Threading.Tasks;                        // Task/Task.Run/Task.Delay
using Windows.UI.Notifications;                       // UserNotification, NotificationKinds
using Windows.UI.Notifications.Management;            // UserNotificationListener + access status

namespace NudgeWatcher;

// ---------------------------------------------------------------------------
// The RELIABLE toast detector — Windows' official notification-platform API.
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (2026-09-09, the decisive pivot)
//   Three window-based approaches ALL failed to see a Windows 11 toast, proven on
//   the user's machine with screen recordings:
//     1. UIA WindowOpened event          — never fires for toast windows.
//     2. UIA tree poll (RootElement)     — the toast is absent from the tree.
//     3. Win32 EnumWindows               — the toast is absent from the enumeration
//        (a real WhatsApp toast sat on screen for 10+ seconds while ~20 other
//        windows enumerated; the toast never appeared).
//   Windows 11 draws toasts in a protected surface that a normal desktop app cannot
//   find by enumerating windows or walking the accessibility tree. The ONLY
//   supported way to observe them is the notification platform itself:
//   Windows.UI.Notifications.Management.UserNotificationListener. It taps the
//   platform, so it sees every toast regardless of how/where it is rendered, and it
//   can dismiss one via RemoveNotification(id).
//
// PRIVACY (user decision, 2026-09-09 — "API, app-name only")
//   This API is content-capable: a UserNotification exposes the message title/body
//   via n.Notification.Visual. WE DELIBERATELY NEVER READ THAT. We read only:
//     • n.Id                              — an integer handle, needed to dismiss it
//     • n.AppInfo.DisplayInfo.DisplayName — which app notified (metadata, like the
//                                           host-process name the old path emitted)
//   We never touch n.Notification / its Visual bindings, so the message text is
//   never read, logged, or emitted. This keeps ARCHITECTURE.md §7 essentially
//   intact while using the one API that actually works.
//
// GEOMETRY
//   The API reports NO on-screen rectangle. Windows 11 always shows toasts at the
//   bottom-right of the primary display, so we synthesize a target rect in that
//   corner (see CornerBounds) for the pet to walk to. Physical pixels, DPI-correct.
//
// SHAPE
//   Drop-in for the old ToastDetector as far as Program.cs is concerned: same
//   ctor (verbose, discover, log), same Appeared/Closed events, Start/Stop/
//   ScanExisting/CloseToast, IDisposable. Program.cs constructs this now.
//
// THREADING
//   Everything async is plain `await` on the projected WinRT operations (CsWinRT
//   makes them directly awaitable). The loop runs on a thread-pool task; Main is
//   [MTAThread] and thread-pool threads are MTA, which is correct for these APIs.
internal sealed class NotificationListenerDetector : IDisposable
{
    readonly bool _verbose;
    readonly bool _discover;
    readonly Action<string> _log;

    /// <summary>Raised once per newly-observed toast (id + app name + corner rect).</summary>
    public event Action<NotificationInfo>? Appeared;

    /// <summary>Raised when a previously-seen toast is no longer present.</summary>
    public event Action<NotificationInfo>? Closed;

    UserNotificationListener? _listener;
    volatile bool _ready;                 // true once access is granted; gates CloseToast
    CancellationTokenSource? _cts;
    Task? _loop;

    // Toasts we've reported: key = notification id (uint as string), value = app name.
    readonly ConcurrentDictionary<string, string> _tracked = new();
    readonly ConcurrentDictionary<string, ToastGeometry> _reportedGeometry = new();
    readonly ToastGeometryReader _geometryReader = new();

    // Toasts linger for seconds; polling this often notices them promptly without busy-spinning.
    const int PollIntervalMs = 750;

    public NotificationListenerDetector(bool verbose, bool discover, Action<string> log)
    {
        _verbose = verbose;
        _discover = discover;
        _log = log;
    }

    // --- lifecycle -------------------------------------------------------------

    /// <summary>
    /// Grab the listener singleton and start the background loop. Non-blocking: the
    /// loop performs the (async) access request itself, then polls. If access is
    /// denied or the API is unavailable, the loop logs a clear reason and exits,
    /// leaving the app in wander-only (never throws out to Program).
    /// </summary>
    public void Start()
    {
        try
        {
            _listener = UserNotificationListener.Current;
        }
        catch (Exception ex)
        {
            _log($"listener: UserNotificationListener is unavailable on this system: {ex.Message}");
            _log("listener: notifications cannot be observed; the pet will only react to the manual test trigger (Ctrl+Alt+M).");
            return;
        }

        _cts = new CancellationTokenSource();
        _loop = Task.Run(() => RunAsync(_cts.Token));
    }

    /// <summary>Cancel + await the loop (bounded), then forget everything. Idempotent.</summary>
    public void Stop()
    {
        try { _cts?.Cancel(); } catch { /* already gone */ }
        try { _loop?.Wait(TimeSpan.FromMilliseconds(1500)); } catch { /* best effort */ }
        try { _cts?.Dispose(); } catch { /* best effort */ }
        _cts = null;
        _loop = null;
        _ready = false;
        _tracked.Clear();
        _reportedGeometry.Clear();
    }

    public void Dispose() => Stop();

    // --- the loop --------------------------------------------------------------

    async Task RunAsync(CancellationToken ct)
    {
        // 1) Request access. On packaged apps this may prompt the user once; on an
        //    unpackaged helper Windows decides based on its notification-access
        //    setting. Anything other than Allowed means we can't read notifications.
        try
        {
            UserNotificationListenerAccessStatus status = await _listener!.RequestAccessAsync();
            if (status != UserNotificationListenerAccessStatus.Allowed)
            {
                _log($"listener: notification access is '{status}', not 'Allowed'.");
                _log("listener: turn ON Settings > Privacy & security > Notifications (let apps access notifications), then restart. Until then the pet only reacts to the manual test trigger (Ctrl+Alt+M).");
                return;
            }
        }
        catch (Exception ex)
        {
            _log($"listener: RequestAccessAsync failed: {ex.Message}");
            return;
        }

        _ready = true;
        _log("listener: access granted — watching notifications via the Windows notification platform (reading app name + id only; message text is never read).");

        // 1b) SEED the already-open toasts WITHOUT raising Appeared. The Action Center
        //     often holds notifications from before launch; without this the very first
        //     poll below would treat every one of them as brand-new and fire a burst of
        //     reactions the instant the app starts — which is exactly what made the pet
        //     greet the user "angry" on every launch. We only want to react to toasts
        //     that arrive AFTER we begin watching, so pre-existing ones are recorded
        //     silently here (they only ever yield a harmless Closed later if dismissed).
        await SeedExistingAsync();

        // 2) Poll the current toast set and diff it. New id -> Appeared; a tracked id
        //    that's gone -> Closed. Simple, robust, and free of WinRT event/apartment
        //    pitfalls that bite console apps.
        while (!ct.IsCancellationRequested)
        {
            try { await PollOnceAsync(); }
            catch (Exception ex) { if (_verbose) _log($"listener poll: cycle failed: {ex.Message}"); }

            try { await Task.Delay(PollIntervalMs, ct); }
            catch (OperationCanceledException) { break; }
        }
        if (_verbose) _log("listener poll: loop exited.");
    }

    /// <summary>
    /// Record the toasts present RIGHT NOW into <see cref="_tracked"/> without raising
    /// <see cref="Appeared"/>. Called once, immediately before the poll loop, so any
    /// notification already on screen / in the Action Center at launch counts as
    /// "already seen" and never triggers a startup reaction — only toasts that arrive
    /// afterwards do. Best-effort: if it fails, _tracked simply stays empty and the
    /// first poll falls back to the old behavior (treats existing toasts as new), which
    /// is safe, just noisier.
    /// </summary>
    async Task SeedExistingAsync()
    {
        if (_listener is null) return;
        try
        {
            IReadOnlyList<UserNotification> notes =
                await _listener.GetNotificationsAsync(NotificationKinds.Toast);
            foreach (UserNotification n in notes)
            {
                // PRIVACY: app identity + id ONLY — same rule as PollOnceAsync. We never
                // read n.Notification / its Visual bindings (the message title/body).
                string id = n.Id.ToString(CultureInfo.InvariantCulture);
                _tracked[id] = SafeAppName(n);
            }
            if (_verbose)
            {
                _log($"listener: seeded {notes.Count} pre-existing toast(s) at startup — " +
                     "no reaction fired; only notifications arriving from now on will nudge.");
            }
        }
        catch (Exception ex)
        {
            if (_verbose) _log($"listener: seeding pre-existing toasts failed (they'll be treated as new): {ex.Message}");
        }
    }

    async Task PollOnceAsync()
    {
        if (_listener is null) return;

        IReadOnlyList<UserNotification> notes =
            await _listener.GetNotificationsAsync(NotificationKinds.Toast);

        bool needsGeometry = _reportedGeometry.Count > 0 || notes.Any(n =>
            !_tracked.ContainsKey(n.Id.ToString(CultureInfo.InvariantCulture)));
        ToastGeometry? measured = needsGeometry ? await _geometryReader.ReadAsync() : null;
        var currentIds = new HashSet<string>();
        foreach (UserNotification n in notes)
        {
            string id = n.Id.ToString(CultureInfo.InvariantCulture); // n.Id is a uint
            currentIds.Add(id);

            if (_tracked.TryGetValue(id, out string? existingApp))
            {
                // Update only notifications first observed after startup. Keep
                // queue IDs stable while a banner slides or changes height.
                if (measured is not null && _reportedGeometry.TryGetValue(id, out var previous) && measured != previous)
                {
                    _reportedGeometry[id] = measured;
                    Appeared?.Invoke(NotificationInfo.Appeared(id, existingApp, measured.Bounds,
                        interactive: false, hasCloseButton: true, closePoint: measured.ClosePoint));
                }
                continue;
            }

            // PRIVACY: app identity + id ONLY. We never read n.Notification (the
            // Visual bindings holding the title/body). See the file header.
            string appName = SafeAppName(n);
            _tracked[id] = appName;

            ToastGeometry geometry = measured ?? new ToastGeometry(CornerBounds(), null);
            _reportedGeometry[id] = geometry;
            Bounds corner = geometry.Bounds;
            if (_verbose || _discover)
            {
                _log($"listener: notification app={appName} id={id} -> pet target " +
                     $"bounds=({corner.X:0},{corner.Y:0},{corner.Width:0}x{corner.Height:0})");
            }

            // interactive=false: we don't inspect content, so we never treat a toast
            // as "has a reply box" — auto-close scope is "close everything" anyway.
            // hasCloseButton=true: RemoveNotification can always dismiss it.
            Appeared?.Invoke(NotificationInfo.Appeared(id, appName, corner, interactive: false,
                hasCloseButton: true, closePoint: geometry.ClosePoint));
        }

        // Closure: any tracked id no longer present has been dismissed (by the user,
        // a timeout, or our own RemoveNotification).
        foreach (KeyValuePair<string, string> kv in _tracked.ToArray())
        {
            if (currentIds.Contains(kv.Key)) continue;
            if (_tracked.TryRemove(kv.Key, out _))
            {
                _reportedGeometry.TryRemove(kv.Key, out _);
                Closed?.Invoke(NotificationInfo.Closed(kv.Key));
                if (_verbose) _log($"listener: notification id={kv.Key} gone — closed.");
            }
        }
    }

    // --- close (Phase 6 reverse command) --------------------------------------

    /// <summary>
    /// Dismiss a specific toast by the id we reported. Called from the pipe reader
    /// thread when the app auto-closes. RemoveNotification is synchronous and clears
    /// the notification from the system (and its banner). Best-effort + guarded.
    /// </summary>
    public void CloseToast(string id)
    {
        if (!_ready || _listener is null)
        {
            if (_verbose) _log($"listener: close ignored (no notification access): id={id}");
            return;
        }
        if (!uint.TryParse(id, NumberStyles.Integer, CultureInfo.InvariantCulture, out uint nid))
        {
            if (_verbose) _log($"listener: close ignored (unrecognized id): {id}");
            return;
        }
        try
        {
            _listener.RemoveNotification(nid);
            if (_verbose) _log($"listener: removed notification id={id}.");
        }
        catch (Exception ex)
        {
            _log($"warn: RemoveNotification({id}) failed: {ex.Message}");
        }
    }

    // --- one-shot scan (diagnostic; --scan) ------------------------------------

    /// <summary>
    /// List the toast notifications present right now (app name + id only), once,
    /// then return. Blocks on the async calls — fine for a console diagnostic path.
    /// </summary>
    public void ScanExisting()
    {
        try
        {
            _listener = UserNotificationListener.Current;
            UserNotificationListenerAccessStatus status =
                _listener.RequestAccessAsync().AsTask().GetAwaiter().GetResult();
            _log($"listener scan: access={status}");
            if (status != UserNotificationListenerAccessStatus.Allowed) return;

            IReadOnlyList<UserNotification> notes =
                _listener.GetNotificationsAsync(NotificationKinds.Toast).AsTask().GetAwaiter().GetResult();
            _log($"listener scan: {notes.Count} toast notification(s) present.");
            foreach (UserNotification n in notes)
            {
                _log($"listener scan: app={SafeAppName(n)} id={n.Id}");
            }
        }
        catch (Exception ex)
        {
            _log($"listener scan: failed: {ex.Message}");
        }
    }

    // --- helpers ---------------------------------------------------------------

    static string SafeAppName(UserNotification n)
    {
        try
        {
            string? name = n.AppInfo?.DisplayInfo?.DisplayName;
            return string.IsNullOrWhiteSpace(name) ? "app" : name!;
        }
        catch
        {
            // Some notifications have no resolvable AppInfo — that's fine, it's just
            // a label for the pet's reaction, never used for anything sensitive.
            return "app";
        }
    }

    /// <summary>
    /// A synthetic target rect in the bottom-right corner of the primary display,
    /// where Windows 11 shows toasts. The API provides no banner rectangle, so
    /// use it only when live window/button geometry is unavailable. Dimensions and
    /// margins are DIPs, converted to physical pixels to match the pipe schema.
    /// </summary>
    static Bounds CornerBounds()
    {
        Bounds workArea = NativeWindows.PrimaryWorkArea();
        double scale = NativeWindows.PrimaryScaleFactor();
        const int toastW = 360;      // ~standard Win11 toast width
        const int toastH = 170;      // fallback only; prefer the live dismiss button
        const int rightMargin = 24;  // toasts sit a little in from the edge
        const int bottomMargin = 16; // gap above the actual taskbar work-area edge
        double width = toastW * scale;
        double height = toastH * scale;
        double x = Math.Max(workArea.X, workArea.X + workArea.Width - width - rightMargin * scale);
        double y = Math.Max(workArea.Y, workArea.Y + workArea.Height - height - bottomMargin * scale);
        return new Bounds(x, y, width, height);
    }
}
