package com.wayanime.app;

import android.net.Uri;
import android.os.Bundle;
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
            return super.shouldInterceptRequest(view, request);
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
