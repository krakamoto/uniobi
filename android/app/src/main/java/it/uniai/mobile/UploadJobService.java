package it.uniai.mobile;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class UploadJobService extends JobService {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile boolean running;

    @Override
    public boolean onStartJob(JobParameters params) {
        if (running) return true;
        running = true;
        UploadQueueStore.requeueUploading(getApplicationContext());
        executor.execute(() -> {
            boolean reschedule = false;
            boolean hardFailure = false;
            try {
                while (true) {
                    JSONObject item = UploadQueueStore.claimNext(getApplicationContext());
                    if (item == null) break;
                    try {
                        ApiResponse response = uploadItem(item);
                        if (response.code == 401) {
                            UploadQueueStore.markFailed(getApplicationContext(), item.optString("id"), "Sessione scaduta: accedi di nuovo nell'app.");
                            hardFailure = true;
                            break;
                        }
                        if (!response.isOk()) {
                            String message = response.errorMessage();
                            if (response.code >= 500 || response.code == 429) {
                                UploadQueueStore.markPending(getApplicationContext(), item.optString("id"), message);
                                reschedule = true;
                            } else {
                                UploadQueueStore.markFailed(getApplicationContext(), item.optString("id"), message);
                                hardFailure = true;
                            }
                            break;
                        }
                        UploadQueueStore.remove(getApplicationContext(), item.optString("id"));
                        UploadQueueStore.deleteLocalFiles(item);
                        notifyQueueChanged();
                    } catch (Exception error) {
                        UploadQueueStore.markPending(getApplicationContext(), item.optString("id"), safeMessage(error));
                        reschedule = true;
                        break;
                    }
                }
            } finally {
                if (!hardFailure && UploadQueueStore.pendingCount(getApplicationContext()) > 0 && !reschedule) reschedule = true;
                notifyQueueChanged();
                running = false;
                jobFinished(params, reschedule);
            }
        });
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }

    private ApiResponse uploadItem(JSONObject item) throws Exception {
        SharedPreferences prefs = getSharedPreferences("uniai", MODE_PRIVATE);
        ApiClient api = new ApiClient(prefs.getString("server_url", "http://10.0.2.2:3000"));
        api.setCookie(prefs.getString("session_cookie", ""));
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("course", item.optString("course", ""));
        fields.put("lesson_date", item.optString("lesson_date", ""));
        fields.put("title", item.optString("title", ""));
        fields.put("tags", item.optString("tags", ""));
        fields.put("user_notes", item.optString("user_notes", ""));

        JSONArray files = item.optJSONArray("files");
        if (files == null || files.length() == 0) throw new IOException("Nessuna immagine nella coda.");
        List<UploadPart> parts = new ArrayList<>();
        for (int i = 0; i < files.length(); i += 1) {
            JSONObject file = files.optJSONObject(i);
            if (file == null) continue;
            File local = new File(file.optString("path"));
            if (!local.exists()) throw new IOException("Immagine locale mancante: " + local.getName());
            parts.add(new UploadPart(Uri.fromFile(local), "image/jpeg", file.optString("name", local.getName())));
        }
        if (parts.isEmpty()) throw new IOException("Nessuna immagine valida nella coda.");
        return api.upload("/api/uploads", getContentResolver(), fields, parts);
    }

    private void notifyQueueChanged() {
        Intent intent = new Intent(UploadQueueStore.ACTION_QUEUE_UPDATED);
        intent.setPackage(getPackageName());
        sendBroadcast(intent);
    }

    private String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? "Errore di rete." : message;
    }
}
