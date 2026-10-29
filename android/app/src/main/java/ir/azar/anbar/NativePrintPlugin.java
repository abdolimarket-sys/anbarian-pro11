package ir.azar.anbar;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativePrint")
public class NativePrintPlugin extends Plugin {
    private WebView printWebView;

    @PluginMethod
    public void printLabels(PluginCall call) {
        String html = call.getString("html", "");
        if (html == null || html.trim().isEmpty()) {
            call.reject("محتوای لیبل برای چاپ خالی است");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                printWebView = new WebView(getContext());
                printWebView.getSettings().setJavaScriptEnabled(false);
                printWebView.setBackgroundColor(android.graphics.Color.WHITE);
                printWebView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        super.onPageFinished(view, url);
                        try {
                            Context context = getContext();
                            PrintManager manager = (PrintManager) context.getSystemService(Context.PRINT_SERVICE);
                            if (manager == null) {
                                call.reject("سرویس چاپ اندروید در دسترس نیست");
                                cleanup();
                                return;
                            }
                            PrintAttributes attributes = new PrintAttributes.Builder()
                                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                .setResolution(new PrintAttributes.Resolution("anbarin", "Anbarin", 300, 300))
                                .setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME)
                                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                .build();
                            String jobName = "Anbarin-Labels";
                            manager.print(jobName, view.createPrintDocumentAdapter(jobName), attributes);
                            // نگه‌داشتن WebView تا زمانی که Android Print Framework محتوای آن را بخواند.
                            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> cleanup(), 120000);
                            JSObject result = new JSObject();
                            result.put("started", true);
                            call.resolve(result);
                        } catch (Exception e) {
                            call.reject("باز کردن پنجره چاپ ناموفق بود: " + e.getMessage(), e);
                        }
                    }
                });
                printWebView.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
            } catch (Exception e) {
                call.reject("آماده‌سازی چاپ ناموفق بود: " + e.getMessage(), e);
            }
        });
    }

    private void cleanup() {
        if (printWebView != null) {
            printWebView.destroy();
            printWebView = null;
        }
    }
}
