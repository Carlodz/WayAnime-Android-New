package com.wayanime.app;

import android.app.Dialog;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import org.json.JSONObject;
import org.json.JSONTokener;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * بروكسي محلي داخل الـ WebView:
 *   /_px/...?u=<رابط>&r=<referer>   فيديو (mp4 مع Range) و HLS (يُعاد كتابة الـ m3u8) مع Referer
 *   /_mgimg/?u=<رابط>               صور المانجا (Referer مانجا ليك عند الحاجة)
 * هذا ما كانت تفعله webRequest/protocol في Electron.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getBridge().setWebViewClient(new ProxyClient(getBridge()));
        getBridge().getWebView().addJavascriptInterface(new WaNative(), "WaNative");
    }

    /* ===== متصفح WebView حقيقي لمواقع Cloudflare (مثل مانجا ليك) =====
     * يفتح الصفحة كأي متصفح عادي ويقرأ الـ HTML بعد انتهاء فحص المتصفح التلقائي.
     * إذا طلب الموقع تحققاً يدوياً تظهر نافذة ليُكمله المستخدم بنفسه (verify). */
    static volatile String CF_UA = null;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private void deliver(String fn, String id, String payload) {
        final String js = "window." + fn + "(" + JSONObject.quote(id) + "," + JSONObject.quote(payload == null ? "" : payload) + ")";
        runOnUiThread(() -> getBridge().getWebView().evaluateJavascript(js, null));
    }

    private static String unquote(String v) {
        if (v == null || v.equals("null")) return "";
        try { Object o = new JSONTokener(v).nextValue(); return o instanceof String ? (String) o : ""; } catch (Exception e) { return ""; }
    }

    private void cfSettings(WebView w) {
        WebSettings st = w.getSettings();
        st.setJavaScriptEnabled(true);
        st.setDomStorageEnabled(true);
        CF_UA = st.getUserAgentString();
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true);
    }

    public class WaNative {
        @JavascriptInterface
        public void fetchHtml(final String id, final String url, final String post) {
            runOnUiThread(() -> new CfJob(id, url, post));
        }
        @JavascriptInterface
        public void verify(final String id, final String url) {
            runOnUiThread(() -> showVerify(id, url));
        }
    }

    public class CfJob {
        final String id, post;
        final WebView w;
        int tries = 0;
        boolean fin = false, posting = false;

        CfJob(String id, String url, String post) {
            this.id = id;
            this.post = post == null ? "" : post;
            w = new WebView(MainActivity.this);
            cfSettings(w);
            w.addJavascriptInterface(this, "WaSink");
            w.setWebViewClient(new WebViewClient());
            try {
                ViewGroup root = (ViewGroup) findViewById(android.R.id.content);
                w.setAlpha(0f);
                root.addView(w, new ViewGroup.LayoutParams(1, 1));
            } catch (Exception ignored) { }
            w.loadUrl(url);
            ui.postDelayed(this::tick, 1500);
        }

        void tick() {
            if (fin) return;
            if (++tries > 30) { finish(""); return; }
            w.evaluateJavascript("document.title", t -> {
                if (fin) return;
                String title = t == null ? "" : t.toLowerCase();
                boolean challenge = title.contains("just a moment") || title.contains("attention required")
                        || title.contains("checking") || title.contains("\u0644\u062d\u0638\u0629") || title.equals("null") || title.equals("\"\"");
                if (challenge) { ui.postDelayed(this::tick, 1000); return; }
                if (!post.isEmpty()) {
                    if (!posting) {
                        posting = true;
                        w.evaluateJavascript("fetch(" + JSONObject.quote(post) + ",{method:'POST',credentials:'include',headers:{'X-Requested-With':'XMLHttpRequest'}})"
                                + ".then(function(r){return r.text()}).then(function(x){WaSink.done(x)}).catch(function(){WaSink.done('')})", null);
                    }
                    return;
                }
                w.evaluateJavascript("document.documentElement.outerHTML", v -> finish(unquote(v)));
            });
        }

        @JavascriptInterface
        public void done(final String html) { ui.post(() -> finish(html)); }

        void finish(String html) {
            if (fin) return;
            fin = true;
            deliver("__waHtml", id, html);
            ui.post(() -> {
                try { ((ViewGroup) w.getParent()).removeView(w); } catch (Exception ignored) { }
                try { w.destroy(); } catch (Exception ignored) { }
            });
        }
    }

    private void showVerify(final String id, final String url) {
        final Dialog d = new Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        final WebView w = new WebView(this);
        cfSettings(w);
        w.setWebViewClient(new WebViewClient());
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        Button b = new Button(this);
        b.setText("\u062a\u0645 \u0627\u0644\u062a\u062d\u0642\u0642 \u2014 \u0645\u062a\u0627\u0628\u0639\u0629");
        b.setOnClickListener(v -> d.dismiss());
        col.addView(b, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        col.addView(w, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        d.setContentView(col);
        d.setOnDismissListener(x -> {
            try { w.destroy(); } catch (Exception ignored) { }
            deliver("__waVerified", id, "1");
        });
        d.show();
        w.loadUrl(url);
    }

    static class ProxyClient extends BridgeWebViewClient {
        private static final String UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

        ProxyClient(Bridge bridge) { super(bridge); }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String p = uri.getPath();
            if (p != null && (p.startsWith("/_px/") || p.startsWith("/_mgimg"))) {
                try {
                    return handle(request, uri, p.startsWith("/_mgimg"));
                } catch (Exception e) {
                    return error(502);
                }
            }
            try {
                WebResourceResponse fr = frameDoc(request, uri);
                if (fr != null) return fr;
            } catch (Exception ignored) { /* نرجع للتحميل الافتراضي */ }
            return super.shouldInterceptRequest(view, request);
        }

        /* صفحات iframe (سيرفرات المشاهدة): نحذف X-Frame-Options و frame-ancestors ونضبط Referer
         * مثل ما كان يفعل webRequest في نسخة الديسكتوب، وإلا ترفض المواقع العرض داخل التطبيق. */
        private WebResourceResponse frameDoc(WebResourceRequest req, Uri uri) throws Exception {
            if (req.isForMainFrame() || !"GET".equalsIgnoreCase(req.getMethod())) return null;
            String scheme = uri.getScheme();
            if (scheme == null || !(scheme.equals("https") || scheme.equals("http"))) return null;
            String h = uri.getHost();
            if (h == null || h.equals("localhost") || h.equals("127.0.0.1")) return null;
            Map<String, String> rh = req.getRequestHeaders();
            if (rh == null) return null;
            String dest = null, accept = null;
            for (Map.Entry<String, String> e : rh.entrySet()) {
                String k = e.getKey().toLowerCase();
                if (k.equals("sec-fetch-dest")) dest = e.getValue();
                else if (k.equals("accept")) accept = e.getValue();
            }
            boolean isFrame = dest != null ? (dest.equals("iframe") || dest.equals("frame"))
                    : (accept != null && accept.contains("text/html"));
            if (!isFrame) return null;

            URL cur = new URL(uri.toString());
            HttpURLConnection c = null;
            int code = 0;
            for (int hop = 0; hop < 6; hop++) {
                c = (HttpURLConnection) cur.openConnection();
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                for (Map.Entry<String, String> e : rh.entrySet()) {
                    String k = e.getKey().toLowerCase();
                    if (k.equals("referer") || k.equals("origin") || k.equals("cookie") || k.equals("range") || k.equals("x-requested-with") || k.equals("accept-encoding")) continue;
                    c.setRequestProperty(e.getKey(), e.getValue());
                }
                c.setRequestProperty("Referer", cur.getProtocol() + "://" + cur.getHost() + "/");
                String ck = CookieManager.getInstance().getCookie(cur.toString());
                if (ck != null && !ck.isEmpty()) c.setRequestProperty("Cookie", ck);
                code = c.getResponseCode();
                List<String> sc = c.getHeaderFields().get("Set-Cookie");
                if (sc != null) for (String one : sc) CookieManager.getInstance().setCookie(cur.toString(), one);
                if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                    cur = new URL(cur, c.getHeaderField("Location"));
                    c.disconnect();
                    continue;
                }
                break;
            }
            if (c == null || code < 100 || (code >= 300 && code < 400)) return null;

            String ct = c.getContentType();
            String mime = ct == null ? "text/html" : ct.split(";")[0].trim();
            String enc = null;
            if (ct != null) { Matcher m = Pattern.compile("charset=([\\w-]+)", Pattern.CASE_INSENSITIVE).matcher(ct); if (m.find()) enc = m.group(1); }
            Map<String, String> headers = new HashMap<>();
            for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                String k = e.getKey();
                if (k == null || e.getValue() == null || e.getValue().isEmpty()) continue;
                String l = k.toLowerCase();
                if (l.equals("x-frame-options") || l.equals("set-cookie") || l.equals("content-length") || l.equals("content-encoding")
                        || l.equals("transfer-encoding") || l.equals("content-type") || l.equals("content-security-policy-report-only")) continue;
                String v = android.text.TextUtils.join(", ", e.getValue());
                if (l.equals("content-security-policy")) {
                    v = v.replaceAll("(?i)frame-ancestors[^;]*;?", "");
                    if (v.trim().isEmpty()) continue;
                }
                headers.put(k, v);
            }
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in == null) in = new ByteArrayInputStream(new byte[0]);
            return new WebResourceResponse(mime, enc != null ? enc : (mime.startsWith("text/") ? "utf-8" : null), code, code < 400 ? "OK" : "Error", headers, in);
        }

        private WebResourceResponse error(int code) {
            return new WebResourceResponse("text/plain", "utf-8", code, "Error", new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
        }

        private static String wrap(String u, String ref) throws Exception {
            String kind = u.toLowerCase().contains(".m3u8") ? "stream.m3u8" : "seg.bin";
            return "/_px/" + kind + "?u=" + URLEncoder.encode(u, "UTF-8") + (ref == null || ref.isEmpty() ? "" : "&r=" + URLEncoder.encode(ref, "UTF-8"));
        }

        private static String rewriteM3u8(String text, URL base, String ref) throws Exception {
            StringBuilder sb = new StringBuilder();
            Pattern uriAttr = Pattern.compile("URI=\"([^\"]+)\"");
            for (String line : text.split("\n", -1)) {
                String t = line.trim();
                if (t.isEmpty()) { sb.append(line).append('\n'); continue; }
                if (t.startsWith("#")) {
                    Matcher m = uriAttr.matcher(t);
                    StringBuffer out = new StringBuffer();
                    while (m.find()) {
                        String abs = new URL(base, m.group(1)).toString();
                        m.appendReplacement(out, Matcher.quoteReplacement("URI=\"" + wrap(abs, ref) + "\""));
                    }
                    m.appendTail(out);
                    sb.append(out).append('\n');
                } else {
                    sb.append(wrap(new URL(base, t).toString(), ref)).append('\n');
                }
            }
            return sb.toString();
        }

        private WebResourceResponse handle(WebResourceRequest req, Uri uri, boolean image) throws Exception {
            String target = uri.getQueryParameter("u");
            String ref = uri.getQueryParameter("r");
            if (target == null || !(target.startsWith("https://") || target.startsWith("http://"))) return error(400);
            URL url = new URL(target);
            String host = url.getHost().toLowerCase();
            boolean md = host.equals("mangadex.org") || host.endsWith(".mangadex.org") || host.endsWith(".mangadex.network");
            String ua = UA;
            String cookie = null;
            if (image && !md) {
                if (CF_UA != null) ua = CF_UA;
                try { cookie = CookieManager.getInstance().getCookie(target); } catch (Exception ignored) { }
            }
            if (image) {
                if (md) { ua = "WayAnime/1.0"; ref = null; }
                else if (ref == null || ref.isEmpty()) ref = "https://mangalik.net/";
            }
            Map<String, String> rh = req.getRequestHeaders();
            String range = rh != null ? rh.get("Range") : null;

            int attempts = image ? 3 : 1;
            HttpURLConnection c = null;
            int code = 0;
            for (int a = 0; a < attempts; a++) {
                try {
                    URL cur = url;
                    for (int hop = 0; hop < 6; hop++) {
                        c = (HttpURLConnection) cur.openConnection();
                        c.setInstanceFollowRedirects(false);
                        c.setConnectTimeout(15000);
                        c.setReadTimeout(30000);
                        c.setRequestProperty("User-Agent", ua);
                        if (cookie != null && !cookie.isEmpty()) c.setRequestProperty("Cookie", cookie);
                        c.setRequestProperty("Accept", image ? "image/avif,image/webp,image/*,*/*" : "*/*");
                        if (ref != null && !ref.isEmpty()) {
                            c.setRequestProperty("Referer", ref);
                            try { URL r = new URL(ref); c.setRequestProperty("Origin", r.getProtocol() + "://" + r.getHost()); } catch (Exception ignored) {}
                        }
                        if (range != null) c.setRequestProperty("Range", range);
                        code = c.getResponseCode();
                        if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                            cur = new URL(cur, c.getHeaderField("Location"));
                            c.disconnect();
                            continue;
                        }
                        url = cur;
                        break;
                    }
                    if (code < 500 && code != 429) break;
                } catch (Exception e) {
                    if (a == attempts - 1) throw e;
                }
                try { Thread.sleep(600L * (a + 1)); } catch (InterruptedException ignored) {}
            }
            if (c == null) return error(502);

            String ct = c.getContentType();
            String mime = ct == null ? "application/octet-stream" : ct.split(";")[0].trim();
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            String[] pass = {"Content-Range", "Accept-Ranges", "Content-Length"};
            for (String h : pass) { String v = c.getHeaderField(h); if (v != null) headers.put(h, v); }
            if (image) headers.put("Cache-Control", "public, max-age=2592000");

            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in == null) in = new ByteArrayInputStream(new byte[0]);

            boolean isM3u8 = url.getPath().toLowerCase().endsWith(".m3u8") || mime.toLowerCase().contains("mpegurl");
            if (isM3u8 && code < 400) {
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[8192]; int n;
                while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                in.close();
                String out = rewriteM3u8(bo.toString("UTF-8"), url, ref);
                headers.remove("Content-Length"); headers.remove("Content-Range");
                return new WebResourceResponse("application/vnd.apple.mpegurl", "utf-8", 200, "OK", headers, new ByteArrayInputStream(out.getBytes("UTF-8")));
            }
            String reason = code == 206 ? "Partial Content" : (code >= 200 && code < 300 ? "OK" : "Error");
            if (code < 100 || (code >= 300 && code < 400)) code = 502;
            return new WebResourceResponse(mime, mime.startsWith("text/") ? "utf-8" : null, code, reason, headers, in);
        }
    }
}
