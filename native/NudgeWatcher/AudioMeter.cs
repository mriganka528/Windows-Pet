using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace NudgeWatcher;

// Read-only Core Audio endpoint metering. This does not open a recording,
// microphone, loopback capture, screen-sharing or communications session.
internal sealed class AudioMeter : IDisposable
{
    IMMDeviceEnumerator? enumerator;
    IAudioMeterInformation? meter;
    string? endpointId;
    long nextDeviceCheck;

    internal static int Run()
    {
        using var stop = new ManualResetEventSlim();
        using var reader = new AudioMeter();
        // EOF also stops the helper if Electron exits unexpectedly.
        _ = Task.Run(() =>
        {
            try
            {
                while (Console.ReadLine() is string line)
                    if (line.Trim() == "stop") break;
            }
            catch (IOException) { }
            finally
            {
                try { stop.Set(); } catch (ObjectDisposedException) { }
            }
        });
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.Set(); };
        var clock = Stopwatch.StartNew();
        try
        {
            while (!stop.IsSet)
            {
                var sample = reader.Read(clock.ElapsedMilliseconds);
                Console.Out.WriteLine(JsonSerializer.Serialize(new
                {
                    type = "audio-level",
                    level = sample.Level,
                    available = sample.Available
                }));
                Console.Out.Flush();
                stop.Wait(20);
            }
        }
        catch (IOException) { /* Parent closed its output pipe. */ }
        return 0;
    }

    internal (float Level, bool Available) Read(long nowMs)
    {
        try
        {
            // Rebind when Windows switches speakers/headphones or a device
            // appears after startup. Failed devices are retried once a second.
            if (nowMs >= nextDeviceCheck)
            {
                nextDeviceCheck = nowMs + 1000;
                RefreshDevice();
            }
            if (meter is null) return (0, false);
            Marshal.ThrowExceptionForHR(meter.GetPeakValue(out float peak));
            return (float.IsFinite(peak) ? Math.Clamp(peak, 0, 1) : 0, true);
        }
        catch (Exception ex) when (ex is COMException or InvalidCastException)
        {
            ReleaseMeter();
            if (enumerator is not null) Marshal.FinalReleaseComObject(enumerator);
            enumerator = null;
            nextDeviceCheck = nowMs + 1000;
            return (0, false);
        }
    }

    void RefreshDevice()
    {
        enumerator ??= (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out IMMDevice device));
        try
        {
            Marshal.ThrowExceptionForHR(device.GetId(out string id));
            if (id == endpointId && meter is not null) return;
            ReleaseMeter();
            Guid iid = typeof(IAudioMeterInformation).GUID;
            Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out object service));
            try { meter = (IAudioMeterInformation)service; }
            catch { Marshal.FinalReleaseComObject(service); throw; }
            endpointId = id;
        }
        finally { Marshal.FinalReleaseComObject(device); }
    }

    void ReleaseMeter()
    {
        if (meter is not null) Marshal.FinalReleaseComObject(meter);
        meter = null;
        endpointId = null;
    }

    public void Dispose()
    {
        ReleaseMeter();
        if (enumerator is not null) Marshal.FinalReleaseComObject(enumerator);
        enumerator = null;
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorComObject { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int flow, uint mask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr callback);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr callback);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object service);
        [PreserveSig] int OpenPropertyStore(uint access, out IntPtr store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out uint state);
    }

    [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioMeterInformation
    {
        [PreserveSig] int GetPeakValue(out float peak);
        [PreserveSig] int GetMeteringChannelCount(out uint count);
        [PreserveSig] int GetChannelsPeakValues(uint count, IntPtr peaks);
        [PreserveSig] int QueryHardwareSupport(out uint mask);
    }
}
