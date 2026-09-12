using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Xml;

namespace NudgeBuild
{
    // Changes only the execution-level attributes of the existing PE manifest.
    // Preserve Electron's DPI, compatibility, and other loader declarations.
    public static class UiAccessImage
    {
        private delegate bool LanguageCallback(IntPtr module, IntPtr type, IntPtr name, ushort language, IntPtr data);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadLibraryEx(string path, IntPtr file, uint flags);
        [DllImport("kernel32.dll")] private static extern bool FreeLibrary(IntPtr module);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, LanguageCallback callback, IntPtr data);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr FindResourceEx(IntPtr module, IntPtr type, IntPtr name, ushort language);
        [DllImport("kernel32.dll")] private static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
        [DllImport("kernel32.dll")] private static extern IntPtr LockResource(IntPtr resource);
        [DllImport("kernel32.dll")] private static extern uint SizeofResource(IntPtr module, IntPtr resource);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr BeginUpdateResource(string path, bool deleteExisting);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] data, uint length);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool EndUpdateResource(IntPtr update, bool discard);

        public static Dictionary<ushort, string> Read(string path)
        {
            var manifests = new Dictionary<ushort, string>();
            IntPtr module = LoadLibraryEx(path, IntPtr.Zero, 0x22); // data only; never executes the image
            if (module == IntPtr.Zero) throw new Win32Exception();
            try
            {
                LanguageCallback callback = delegate(IntPtr m, IntPtr t, IntPtr n, ushort lang, IntPtr unused)
                {
                    IntPtr resource = FindResourceEx(m, t, n, lang);
                    uint size = SizeofResource(m, resource);
                    IntPtr pointer = LockResource(LoadResource(m, resource));
                    if (pointer == IntPtr.Zero || size == 0) return false;
                    var bytes = new byte[size];
                    Marshal.Copy(pointer, bytes, 0, bytes.Length);
                    manifests.Add(lang, Encoding.UTF8.GetString(bytes).Trim('\0', '\uFEFF'));
                    return true;
                };
                if (!EnumResourceLanguages(module, new IntPtr(24), new IntPtr(1), callback, IntPtr.Zero) || manifests.Count == 0)
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "The executable has no application manifest.");
            }
            finally { FreeLibrary(module); }
            return manifests;
        }

        public static void Enable(string path)
        {
            var manifests = Read(path);
            IntPtr update = BeginUpdateResource(path, false);
            if (update == IntPtr.Zero) throw new Win32Exception();
            bool committed = false;
            try
            {
                foreach (var manifest in manifests)
                {
                    var xml = new XmlDocument { PreserveWhitespace = true, XmlResolver = null };
                    xml.LoadXml(manifest.Value);
                    var execution = xml.SelectSingleNode("//*[local-name()='requestedExecutionLevel']") as XmlElement;
                    if (execution == null) throw new InvalidOperationException("Missing execution-level declaration.");
                    execution.SetAttribute("level", "asInvoker");
                    execution.SetAttribute("uiAccess", "true");
                    byte[] bytes = new UTF8Encoding(false).GetBytes(xml.OuterXml);
                    if (!UpdateResource(update, new IntPtr(24), new IntPtr(1), manifest.Key, bytes, (uint)bytes.Length))
                        throw new Win32Exception();
                }
                if (!EndUpdateResource(update, false)) throw new Win32Exception();
                committed = true;
            }
            finally { if (!committed) EndUpdateResource(update, true); }
        }

        public static bool IsEnabled(string path)
        {
            foreach (string manifest in Read(path).Values)
            {
                var xml = new XmlDocument { XmlResolver = null };
                xml.LoadXml(manifest);
                var execution = xml.SelectSingleNode("//*[local-name()='requestedExecutionLevel']") as XmlElement;
                if (execution == null || execution.GetAttribute("uiAccess") != "true" ||
                    execution.GetAttribute("level") != "asInvoker") return false;
            }
            return true;
        }
    }
}
