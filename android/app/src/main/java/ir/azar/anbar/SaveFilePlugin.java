package ir.azar.anbar;

import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import java.io.OutputStream;
import java.io.IOException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SaveFile")
public class SaveFilePlugin extends Plugin {
    private String pendingBase64;
    private String pendingFilename;
    @PluginMethod
    public void save(PluginCall call) {
        String filename = call.getString("filename", "anbarin-report.txt");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String base64 = call.getString("data", "");
        if (base64 == null || base64.isEmpty()) {
            call.reject("محتوای فایل خالی است");
            return;
        }
        pendingBase64 = base64;
        pendingFilename = filename;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "handleSaveResult");
    }

    @ActivityCallback
    private void handleSaveResult(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) {
            call.reject("محل ذخیره انتخاب نشد");
            return;
        }
        try {
            byte[] bytes = Base64.decode(pendingBase64, Base64.DEFAULT);
            try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "w")) {
                if (out == null) throw new IOException("امکان باز کردن فایل وجود ندارد");
                out.write(bytes);
                out.flush();
            }
            JSObject response = new JSObject();
            response.put("cancelled", false);
            response.put("uri", uri.toString());
            response.put("filename", pendingFilename);
            pendingBase64 = null;
            pendingFilename = null;
            call.resolve(response);
        } catch (Exception e) {
            call.reject("ذخیره فایل ناموفق بود: " + e.getMessage(), e);
        }
    }
}
