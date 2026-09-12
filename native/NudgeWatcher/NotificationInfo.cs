using System.Text.Json;
using System.Text.Json.Serialization;

namespace NudgeWatcher;

// ---------------------------------------------------------------------------
// Wire model for what the watcher reports.
// ---------------------------------------------------------------------------
// This is the shape that goes to stdout now (Phase 4) and over the named pipe to
// Electron later (Phase 5). It matches ARCHITECTURE.md §3:
//   {"type":"notification_appeared","id":"...","bounds":{...},"interactive":false}
//
// PRIVACY (ARCHITECTURE.md §7): this record intentionally has NO field for the
// notification's title/body/content. We only ever carry geometry + metadata the
// companion needs to travel to the toast and decide whether to leave it alone.
// `appId` is a best-effort *host process* identifier (e.g. "ShellExperienceHost")
// — it is NOT the notification text, and it is NOT (yet) the true sending app's
// identity (that mapping is a later refinement and must stay content-free).

/// <summary>Screen rectangle in physical pixels (top-left origin).</summary>
public sealed record Bounds(double X, double Y, double Width, double Height);
public sealed record ScreenPoint(double X, double Y);

/// <summary>A detected notification event, serialized as one JSON line.</summary>
public sealed class NotificationInfo
{
    /// <summary>"notification_appeared" or "notification_closed".</summary>
    [JsonPropertyName("type")]
    public string Type { get; init; } = MessageTypes.Appeared;

    /// <summary>Stable id we assign for the lifetime of this toast (a GUID).</summary>
    [JsonPropertyName("id")]
    public string Id { get; init; } = "";

    /// <summary>Best-effort host process name (metadata, never content). May be empty.</summary>
    [JsonPropertyName("appId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? AppId { get; init; }

    /// <summary>Toast bounding rectangle. Null on close messages.</summary>
    [JsonPropertyName("bounds")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public Bounds? Bounds { get; init; }

    /// <summary>Measured centre of the visible dismiss button, when accessible.</summary>
    [JsonPropertyName("closePoint")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public ScreenPoint? ClosePoint { get; init; }

    /// <summary>
    /// True if the toast exposes interactive controls beyond a plain
    /// dismiss/settings affordance (an inline reply box, a dropdown, action
    /// buttons, …). Auto-close (Phase 6) must skip these. Null on close messages.
    /// </summary>
    [JsonPropertyName("interactive")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Interactive { get; init; }

    /// <summary>True if we located a dismiss/close button. Null on close messages.</summary>
    [JsonPropertyName("hasCloseButton")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? HasCloseButton { get; init; }

    /// <summary>ISO-8601 UTC timestamp of detection.</summary>
    [JsonPropertyName("ts")]
    public string Ts { get; init; } = DateTime.UtcNow.ToString("o");

    public static NotificationInfo Appeared(
        string id, string? appId, Bounds bounds, bool interactive, bool hasCloseButton,
        ScreenPoint? closePoint = null) => new()
    {
        Type = MessageTypes.Appeared,
        Id = id,
        AppId = appId,
        Bounds = bounds,
        ClosePoint = closePoint,
        Interactive = interactive,
        HasCloseButton = hasCloseButton
    };

    public static NotificationInfo Closed(string id) => new()
    {
        Type = MessageTypes.Closed,
        Id = id
        // bounds/interactive/hasCloseButton stay null and are omitted from JSON.
    };

    /// <summary>Compact, single-line JSON (newline-delimited-JSON friendly).</summary>
    public string ToJsonLine() => JsonSerializer.Serialize(this, WatcherJson.Options);
}

public static class MessageTypes
{
    public const string Appeared = "notification_appeared";
    public const string Closed = "notification_closed";
}

/// <summary>Shared serializer options: camelCase-ish (we set names explicitly),
/// compact, and null-omitting so close messages stay minimal.</summary>
public static class WatcherJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = false,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
}
