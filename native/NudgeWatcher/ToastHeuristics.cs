using System.Windows.Automation;

namespace NudgeWatcher;

// ---------------------------------------------------------------------------
// Tunable detection rules — the ONE file to edit when iterating on real toasts.
// ---------------------------------------------------------------------------
// Windows toast detection via UIA is inherently heuristic and drifts across
// Windows builds and locales. Everything fragile is collected here so that
// "make detection reliable on my machine" (Phase 4's whole point) means editing
// this file and nothing else. ToastDetector calls these with values it already
// read from the UIA cache; these methods stay free of live UIA calls so they're
// trivial to reason about (and unit-test later).
//
// How to tune (see README): run `--scan` / `--verbose`, read what class name and
// host process YOUR Windows uses for toasts, and add them below.

public static class ToastHeuristics
{
    // Window ClassName values that HOST toasts. NOTE: "Windows.UI.Core.CoreWindow"
    // is shared by many UWP windows, so a class match is only a cheap pre-filter —
    // IsToastHostProcess adds the confirming second signal.
    public static readonly string[] CandidateWindowClasses =
    {
        "Windows.UI.Core.CoreWindow",
        "Windows.UI.Notifications.ToastNotification",
        "ToastChildWindowClass"
    };

    // Processes known to host system toasts. Win10 uses ShellExperienceHost;
    // Win11 has shifted across builds — add whatever `--scan` reports for you.
    public static readonly string[] ToastHostProcesses =
    {
        "ShellExperienceHost",
        "ShellHost",
        "explorer"
    };

    // The dismiss/close ("X") button. AutomationId is the most stable signal
    // across languages; Name is an English-first fallback.
    public static readonly string[] CloseButtonAutomationIds =
    {
        "DismissButton"
    };
    public static readonly string[] CloseButtonNames =
    {
        "Dismiss", "Close"
    };

    // Buttons that appear on an *ordinary* toast and must NOT be treated as
    // "interactive" (they're standard chrome: dismiss, the settings gear, the
    // "…" context menu, the expand/collapse chevron). Everything here is excluded
    // when deciding `interactive`.
    public static readonly string[] ChromeButtonAutomationIds =
    {
        "DismissButton", "SettingsButton", "ContextMenuButton",
        "ExpandCollapseButton", "MoreButton"
    };
    public static readonly string[] ChromeButtonNames =
    {
        "Dismiss", "Close", "Settings", "Notification settings",
        "More options", "More", "Context menu", "Expand", "Collapse"
    };

    static bool EqualsAnyCI(string[] set, string? value) =>
        !string.IsNullOrEmpty(value)
        && Array.Exists(set, s => string.Equals(s, value, StringComparison.OrdinalIgnoreCase));

    static bool ContainsAnyCI(string[] set, string? value) =>
        !string.IsNullOrEmpty(value)
        && Array.Exists(set, s => value!.Contains(s, StringComparison.OrdinalIgnoreCase));

    public static bool IsCandidateWindowClass(string? className) =>
        EqualsAnyCI(CandidateWindowClasses, className);

    public static bool IsToastHostProcess(string? processName) =>
        EqualsAnyCI(ToastHostProcesses, processName);

    /// <summary>Is this element the dismiss/close button?</summary>
    public static bool IsCloseButton(ControlType? controlType, string? automationId, string? name)
    {
        if (controlType != ControlType.Button) return false;
        if (EqualsAnyCI(CloseButtonAutomationIds, automationId)) return true;
        return ContainsAnyCI(CloseButtonNames, name);
    }

    /// <summary>
    /// Does this element make the toast "interactive" — i.e. something a person is
    /// meant to act on, which auto-close (Phase 6) must never pre-empt? True for
    /// text entry / selection controls and for app action buttons ("Reply",
    /// "Join", "Snooze"), but NOT for standard toast chrome.
    /// </summary>
    public static bool IsInteractiveControl(ControlType? controlType, string? automationId, string? name)
    {
        if (controlType is null) return false;

        if (controlType == ControlType.Edit
            || controlType == ControlType.ComboBox
            || controlType == ControlType.CheckBox
            || controlType == ControlType.RadioButton
            || controlType == ControlType.Slider
            || controlType == ControlType.Hyperlink)
        {
            return true;
        }

        if (controlType == ControlType.Button)
        {
            if (EqualsAnyCI(ChromeButtonAutomationIds, automationId)) return false;
            if (ContainsAnyCI(ChromeButtonNames, name)) return false;
            return true; // an app-provided action button
        }

        return false;
    }
}
