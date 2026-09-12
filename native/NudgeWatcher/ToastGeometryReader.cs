using System.Windows.Automation;

namespace NudgeWatcher;

internal sealed record ToastGeometry(Bounds Bounds, ScreenPoint? ClosePoint);

/// <summary>
/// Best-effort live geometry alongside the reliable notification-platform IDs.
/// Reads shell window bounds and dismiss-button metadata only, never message
/// text. A slow accessibility provider must not stall detection or close events.
/// </summary>
internal sealed class ToastGeometryReader
{
    Task<ToastGeometry?>? _pending;

    public async Task<ToastGeometry?> ReadAsync()
    {
        _pending ??= Task.Run(FindVisibleToast);
        try
        {
            ToastGeometry? result = await _pending.WaitAsync(TimeSpan.FromMilliseconds(150));
            _pending = null;
            return result;
        }
        catch (TimeoutException) { return null; }
        catch { _pending = null; return null; }
    }

    static ToastGeometry? FindVisibleToast()
    {
        Bounds work = NativeWindows.PrimaryWorkArea();
        double scale = NativeWindows.PrimaryScaleFactor();
        ToastGeometry? found = null;
        foreach (NativeWindows.TopWindow window in NativeWindows.FindToastWindows())
        {
            try
            {
                AutomationElement root = AutomationElement.FromHandle(window.Hwnd);
                var cache = new CacheRequest { TreeScope = TreeScope.Element };
                cache.Add(AutomationElement.AutomationIdProperty);
                cache.Add(AutomationElement.NameProperty);
                cache.Add(AutomationElement.BoundingRectangleProperty);
                cache.Add(AutomationElement.IsOffscreenProperty);
                using (cache.Activate())
                {
                    // Only button names are fetched (e.g. "Dismiss"), never the
                    // names of text controls holding the message title or body.
                    var buttons = root.FindAll(TreeScope.Descendants,
                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button));
                    foreach (AutomationElement button in buttons)
                    {
                        string id = button.Cached.AutomationId;
                        string name = button.Cached.Name;
                        if (button.Cached.IsOffscreen ||
                            !(string.Equals(id, "DismissButton", StringComparison.OrdinalIgnoreCase) ||
                              string.Equals(name, "Dismiss", StringComparison.OrdinalIgnoreCase) ||
                              string.Equals(name, "Close", StringComparison.OrdinalIgnoreCase))) continue;
                        var box = button.Cached.BoundingRectangle;
                        if (box.IsEmpty || box.Width <= 0 || box.Height <= 0) continue;
                        var close = new ScreenPoint(box.X + box.Width / 2, box.Y + box.Height / 2);
                        if (close.X < work.X + work.Width - 100 * scale ||
                            close.X > work.X + work.Width || close.Y < work.Y ||
                            close.Y > work.Y + work.Height) continue;
                        Bounds? bounds = BannerBounds(button, work, scale);
                        // Even if the shell exposes no banner container, its
                        // measured button centre is sufficient for paw alignment.
                        bounds ??= new Bounds(close.X - 338 * scale, close.Y - 20 * scale,
                            360 * scale, 170 * scale);
                        if (found?.ClosePoint is null || close.Y > found.ClosePoint.Y)
                            found = new ToastGeometry(bounds, close);
                    }
                }
                if (found is null)
                {
                    var bounds = new Bounds(window.X, window.Y, window.Width, window.Height);
                    if (IsBanner(bounds, work, scale)) found = new ToastGeometry(bounds, null);
                }
            }
            catch { /* Expired/inaccessible surface; retain any geometry found. */ }
        }
        return found;
    }

    static Bounds? BannerBounds(AutomationElement button, Bounds work, double scale)
    {
        AutomationElement? element = button;
        for (int depth = 0; depth < 12 && element is not null; depth++)
        {
            var box = element.Current.BoundingRectangle;
            var bounds = new Bounds(box.X, box.Y, box.Width, box.Height);
            if (IsBanner(bounds, work, scale)) return bounds;
            element = TreeWalker.RawViewWalker.GetParent(element);
        }
        return null;
    }

    static bool IsBanner(Bounds bounds, Bounds work, double scale) =>
        bounds.Width >= 200 * scale && bounds.Width <= 500 * scale &&
        bounds.Height >= 60 * scale && bounds.Height <= 500 * scale &&
        bounds.X >= work.X + work.Width - 550 * scale && bounds.Y >= work.Y &&
        bounds.X + bounds.Width <= work.X + work.Width + 2 * scale &&
        bounds.Y + bounds.Height <= work.Y + work.Height + 2 * scale;
}
