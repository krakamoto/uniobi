package it.uniai.mobile;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

final class UploadQueueStore {
    static final String ACTION_QUEUE_UPDATED = "it.uniai.mobile.QUEUE_UPDATED";
    private static final String PREFS = "uniai";
    private static final String KEY_QUEUE = "upload_queue_json";

    private UploadQueueStore() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized JSONArray read(Context context) {
        try {
            return new JSONArray(prefs(context).getString(KEY_QUEUE, "[]"));
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private static synchronized void write(Context context, JSONArray queue) {
        prefs(context).edit().putString(KEY_QUEUE, queue.toString()).apply();
    }

    static synchronized String enqueue(Context context, JSONObject item) {
        JSONArray queue = read(context);
        String id = UUID.randomUUID().toString();
        try {
            item.put("id", id);
            item.put("status", "pending");
            item.put("attempts", 0);
            item.put("createdAt", System.currentTimeMillis());
            queue.put(item);
            write(context, queue);
        } catch (Exception error) {
            throw new IllegalStateException("Impossibile accodare il caricamento.", error);
        }
        return id;
    }

    static synchronized JSONObject claimNext(Context context) {
        JSONArray queue = read(context);
        for (int i = 0; i < queue.length(); i += 1) {
            JSONObject item = queue.optJSONObject(i);
            if (item == null) continue;
            if ("pending".equals(item.optString("status"))) {
                try {
                    item.put("status", "uploading");
                    write(context, queue);
                } catch (Exception ignored) {
                }
                return item;
            }
        }
        return null;
    }

    static synchronized void markPending(Context context, String id, String error) {
        update(context, id, item -> {
            try {
                item.put("status", "pending");
                item.put("error", error == null ? "" : error);
                item.put("attempts", item.optInt("attempts", 0) + 1);
            } catch (Exception ignored) {
            }
        });
    }

    static synchronized void markFailed(Context context, String id, String error) {
        update(context, id, item -> {
            try {
                item.put("status", "failed");
                item.put("error", error == null ? "" : error);
                item.put("attempts", item.optInt("attempts", 0) + 1);
            } catch (Exception ignored) {
            }
        });
    }

    static synchronized void remove(Context context, String id) {
        JSONArray queue = read(context);
        JSONArray next = new JSONArray();
        for (int i = 0; i < queue.length(); i += 1) {
            JSONObject item = queue.optJSONObject(i);
            if (item != null && !id.equals(item.optString("id"))) next.put(item);
        }
        write(context, next);
    }

    static synchronized void requeueUploading(Context context) {
        JSONArray queue = read(context);
        for (int i = 0; i < queue.length(); i += 1) {
            JSONObject item = queue.optJSONObject(i);
            if (item != null && "uploading".equals(item.optString("status"))) {
                try {
                    item.put("status", "pending");
                } catch (Exception ignored) {
                }
            }
        }
        write(context, queue);
    }

    static synchronized void retryItem(Context context, String id) {
        update(context, id, item -> {
            try {
                item.put("status", "pending");
                item.put("error", "");
            } catch (Exception ignored) {
            }
        });
    }

    static synchronized void deleteItem(Context context, String id) {
        JSONArray queue = read(context);
        JSONArray next = new JSONArray();
        for (int i = 0; i < queue.length(); i += 1) {
            JSONObject item = queue.optJSONObject(i);
            if (item != null && id.equals(item.optString("id"))) {
                deleteLocalFiles(item);
            } else if (item != null) {
                next.put(item);
            }
        }
        write(context, next);
    }

    static synchronized void retryFailed(Context context) {
        JSONArray queue = read(context);
        for (int i = 0; i < queue.length(); i += 1) {
            JSONObject item = queue.optJSONObject(i);
            if (item != null && "failed".equals(item.optString("status"))) {
                try {
                    item.put("status", "pending");
                    item.put("error", "");
                } catch (Exception ignored) {
                }
            }
        }
        write(context, queue);
    }

    static synchronized int pendingCount(Context context) {
        JSONArray queue = read(context);
        int count = 0;
        for (int i = 0; i < queue.length(); i += 1) {
            JSONObject item = queue.optJSONObject(i);
            if (item != null && ("pending".equals(item.optString("status")) || "uploading".equals(item.optString("status")))) count += 1;
        }
        return count;
    }

    static synchronized int failedCount(Context context) {
        JSONArray queue = read(context);
        int count = 0;
        for (int i = 0; i < queue.length(); i += 1) {
            JSONObject item = queue.optJSONObject(i);
            if (item != null && "failed".equals(item.optString("status"))) count += 1;
        }
        return count;
    }

    static synchronized String lastError(Context context) {
        JSONArray queue = read(context);
        for (int i = queue.length() - 1; i >= 0; i -= 1) {
            JSONObject item = queue.optJSONObject(i);
            if (item != null && "failed".equals(item.optString("status"))) {
                String error = item.optString("error", "");
                if (!error.isEmpty()) return error;
            }
        }
        return "";
    }

    static synchronized void deleteLocalFiles(JSONObject item) {
        JSONArray files = item == null ? null : item.optJSONArray("files");
        if (files == null) return;
        for (int i = 0; i < files.length(); i += 1) {
            JSONObject file = files.optJSONObject(i);
            if (file == null) continue;
            File local = new File(file.optString("path"));
            if (local.exists()) local.delete();
            File parent = local.getParentFile();
            if (parent != null && parent.isDirectory()) {
                String[] remaining = parent.list();
                if (remaining != null && remaining.length == 0) parent.delete();
            }
        }
    }

    static synchronized List<File> queuedFiles(Context context) {
        List<File> files = new ArrayList<>();
        JSONArray queue = read(context);
        for (int i = 0; i < queue.length(); i += 1) {
            JSONObject item = queue.optJSONObject(i);
            if (item == null) continue;
            JSONArray itemFiles = item.optJSONArray("files");
            if (itemFiles == null) continue;
            for (int j = 0; j < itemFiles.length(); j += 1) {
                JSONObject file = itemFiles.optJSONObject(j);
                if (file != null) files.add(new File(file.optString("path")));
            }
        }
        return files;
    }

    private static void update(Context context, String id, ItemUpdater updater) {
        JSONArray queue = read(context);
        for (int i = 0; i < queue.length(); i += 1) {
            JSONObject item = queue.optJSONObject(i);
            if (item != null && id.equals(item.optString("id"))) {
                updater.update(item);
                break;
            }
        }
        write(context, queue);
    }

    private interface ItemUpdater {
        void update(JSONObject item);
    }
}
