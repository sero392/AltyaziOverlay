// altyazi-ocr: Windows.Media.Ocr'ı Electron'a açan küçük yardımcı süreç.
//
// stdin  (ikili): [id:4 LE][genişlik:4 LE][yükseklik:4 LE][gri pikseller: genişlik*yükseklik]
// stdout (satır başına JSON):
//   {"ev":"ready","lang":"en-US","available":["tr"],"maxDim":2600}
//   {"id":7,"ms":42,"lines":[{"text":"...","x":10,"y":4,"w":300,"h":28}]}
//   {"id":7,"error":"..."}
// Argüman: --lang <etiket> (varsayılan en-US; kurulu değilse kullanıcı profil dilleri).

using System.Diagnostics;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text.Json;
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;

var stdout = new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true };
var input = Console.OpenStandardInput();

string requested = "en-US";
for (int i = 0; i < args.Length - 1; i++)
    if (args[i] == "--lang") requested = args[i + 1];

OcrEngine? engine = null;
try
{
    var lang = new Language(requested);
    if (OcrEngine.IsLanguageSupported(lang)) engine = OcrEngine.TryCreateFromLanguage(lang);
}
catch { }
engine ??= OcrEngine.TryCreateFromUserProfileLanguages();

var available = OcrEngine.AvailableRecognizerLanguages.Select(l => l.LanguageTag).ToArray();
stdout.WriteLine(JsonSerializer.Serialize(new
{
    ev = "ready",
    lang = engine?.RecognizerLanguage.LanguageTag,
    available,
    maxDim = OcrEngine.MaxImageDimension,
}));
if (engine == null) return 1;

var header = new byte[12];
while (true)
{
    if (!ReadExact(input, header, 12)) break;
    uint id = BitConverter.ToUInt32(header, 0);
    int w = (int)BitConverter.ToUInt32(header, 4);
    int h = (int)BitConverter.ToUInt32(header, 8);
    if (w <= 0 || h <= 0 || (long)w * h > 64L * 1024 * 1024) break;
    var gray = new byte[w * h];
    if (!ReadExact(input, gray, gray.Length)) break;

    var sw = Stopwatch.StartNew();
    try
    {
        // Gri -> BGRA (OcrEngine'in kesin desteklediği biçim).
        var bgra = new byte[w * h * 4];
        for (int i = 0, j = 0; i < gray.Length; i++, j += 4)
        {
            byte v = gray[i];
            bgra[j] = v; bgra[j + 1] = v; bgra[j + 2] = v; bgra[j + 3] = 255;
        }
        using var bitmap = SoftwareBitmap.CreateCopyFromBuffer(
            bgra.AsBuffer(), BitmapPixelFormat.Bgra8, w, h, BitmapAlphaMode.Premultiplied);
        var result = await engine.RecognizeAsync(bitmap);
        var lines = result.Lines.Select(line =>
        {
            double x0 = double.MaxValue, y0 = double.MaxValue, x1 = 0, y1 = 0;
            foreach (var word in line.Words)
            {
                var r = word.BoundingRect;
                x0 = Math.Min(x0, r.X); y0 = Math.Min(y0, r.Y);
                x1 = Math.Max(x1, r.X + r.Width); y1 = Math.Max(y1, r.Y + r.Height);
            }
            if (line.Words.Count == 0) { x0 = y0 = 0; }
            return new
            {
                text = line.Text,
                x = (int)x0,
                y = (int)y0,
                w = (int)(x1 - x0),
                h = (int)(y1 - y0),
            };
        }).ToArray();
        stdout.WriteLine(JsonSerializer.Serialize(new { id, ms = sw.ElapsedMilliseconds, lines }));
    }
    catch (Exception e)
    {
        stdout.WriteLine(JsonSerializer.Serialize(new { id, error = e.Message }));
    }
}
return 0;

static bool ReadExact(Stream s, byte[] buf, int count)
{
    int off = 0;
    while (off < count)
    {
        int n = s.Read(buf, off, count - off);
        if (n <= 0) return false;
        off += n;
    }
    return true;
}
