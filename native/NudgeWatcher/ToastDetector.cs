using System.Collections.Concurrent;
using System.Collections.Generic;     // HashSet<>/KeyValuePair<> — same trimmed-usings
                                      // reason as below (this UseWPF SDK omits several
                                      // base implicit usings; System.IO was confirmed missing).
using System.Diagnostics;
using System.Threading;               // CancellationTokenSource — the WPF implicit-usings
                                      // set is trimmed, so import threading explicitly.
using System.Threading.Tasks;         // Task/Task.Run/Task.Delay — import explicitly too,
                                      // don't rely on the trimmed implicit set.
using System.Windows.Automation;

namespace NudgeWatcher;

// ---------------------------------------------------------------------------
// The UI Automation watcher.
// ---------------------------------------------------------------------------
// WHAT IT DOES
//   Subscribes to the OS-wide "a window opened" UIA event, and for each opened
//   window that looks like a toast (class pre-filter + known host process), reads
//   its bounding rectangle and walks its element subtree to decide whether it's
//   "interactive" and whether it has a dismiss button. It raises `Appeared`. When
//   a tracked toast's window closes, it raises `Closed`.
//
// A FEW UIA CONCEPTS (for anyone new to it)
//   • AutomationElement — a node in the OS-wide UI tree (a window, a button, …).
//     RootElement is the desktop; every app's UI hangs beneath it.
//   • Events — Automation.AddAutomationEventHandler lets us react to things like
//     WindowOpened/WindowClosed anywhere under a scope (here: the whole desktop).
//   • CacheRequest — reading each property live is a slow cross-process call. A
//     CacheRequest says "when you hand me this element, pre-load these properties
//     (and, with a TreeScope, its descendants) in ONE round-trip." We then read
//     `element.Cached.X` with no further calls. This is the key to being cheap.
//   • ElementNotAvailableException — the element vanished (super common with
//     toasts, which are short-lived). We swallow these as normal.
//
// IMPORTANT THREADING RULE
//   UIA event callbacks arrive on a UIA-internal thread, and the docs warn NOT to
//   make UIA calls from *inside* a callback (re-entrancy can deadlock). So the
//   WindowOpened handler does only a trivial class check, then hands the heavy
//   inspection to a Task on the thread pool.
//
// PRIVACY
//   We never emit the notification's text. We read some control *labels* (e.g. a
//   button named "Reply") only to classify interactivity — those are UI
//   affordances, not the message — and they never leave this process.

public sealed class ToastDetector : IDisposable
{
    readonly bool _verbose;
    // DISCOVERY diagnostic (--discover): log EVERY opened window's class + host +
    // bounds, bypassing the candidate-class/host gates. This is the tool for
    // learning what class/host YOUR Windows build uses for toasts so ToastHeuristics
    // can be tuned. It is privacy-safe: we log only window metadata (class name,
    // host process name, geometry) — never any control Name / notification text.
    readonly bool _discover;
    readonly Action<string> _log; // writes to stderr (keeps stdout pure JSON)

    // runtimeId (as a string key) -> our assigned notification id.
    readonly ConcurrentDictionary<string, string> _tracked = new();

    // our notification id -> the live toast window element, so a later
    // "close this one" command (Phase 6) can re-find the window and its dismiss
    // button. We keep the element handle only; we still re-read it LIVE at close
    // time (see CloseToastCore) so a stale/expired toast is detected and skipped.
    readonly ConcurrentDictionary<string, AutomationElement> _windowsById = new();

    CacheRequest _openCache = null!;   // light: just the opened window element
    CacheRequest _detailCache = null!; // heavy: the toast + its whole subtree
    bool _started;

    // --- polling detection (Win32 enumeration — the only path that sees toasts) --
    // Detecting toasts through UI Automation FAILED twice on Windows 11: (1) the
    // WindowOpened event never fires for the toast window; (2) actively polling
    // AutomationElement.RootElement.FindAll(children) never lists the toast either —
    // it enumerates every OTHER top-level window but the toast is cloaked out of the
    // UIA desktop tree (confirmed from a user's screen recording: the toast was on
    // screen, absent from every UIA enumeration). A toast is still a real Win32 HWND,
    // so we enumerate at the Win32 level (NativeWindows.EnumerateVisibleTopWindows,
    // via user32 EnumWindows) every PollIntervalMs, gate by the same class/host
    // heuristics, and bridge the matched HWND back into UIA (AutomationElement.
    // FromHandle) only to classify it and close it. `_tracked` de-dupes so a toast is
    // reported once. The old UIA event handlers below are retained for reference but
    // are no longer subscribed (see Start()).
    const int PollIntervalMs = 750;    // toasts linger seconds; this catches them fast
    CancellationTokenSource? _pollCts;
    Task? _pollLoop;

    public event Action<NotificationInfo>? Appeared;
    public event Action<NotificationInfo>? Closed;

    public ToastDetector(bool verbose, bool discover, Action<string> log)
    {
        _verbose = verbose;
        _discover = discover;
        _log = log;
        BuildCaches();
    }

    void BuildCaches()
    {
        // Element-only: what we need to CHEAPLY decide "is this a toast?" for every
        // window that opens anywhere on the desktop.
        _openCache = new CacheRequest { TreeScope = TreeScope.Element };
        _openCache.Add(AutomationElement.ClassNameProperty);
        _openCache.Add(AutomationElement.ProcessIdProperty);
        _openCache.Add(AutomationElement.NativeWindowHandleProperty);
        _openCache.Add(AutomationElement.BoundingRectangleProperty);
        _openCache.Add(AutomationElement.IsOffscreenProperty);
        _openCache.Add(AutomationElement.RuntimeIdProperty);

        // Subtree: everything we need to classify a confirmed toast in one fetch.
        _detailCache = new CacheRequest { TreeScope = TreeScope.Subtree };
        _detailCache.Add(AutomationElement.ControlTypeProperty);
        _detailCache.Add(AutomationElement.AutomationIdProperty);
        _detailCache.Add(AutomationElement.NameProperty);
        _detailCache.Add(AutomationElement.BoundingRectangleProperty);
        _detailCache.Add(AutomationElement.IsOffscreenProperty);
        _detailCache.Add(AutomationElement.ClassNameProperty);
        _detailCache.Add(AutomationElement.ProcessIdProperty);
    }

    /// <summary>Begin watching for toasts (live mode). Non-blocking.</summary>
    public void Start()
    {
        if (_started) return;
        _started = true;

        // We deliberately DO NOT subscribe to the UIA WindowOpened/WindowClosed events
        // for detection: both were proven blind to Windows 11 toasts (the event never
        // fires for the toast window, and the toast is cloaked out of the UIA tree). All
        // detection happens by Win32 enumeration in the poll loop below. The OnWindowOpened
        // / OnWindowClosed handlers are kept only for reference/history.
        _log("Watching for toast notifications… (press Ctrl+C to stop)");
        if (_discover)
            _log("discover mode ON: logging EVERY visible top-level window (class/host/bounds) " +
                 "via Win32 enumeration. Trigger a notification and look for the line whose " +
                 "bounds sit in a screen corner.");

        // The Win32 polling detector is the sole detection path (see field notes above).
        _pollCts = new CancellationTokenSource();
        _pollLoop = Task.Run(() => PollLoopAsync(_pollCts.Token));
    }

    /// <summary>Stop watching and drop all subscriptions.</summary>
    public void Stop()
    {
        if (!_started) return;
        _started = false;

        // Stop the poll loop first (best-effort; it observes cancellation between cycles).
        try { _pollCts?.Cancel(); } catch { /* already gone */ }
        try { _pollLoop?.Wait(TimeSpan.FromMilliseconds(1500)); } catch { /* best effort */ }
        try { _pollCts?.Dispose(); } catch { /* best effort */ }
        _pollCts = null;
        _pollLoop = null;

        try { Automation.RemoveAllEventHandlers(); }
        catch (Exception ex) { _log($"warn: RemoveAllEventHandlers failed: {ex.Message}"); }
        _tracked.Clear();
        _windowsById.Clear(); // release the tracked window handles
    }

    // --- live event handlers -------------------------------------------------

    void OnWindowOpened(object? sender, AutomationEventArgs e)
    {
        if (sender is not AutomationElement el) return;
        string? className = null;
        try { className = el.Cached.ClassName; }
        catch { /* couldn't read the class — leave null; discover still logs the host */ }

        // DISCOVERY: log this window regardless of whether it passes the toast gates,
        // so an unrecognized toast class/host is actually visible (that is the whole
        // point of --discover). Offloaded so the callback stays cheap (threading rule).
        if (_discover) Task.Run(() => LogOpenedWindow(el, className));

        // Normal detection path: cheap class pre-filter, then hand off the heavy
        // inspection to the thread pool. A null/unknown class is not a toast we know
        // how to read, so we stop here (discover above already surfaced it).
        if (className is null) return;
        if (!ToastHeuristics.IsCandidateWindowClass(className)) return;

        Task.Run(() => HandleCandidate(el, className));
    }

    /// <summary>
    /// DISCOVERY diagnostic (--discover): print one line describing an opened window
    /// — its class, host process, geometry, and whether it currently passes the
    /// candidate-class / known-host gates. Use this to find the class + host YOUR
    /// Windows build uses for toasts, then add them to ToastHeuristics.cs.
    /// PRIVACY: metadata only (class/host/bounds). We never read a control Name or
    /// any notification text here (ARCHITECTURE.md §7).
    /// </summary>
    void LogOpenedWindow(AutomationElement el, string? className)
    {
        try
        {
            int pid = SafeProcessId(el);
            string? proc = ProcessName(pid);
            bool candidateClass = ToastHeuristics.IsCandidateWindowClass(className);
            bool knownHost = ToastHeuristics.IsToastHostProcess(proc);

            // Read bounds directly (don't reuse SafeBounds — it suppresses offscreen
            // windows, but for discovery we want to see everything, including its
            // position, so a corner-anchored toast is recognizable by geometry).
            string bounds;
            try
            {
                System.Windows.Rect r = el.Cached.BoundingRectangle;
                bool off = false;
                try { off = el.Cached.IsOffscreen; } catch { /* ignore */ }
                bounds = r.IsEmpty
                    ? "(empty)"
                    : $"({r.X:0},{r.Y:0},{r.Width:0}x{r.Height:0}){(off ? " offscreen" : "")}";
            }
            catch { bounds = "(no bounds)"; }

            _log($"discover: class={className ?? "?"} host={proc ?? "?"} " +
                 $"bounds={bounds} candidateClass={candidateClass} knownHost={knownHost}");
        }
        catch (Exception ex)
        {
            _log($"discover: read failed: {ex.Message}");
        }
    }

    void OnWindowClosed(object? sender, AutomationEventArgs e)
    {
        try
        {
            if (e is not WindowClosedEventArgs wc) return;
            // The element is already gone; match by its runtime id (carried on the
            // event args) against what we recorded when it appeared.
            string key = KeyFromRuntimeId(wc.GetRuntimeId());
            if (key.Length == 0) return;
            if (_tracked.TryRemove(key, out string? id) && !string.IsNullOrEmpty(id))
            {
                _windowsById.TryRemove(id!, out _); // drop the (now-dead) window handle
                Closed?.Invoke(NotificationInfo.Closed(id));
            }
        }
        catch (Exception ex)
        {
            _log($"warn: handling closed window failed: {ex.Message}");
        }
    }

    void HandleCandidate(AutomationElement el, string? className)
    {
        try
        {
            int pid = SafeProcessId(el);
            string? proc = ProcessName(pid);

            // Confirming signal: the CoreWindow class is shared widely, so only
            // treat known toast HOSTS as real toasts.
            if (!ToastHeuristics.IsToastHostProcess(proc))
            {
                if (_verbose) _log($"skip: class={className} host={proc ?? "?"} (not a known toast host)");
                return;
            }

            // De-dupe: WindowOpened can fire more than once for the same window.
            string runtimeKey = RuntimeKey(el);
            if (runtimeKey.Length == 0) return;
            if (!_tracked.TryAdd(runtimeKey, "")) return; // already handling this one

            // One cached round-trip for the toast + its whole subtree.
            AutomationElement detailed = el.GetUpdatedCache(_detailCache);

            Bounds? rect = SafeBounds(detailed);
            if (rect is null)
            {
                _tracked.TryRemove(runtimeKey, out _); // not a visible toast; forget it
                return;
            }

            bool interactive = false, hasClose = false;
            Classify(detailed, ref interactive, ref hasClose);

            string id = Guid.NewGuid().ToString("N");
            _tracked[runtimeKey] = id; // upgrade placeholder to the real id
            _windowsById[id] = el;     // remember the window so we can close it later

            if (_verbose)
            {
                _log($"toast: host={proc} bounds=({rect.X:0},{rect.Y:0},{rect.Width:0}x{rect.Height:0}) " +
                     $"interactive={interactive} close={hasClose}  — tree (text redacted):");
                DumpTree(detailed, 1);
            }

            Appeared?.Invoke(NotificationInfo.Appeared(id, proc, rect, interactive, hasClose));
        }
        catch (ElementNotAvailableException)
        {
            // Toast disappeared mid-inspection — expected for transient toasts.
        }
        catch (Exception ex)
        {
            _log($"warn: inspecting opened window failed: {ex.Message}");
        }
    }

    // --- polling detection (primary path; event handlers are complementary) --

    /// <summary>
    /// Background loop: every <see cref="PollIntervalMs"/> ms, scan the top-level
    /// windows and detect toasts that the WindowOpened event missed. Runs until the
    /// detector stops. Never throws out of the loop (a bad cycle is logged + skipped).
    /// </summary>
    async Task PollLoopAsync(CancellationToken ct)
    {
        // Keys of ALL top-level windows seen last cycle — lets discover mode log only
        // windows that are NEW this cycle (so it shows the toast the moment it opens
        // instead of re-printing every window every 750ms).
        var prevAllKeys = new HashSet<string>();
        while (!ct.IsCancellationRequested)
        {
            try { PollOnce(prevAllKeys); }
            catch (Exception ex) { if (_verbose) _log($"poll: cycle failed: {ex.Message}"); }

            try { await Task.Delay(PollIntervalMs, ct).ConfigureAwait(false); }
            catch (OperationCanceledException) { break; }
        }
        if (_verbose) _log("poll: loop exited.");
    }

    /// <summary>
    /// One polling pass: enumerate top-level windows, detect any new toast
    /// (candidate class + known host), and notice toasts that have since closed.
    /// De-dupes against <c>_tracked</c> so a toast the event path already reported
    /// isn't reported twice.
    /// </summary>
    void PollOnce(HashSet<string> prevAllKeys)
    {
        // Enumerate REAL top-level windows at the Win32 level (user32 EnumWindows).
        // This is the crux of the Win11 fix: these HWNDs include the toast, which the
        // UIA desktop tree hides. Never throws — a bad cycle yields an empty list.
        List<NativeWindows.TopWindow> tops = NativeWindows.EnumerateVisibleTopWindows();

        var currentAll = new HashSet<string>();       // every visible top-level window this cycle
        var currentToastKeys = new HashSet<string>();  // just the ones that look like toasts

        foreach (NativeWindows.TopWindow win in tops)
        {
            string key = win.Hwnd.ToString();  // HWND is a stable per-window key while it lives
            currentAll.Add(key);

            string? proc = ProcessName(win.ProcessId);

            // DISCOVERY: log windows that are NEW since last cycle (dedup via prevAllKeys),
            // so the toast surfaces the moment it opens instead of re-printing every window
            // every 750ms. Metadata only (class/host/geometry) — never a title or body text.
            if (_discover && !prevAllKeys.Contains(key))
            {
                _log($"discover: class={(win.ClassName.Length == 0 ? "?" : win.ClassName)} " +
                     $"host={proc ?? "?"} bounds=({win.X},{win.Y},{win.Width}x{win.Height}) " +
                     $"candidateClass={ToastHeuristics.IsCandidateWindowClass(win.ClassName)} " +
                     $"knownHost={ToastHeuristics.IsToastHostProcess(proc)}");
            }

            if (!ToastHeuristics.IsCandidateWindowClass(win.ClassName)) continue;
            if (!ToastHeuristics.IsToastHostProcess(proc)) continue;

            currentToastKeys.Add(key);

            // New toast we haven't reported yet? Bridge to UIA, classify, emit Appeared.
            if (!_tracked.ContainsKey(key))
                HandleCandidateHwnd(win, proc);
        }

        // CLOSURE: any toast we were tracking that is no longer enumerated has closed.
        foreach (KeyValuePair<string, string> kv in _tracked.ToArray())
        {
            string key = kv.Key;
            string id = kv.Value;
            if (id.Length == 0) continue;                 // still mid-inspection
            if (currentToastKeys.Contains(key)) continue; // still visible
            if (_tracked.TryRemove(key, out _))
            {
                _windowsById.TryRemove(id, out _);
                Closed?.Invoke(NotificationInfo.Closed(id));
                if (_verbose) _log($"poll: toast id={id} gone — closed.");
            }
        }

        // Roll the window set forward for next cycle's discover dedup.
        prevAllKeys.Clear();
        foreach (string k in currentAll) prevAllKeys.Add(k);
    }

    /// <summary>
    /// A Win32-enumerated window passed the toast gate (candidate class + known host).
    /// Bridge it into UIA with AutomationElement.FromHandle — which works on any valid
    /// HWND even when it's cloaked out of the UIA desktop tree — to classify
    /// interactivity / locate the close button, then raise Appeared. De-dupes via
    /// <c>_tracked</c> so a toast is reported once. Geometry comes straight from the
    /// Win32 rectangle (physical pixels; DPI-correct per app.manifest).
    /// </summary>
    void HandleCandidateHwnd(NativeWindows.TopWindow win, string? proc)
    {
        string key = win.Hwnd.ToString();
        if (!_tracked.TryAdd(key, "")) return; // another cycle is already handling this one

        try
        {
            var rect = new Bounds(win.X, win.Y, win.Width, win.Height);

            bool interactive = false, hasClose = false;
            AutomationElement? el = null;
            try
            {
                el = AutomationElement.FromHandle(win.Hwnd);
                if (el is not null)
                {
                    AutomationElement detailed = el.GetUpdatedCache(_detailCache);
                    Classify(detailed, ref interactive, ref hasClose);
                }
            }
            catch (ElementNotAvailableException)
            {
                // Toast vanished between enumeration and inspection — still report the
                // geometry we have; the poll loop retracts it next cycle if it's gone.
            }
            catch (Exception ex)
            {
                if (_verbose) _log($"warn: classifying toast hwnd failed: {ex.Message}");
            }

            string id = Guid.NewGuid().ToString("N");
            _tracked[key] = id;                          // upgrade placeholder to the real id
            if (el is not null) _windowsById[id] = el;   // remember it so we can close it later

            if (_verbose)
                _log($"toast: host={proc ?? "?"} bounds=({rect.X:0},{rect.Y:0},{rect.Width:0}x{rect.Height:0}) " +
                     $"interactive={interactive} close={hasClose}");

            Appeared?.Invoke(NotificationInfo.Appeared(id, proc, rect, interactive, hasClose));
        }
        catch (Exception ex)
        {
            _tracked.TryRemove(key, out _); // let a later cycle retry
            _log($"warn: handling toast hwnd failed: {ex.Message}");
        }
    }

    // --- Phase 6: close a specific toast on request -------------------------

    /// <summary>
    /// Ask the OS to dismiss the toast we earlier reported under <paramref name="id"/>.
    /// Called from the pipe reader thread when the app decides to auto-close; we
    /// hop onto the thread pool so UIA work never blocks the transport (and is
    /// never run from inside a UIA event callback — same threading rule as above).
    /// </summary>
    public void CloseToast(string id)
    {
        if (string.IsNullOrEmpty(id)) return;
        Task.Run(() => CloseToastCore(id));
    }

    void CloseToastCore(string id)
    {
        if (!_windowsById.TryGetValue(id, out AutomationElement? win) || win is null)
        {
            // Either we never tracked this id, or it already closed and was pruned.
            if (_verbose) _log($"close: id={id} not tracked (already gone?) — ignoring.");
            return;
        }

        try
        {
            // VERIFY the toast is still really on screen with a FRESH, LIVE read
            // (no cache). Touching a vanished element throws ElementNotAvailable,
            // which we treat as "it self-dismissed before we got there" — success
            // by another route, so we just prune and move on.
            System.Windows.Rect r = win.Current.BoundingRectangle;
            bool offscreen;
            try { offscreen = win.Current.IsOffscreen; } catch { offscreen = false; }
            if (r.IsEmpty || r.Width <= 0 || r.Height <= 0 || offscreen)
            {
                if (_verbose) _log($"close: id={id} no longer visible — nothing to do.");
                _windowsById.TryRemove(id, out _);
                return;
            }

            // RE-LOCATE the dismiss button FRESH under this window (live subtree
            // walk, not the cache we built at appear-time), so we act on the button
            // as it exists right now rather than a possibly-stale snapshot.
            AutomationElement? closeButton = FindCloseButtonLive(win);
            if (closeButton is null)
            {
                _log($"close: id={id} — could not find a dismiss button; leaving the toast alone.");
                return;
            }

            if (InvokeElement(closeButton))
            {
                if (_verbose) _log($"close: id={id} — dismiss invoked.");
                // We intentionally do NOT emit a synthetic Closed here. When the
                // toast actually disappears the WindowClosed UIA event fires and
                // OnWindowClosed emits Closed + prunes the maps — one source of truth.
            }
            else
            {
                _log($"close: id={id} — dismiss button exposed no invokable pattern; leaving it.");
            }
        }
        catch (ElementNotAvailableException)
        {
            if (_verbose) _log($"close: id={id} vanished mid-close — fine.");
            _windowsById.TryRemove(id, out _);
        }
        catch (Exception ex)
        {
            _log($"warn: close id={id} failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Depth-first LIVE search for the toast's dismiss button (uses ToastHeuristics,
    /// the same rule that set hasCloseButton at appear-time). Reading a control's
    /// Name here is for classification only — it is a UI affordance label, never the
    /// notification's text, and it never leaves this process (ARCHITECTURE.md §7).
    /// </summary>
    static AutomationElement? FindCloseButtonLive(AutomationElement root)
    {
        AutomationElementCollection children;
        try { children = root.FindAll(TreeScope.Children, Condition.TrueCondition); }
        catch { return null; }

        foreach (AutomationElement child in children)
        {
            ControlType? ct = null;
            string? autoId = null, name = null;
            try { ct = child.Current.ControlType; } catch { /* leave null */ }
            try { autoId = child.Current.AutomationId; } catch { /* leave null */ }
            try { name = child.Current.Name; } catch { /* leave null */ }

            if (ToastHeuristics.IsCloseButton(ct, autoId, name)) return child;

            AutomationElement? deeper = FindCloseButtonLive(child);
            if (deeper is not null) return deeper;
        }
        return null;
    }

    /// <summary>
    /// "Click" an element without moving the mouse, using the UIA Invoke pattern —
    /// the standard "activate this control" pattern that Windows toast dismiss
    /// buttons implement. Returns false if the element doesn't expose it.
    ///
    /// We deliberately use ONLY UIA patterns here, never synthetic mouse/keyboard
    /// input (ARCHITECTURE.md §7). There is intentionally no LegacyIAccessible /
    /// MSAA "DoDefaultAction" fallback: that pattern is NOT part of the managed UIA
    /// surface (System.Windows.Automation, surfaced by UseWPF) — it exists only in
    /// the COM UIAutomationClient API, so using it would mean dragging in COM
    /// interop for a case that doesn't arise in practice (shell toast close buttons
    /// expose InvokePattern). If a control genuinely lacks Invoke we report that to
    /// the caller rather than silently fall back to synthetic input.
    /// </summary>
    static bool InvokeElement(AutomationElement el)
    {
        if (el.TryGetCurrentPattern(InvokePattern.Pattern, out object? invObj)
            && invObj is InvokePattern invoke)
        {
            invoke.Invoke();
            return true;
        }
        return false;
    }

    // --- one-shot scan of what's already on screen (for --scan / tuning) -----

    /// <summary>
    /// Enumerate current top-level windows and report any toast-like ones. Useful
    /// for discovering the class/host names YOUR Windows uses (leave a toast up,
    /// then run with --scan). Runs synchronously.
    /// </summary>
    public void ScanExisting()
    {
        _log("Scanning current top-level windows for toast-like surfaces…");
        AutomationElementCollection tops;
        try
        {
            using (_openCache.Activate())
                tops = AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition);
        }
        catch (Exception ex)
        {
            _log($"scan failed to enumerate windows: {ex.Message}");
            return;
        }

        int hits = 0;
        foreach (AutomationElement w in tops)
        {
            string? cls;
            try { cls = w.Cached.ClassName; }
            catch { continue; }

            int pid = SafeProcessId(w);
            string? proc = ProcessName(pid);
            bool candidateClass = ToastHeuristics.IsCandidateWindowClass(cls);
            bool knownHost = ToastHeuristics.IsToastHostProcess(proc);

            // In verbose scan, print EVERY top-level window — not just ones that
            // already pass the class gate. Otherwise an unknown toast class can never
            // be discovered here (the very thing we scan to find). Open the
            // Notification Center (Win+N) first so recent toasts are on screen to see.
            if (_verbose)
                _log($"window: class={cls ?? "?"} host={proc ?? "?"} " +
                     $"candidateClass={candidateClass} knownHost={knownHost}");

            if (!candidateClass) continue;
            _log($"candidate window: class={cls} host={proc ?? "?"} knownHost={knownHost}");
            if (!knownHost) continue;

            try
            {
                AutomationElement detailed = w.GetUpdatedCache(_detailCache);
                Bounds? rect = SafeBounds(detailed);
                if (rect is null) { _log("  (no visible bounds; skipping)"); continue; }
                bool interactive = false, hasClose = false;
                Classify(detailed, ref interactive, ref hasClose);
                if (_verbose) DumpTree(detailed, 1);
                Appeared?.Invoke(NotificationInfo.Appeared(
                    Guid.NewGuid().ToString("N"), proc, rect, interactive, hasClose));
                hits++;
            }
            catch (Exception ex) { _log($"  scan of candidate failed: {ex.Message}"); }
        }

        _log($"Scan complete — {hits} toast-like surface(s) found. " +
             "If a toast was visible and none were found, run --verbose and add your " +
             "class/host names to ToastHeuristics.cs.");
    }

    // --- classification + dump (walk the CACHED subtree; no live UIA calls) --

    void Classify(AutomationElement el, ref bool interactive, ref bool hasClose)
    {
        AutomationElementCollection children;
        try { children = el.CachedChildren; }
        catch { return; }

        foreach (AutomationElement child in children)
        {
            ControlType? ct = null;
            string? id = null, name = null;
            try { ct = child.Cached.ControlType; } catch { /* leave null */ }
            try { id = child.Cached.AutomationId; } catch { /* leave null */ }
            try { name = child.Cached.Name; } catch { /* leave null */ }

            if (ToastHeuristics.IsCloseButton(ct, id, name)) hasClose = true;
            if (ToastHeuristics.IsInteractiveControl(ct, id, name)) interactive = true;

            Classify(child, ref interactive, ref hasClose);
        }
    }

    void DumpTree(AutomationElement el, int depth)
    {
        AutomationElementCollection children;
        try { children = el.CachedChildren; }
        catch { return; }

        foreach (AutomationElement child in children)
        {
            string ct = "?", id = "", cls = "";
            int nameLen = 0;
            try { ct = child.Cached.ControlType.ProgrammaticName; } catch { }
            try { id = child.Cached.AutomationId; } catch { }
            try { cls = child.Cached.ClassName; } catch { }
            try { nameLen = (child.Cached.Name ?? "").Length; } catch { }

            // NOTE: we print the NAME LENGTH only, never the text itself (privacy).
            _log($"{new string(' ', depth * 2)}- {ct} class='{cls}' autoId='{id}' name=<redacted len={nameLen}>");
            DumpTree(child, depth + 1);
        }
    }

    // --- small safe readers --------------------------------------------------

    static int SafeProcessId(AutomationElement el)
    {
        try { return el.Cached.ProcessId; } catch { return -1; }
    }

    static string? ProcessName(int pid)
    {
        if (pid <= 0) return null;
        try
        {
            using Process p = Process.GetProcessById(pid);
            return p.ProcessName; // metadata only — e.g. "ShellExperienceHost"
        }
        catch { return null; }
    }

    static Bounds? SafeBounds(AutomationElement el)
    {
        try
        {
            System.Windows.Rect r = el.Cached.BoundingRectangle;
            if (r.IsEmpty || r.Width <= 0 || r.Height <= 0) return null;
            try { if (el.Cached.IsOffscreen) return null; } catch { /* ignore */ }
            return new Bounds(r.X, r.Y, r.Width, r.Height);
        }
        catch { return null; }
    }

    string RuntimeKey(AutomationElement el)
    {
        try { return KeyFromRuntimeId((int[]?)el.GetCachedPropertyValue(AutomationElement.RuntimeIdProperty)); }
        catch
        {
            try { return KeyFromRuntimeId(el.GetRuntimeId()); }
            catch { return ""; }
        }
    }

    static string KeyFromRuntimeId(int[]? runtimeId) =>
        runtimeId is null || runtimeId.Length == 0 ? "" : string.Join(".", runtimeId);

    public void Dispose() => Stop();
}
