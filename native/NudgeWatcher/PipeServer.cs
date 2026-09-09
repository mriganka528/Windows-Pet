using System.IO;          // IOException — NOT pulled in by implicit usings on a
                          // UseWPF project (its Windows-desktop implicit-usings set
                          // omits System.IO), yet used below in catch filters.
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace NudgeWatcher;

// ---------------------------------------------------------------------------
// Phase 5 transport: a named-pipe SERVER that streams NDJSON to Electron.
// ---------------------------------------------------------------------------
// Direction of roles (per IMPLEMENTATION_PLAN): **C# is the server, Node is the
// client.** Electron generates a unique pipe name, spawns this watcher with
// `--pipe <name>`, then connects as a client to `\\.\pipe\<name>`. We write one
// newline-delimited JSON object per event — the exact same line format already
// going to stdout, so nothing about the wire schema changes (see NotificationInfo).
//
// WHY A CHANNEL IN THE MIDDLE
//   Toast events arrive on UI Automation threads (and Task.Run workers). Pipe I/O
//   must be serialized and must never block those threads. So event handlers just
//   drop a finished JSON line into a bounded Channel<string>; a single background
//   loop owns the pipe and drains the channel. The channel is bounded with
//   DropOldest, so if no client is connected (or a slow/stuck reader), memory
//   can't grow without bound — we keep only the most recent events (stale toast
//   geometry isn't worth replaying anyway).
//
// RECONNECT
//   One client at a time (Electron). If the client disconnects, the next write
//   fails; we dispose that stream and loop back to WaitForConnectionAsync so a
//   fresh Electron connection (e.g. after the app restarts the pipe) is accepted.
//   Process-level crash/restart is handled on the Electron side (supervisor).
//
// SECURITY (ARCHITECTURE.md §7)
//   Trusted-local pipe with default OS ACLs (owner = current user). No auth token;
//   the client runs as the same user. We request no elevation. We never put
//   notification *content* on the wire — only the geometry/metadata schema.
//
// DUPLEX / PHASE 6
//   Opened InOut so the app can talk back. Phase 6 uses the reverse direction
//   (Node -> C#) to carry "close this notification" commands as NDJSON, e.g.
//       {"cmd":"close","id":"<guid>"}
//   A per-connection reader (ReadCommandsAsync) parses those lines and raises
//   CloseRequested(id); Program wires that to ToastDetector.CloseToast. The
//   command carries only an id we ourselves minted — never any notification text.

internal sealed class PipeServer : IDisposable
{
    private readonly string _pipeName;
    private readonly bool _verbose;
    private readonly Action<string> _log;
    private readonly Channel<string> _queue;
    private readonly CancellationTokenSource _cts = new();
    private Task? _loop;

    /// <summary>Raised (on a pool thread) when the client sends a
    /// {"cmd":"close","id":...} line. The argument is the notification id to close.</summary>
    public event Action<string>? CloseRequested;

    /// <summary>Bounded so a missing/slow reader can't leak memory; DropOldest
    /// keeps the freshest events. 256 lines is far more than a human generates.</summary>
    private const int QueueCapacity = 256;

    public PipeServer(string pipeName, bool verbose, Action<string> log)
    {
        _pipeName = pipeName;
        _verbose = verbose;
        _log = log;
        _queue = Channel.CreateBounded<string>(new BoundedChannelOptions(QueueCapacity)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,   // exactly one drain loop
            SingleWriter = false   // many UIA/worker threads may enqueue
        });
    }

    /// <summary>Begin accepting connections and draining the queue in the background.</summary>
    public void Start()
    {
        _loop = Task.Run(() => AcceptLoopAsync(_cts.Token));
    }

    /// <summary>Thread-safe: hand a finished JSON line to the pipe loop. Never blocks;
    /// if the buffer is full the oldest queued line is dropped.</summary>
    public void Enqueue(string jsonLine)
    {
        _queue.Writer.TryWrite(jsonLine);
    }

    private async Task AcceptLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            NamedPipeServerStream? server = null;
            try
            {
                server = new NamedPipeServerStream(
                    _pipeName,
                    PipeDirection.InOut,               // duplex (Phase 6-ready)
                    maxNumberOfServerInstances: 1,     // single client: Electron
                    PipeTransmissionMode.Byte,         // NDJSON byte stream
                    PipeOptions.Asynchronous);

                if (_verbose) _log($@"pipe: waiting for client on \\.\pipe\{_pipeName}");
                await server.WaitForConnectionAsync(ct).ConfigureAwait(false);
                _log("pipe: client connected.");

                await PumpAsync(server, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break; // shutting down
            }
            catch (Exception ex)
            {
                // e.g. the name is momentarily in use during a fast reconnect.
                if (_verbose) _log($"pipe: accept error ({ex.GetType().Name}): {ex.Message}");
                try { await Task.Delay(250, ct).ConfigureAwait(false); }
                catch (OperationCanceledException) { break; }
            }
            finally
            {
                try { server?.Dispose(); } catch { /* best effort */ }
            }
        }

        if (_verbose) _log("pipe: accept loop exited.");
    }

    /// <summary>Drain queued lines to a connected client until it disconnects or we stop.</summary>
    private async Task PumpAsync(NamedPipeServerStream server, CancellationToken ct)
    {
        // Scope a CTS to THIS connection: when the write loop ends (client gone) we
        // cancel it to also unwind the reverse reader, and vice-versa.
        using var connCts = CancellationTokenSource.CreateLinkedTokenSource(ct);

        // Reverse channel (Node -> C#): read "close" commands on this same duplex
        // pipe. A named pipe supports concurrent read + write, so this runs happily
        // alongside the write loop below on its own task.
        Task reader = Task.Run(() => ReadCommandsAsync(server, connCts.Token), connCts.Token);

        try
        {
            ChannelReader<string> queueReader = _queue.Reader;
            while (!connCts.IsCancellationRequested && server.IsConnected)
            {
                string line;
                try
                {
                    line = await queueReader.ReadAsync(connCts.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }

                byte[] bytes = Encoding.UTF8.GetBytes(line + "\n");
                try
                {
                    await server.WriteAsync(bytes.AsMemory(), connCts.Token).ConfigureAwait(false);
                    await server.FlushAsync(connCts.Token).ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is IOException or ObjectDisposedException or OperationCanceledException)
                {
                    // Client vanished mid-write. Drop back to the accept loop to await a
                    // fresh connection. The pulled line is lost (acceptable — see class note).
                    if (_verbose) _log($"pipe: write failed ({ex.GetType().Name}); will re-accept.");
                    break;
                }
            }
        }
        finally
        {
            // Stop the reader too, then wait briefly. We don't block shutdown on it:
            // if the pending ReadAsync doesn't observe cancellation immediately, the
            // server.Dispose() in the accept loop will unblock it right after we return.
            connCts.Cancel();
            try { await reader.WaitAsync(TimeSpan.FromMilliseconds(750)).ConfigureAwait(false); }
            catch { /* timed out or faulted — the stream dispose will finish it off */ }
        }
    }

    /// <summary>
    /// Reverse channel reader: consume newline-delimited command JSON from the
    /// client and dispatch it. Runs until the client closes its write end, the
    /// connection drops, or we cancel. Never throws to the caller.
    /// </summary>
    private async Task ReadCommandsAsync(NamedPipeServerStream server, CancellationToken ct)
    {
        var buffer = new byte[4096];
        var pending = new StringBuilder(); // accumulates bytes until we see '\n'
        try
        {
            while (!ct.IsCancellationRequested && server.IsConnected)
            {
                int read;
                try
                {
                    read = await server.ReadAsync(buffer.AsMemory(), ct).ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is OperationCanceledException or IOException or ObjectDisposedException)
                {
                    break; // cancelled or client gone
                }
                if (read <= 0) break; // client closed its end of the pipe

                pending.Append(Encoding.UTF8.GetString(buffer, 0, read));
                DrainCompleteLines(pending);

                // Defend against a client that never sends a newline: cap the buffer.
                if (pending.Length > 64 * 1024) pending.Clear();
            }
        }
        catch (Exception ex)
        {
            if (_verbose) _log($"pipe: command reader stopped ({ex.GetType().Name}): {ex.Message}");
        }
    }

    /// <summary>Pull every complete '\n'-terminated line out of the buffer and handle it,
    /// leaving any trailing partial line in place for the next read.</summary>
    private void DrainCompleteLines(StringBuilder pending)
    {
        while (true)
        {
            string text = pending.ToString();
            int nl = text.IndexOf('\n');
            if (nl < 0) break;

            string line = text.Substring(0, nl).Trim();
            pending.Remove(0, nl + 1);
            if (line.Length > 0) HandleCommandLine(line);
        }
    }

    /// <summary>Parse one command line. Tolerant: unknown/malformed commands are ignored.</summary>
    private void HandleCommandLine(string line)
    {
        try
        {
            using JsonDocument doc = JsonDocument.Parse(line);
            JsonElement root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return;
            if (!root.TryGetProperty("cmd", out JsonElement cmdEl)) return;

            string? cmd = cmdEl.GetString();
            if (string.Equals(cmd, "close", StringComparison.Ordinal))
            {
                string? id = root.TryGetProperty("id", out JsonElement idEl) ? idEl.GetString() : null;
                if (!string.IsNullOrEmpty(id))
                {
                    if (_verbose) _log($"pipe: recv close id={id}");
                    // Fire on a pool thread so a slow UIA close can't stall this reader.
                    Action<string>? handler = CloseRequested;
                    if (handler is not null) Task.Run(() => handler(id!));
                }
            }
            else if (_verbose)
            {
                _log($"pipe: ignoring unknown command '{cmd}'.");
            }
        }
        catch (JsonException)
        {
            if (_verbose) _log("pipe: ignoring malformed command line.");
        }
    }

    public void Dispose()
    {
        try { _cts.Cancel(); } catch { /* already gone */ }
        try { _loop?.Wait(TimeSpan.FromSeconds(2)); } catch { /* best effort */ }
        _cts.Dispose();
    }
}
