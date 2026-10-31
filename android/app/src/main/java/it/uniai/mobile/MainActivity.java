package it.uniai.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int REQUEST_PICK_IMAGES = 4001;
    private static final int REQUEST_CAMERA = 4002;
    private static final int PRIMARY = Color.rgb(91, 75, 219);
    private static final int PRIMARY_DARK = Color.rgb(68, 54, 184);
    private static final int TEXT = Color.rgb(23, 21, 42);
    private static final int MUTED = Color.rgb(104, 100, 126);
    private static final int SUCCESS = Color.rgb(17, 122, 85);
    private static final int WARNING = Color.rgb(162, 100, 0);
    private static final int DANGER = Color.rgb(179, 52, 79);
    private static final int BG = Color.rgb(247, 245, 252);

    private final List<UploadPart> selectedFiles = new ArrayList<>();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());

    private SharedPreferences prefs;
    private ApiClient api;
    private Uri cameraOutputUri;

    private EditText serverUrlInput;
    private EditText passwordInput;
    private EditText courseInput;
    private EditText dateInput;
    private EditText titleInput;
    private EditText tagsInput;
    private EditText notesInput;
    private LinearLayout loginCard;
    private LinearLayout selectedContainer;
    private LinearLayout historyContainer;
    private TextView historyStatus;
    private TextView uploadStatus;
    private Button uploadButton;
    private ProgressBar uploadProgress;
    private boolean passwordRequired;
    private boolean authenticated = true;
    private boolean creatingCameraFile;

    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            loadJobs(true);
            handler.postDelayed(this, 6000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("uniai", Context.MODE_PRIVATE);
        api = new ApiClient(prefs.getString("server_url", "http://10.0.2.2:3000"));
        api.setCookie(prefs.getString("session_cookie", ""));
        buildUi();
        checkServerAndAuth();
    }

    @Override
    protected void onResume() {
        super.onResume();
        handler.removeCallbacks(pollRunnable);
        handler.postDelayed(pollRunnable, 6000);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(pollRunnable);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private void buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(18), dp(18), dp(32));
        scroll.addView(root, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView overline = text("APPUNTI → OBSIDIAN", 11, PRIMARY, Typeface.BOLD);
        overline.setLetterSpacing(0.12f);
        root.addView(overline);

        TextView title = text("UniAi Mobile", 31, TEXT, Typeface.BOLD);
        title.setPadding(0, dp(3), 0, 0);
        root.addView(title);

        TextView subtitle = text("Fotografa gli appunti, caricali sul server e trasformali in note Obsidian con Gemini.", 14, MUTED, Typeface.NORMAL);
        subtitle.setPadding(0, dp(6), 0, dp(18));
        root.addView(subtitle);

        root.addView(serverCard(), matchTop(dp(10)));

        loginCard = loginCard();
        loginCard.setVisibility(View.GONE);
        root.addView(loginCard, matchTop(dp(12)));

        root.addView(uploadCard(), matchTop(dp(14)));

        LinearLayout historyHeader = new LinearLayout(this);
        historyHeader.setOrientation(LinearLayout.HORIZONTAL);
        historyHeader.setGravity(Gravity.CENTER_VERTICAL);
        TextView historyTitle = text("Le tue elaborazioni", 22, TEXT, Typeface.BOLD);
        historyHeader.addView(historyTitle, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button refresh = smallButton("Aggiorna");
        refresh.setOnClickListener(view -> loadJobs(false));
        historyHeader.addView(refresh);
        root.addView(historyHeader, matchTop(dp(26)));

        historyStatus = text("", 12, MUTED, Typeface.NORMAL);
        root.addView(historyStatus, matchTop(dp(6)));

        historyContainer = new LinearLayout(this);
        historyContainer.setOrientation(LinearLayout.VERTICAL);
        root.addView(historyContainer, matchTop(dp(8)));

        setContentView(scroll);
    }

    private View serverCard() {
        LinearLayout card = card();
        card.addView(text("Server UniAi", 17, TEXT, Typeface.BOLD));
        card.addView(text("Usa 10.0.2.2:3000 dall'emulatore, oppure l'IP LAN del server dal telefono.", 12, MUTED, Typeface.NORMAL), matchTop(dp(4)));

        serverUrlInput = editText("http://10.0.2.2:3000", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        serverUrlInput.setText(api.getBaseUrl());
        card.addView(serverUrlInput, matchTop(dp(12)));

        Button connect = primaryButton("Salva e connetti");
        connect.setOnClickListener(view -> saveServerAndConnect());
        card.addView(connect, matchTop(dp(10)));
        return card;
    }

    private LinearLayout loginCard() {
        LinearLayout card = card();
        card.addView(text("Accesso richiesto", 17, TEXT, Typeface.BOLD));
        card.addView(text("Inserisci la password configurata nel backend.", 12, MUTED, Typeface.NORMAL), matchTop(dp(4)));
        passwordInput = editText("Password", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        card.addView(passwordInput, matchTop(dp(12)));
        Button login = primaryButton("Accedi");
        login.setOnClickListener(view -> login());
        card.addView(login, matchTop(dp(10)));
        return card;
    }

    private View uploadCard() {
        LinearLayout card = card();
        card.addView(text("Nuova lezione", 20, TEXT, Typeface.BOLD));
        card.addView(text("Seleziona o scatta fino a 10 foto. Verranno caricate tutte in una sola elaborazione.", 12, MUTED, Typeface.NORMAL), matchTop(dp(4)));

        LinearLayout sourceButtons = new LinearLayout(this);
        sourceButtons.setOrientation(LinearLayout.HORIZONTAL);
        sourceButtons.setPadding(0, dp(12), 0, 0);
        Button gallery = secondaryButton("Galleria");
        gallery.setOnClickListener(view -> pickImages());
        sourceButtons.addView(gallery, weighted());
        Button camera = secondaryButton("Scatta foto");
        camera.setOnClickListener(view -> takePhoto());
        sourceButtons.addView(camera, weightedWithStart(dp(8)));
        card.addView(sourceButtons);

        selectedContainer = new LinearLayout(this);
        selectedContainer.setOrientation(LinearLayout.HORIZONTAL);
        selectedContainer.setGravity(Gravity.CENTER_VERTICAL);
        HorizontalScrollView previewScroll = new HorizontalScrollView(this);
        previewScroll.setHorizontalScrollBarEnabled(false);
        previewScroll.addView(selectedContainer);
        card.addView(previewScroll, matchTop(dp(10)));
        renderSelectedFiles();

        courseInput = editText("Es. Analisi Matematica II", InputType.TYPE_CLASS_TEXT);
        card.addView(field("Corso", courseInput), matchTop(dp(12)));

        dateInput = editText("AAAA-MM-GG", InputType.TYPE_CLASS_DATETIME);
        dateInput.setFocusable(false);
        dateInput.setClickable(true);
        dateInput.setOnClickListener(view -> chooseDate());
        card.addView(field("Data lezione", dateInput), matchTop(dp(10)));

        titleInput = editText("Es. Integrali doppi", InputType.TYPE_CLASS_TEXT);
        card.addView(field("Titolo (opzionale)", titleInput), matchTop(dp(10)));

        tagsInput = editText("es. integrali, esercizi", InputType.TYPE_CLASS_TEXT);
        card.addView(field("Tag", tagsInput), matchTop(dp(10)));

        notesInput = editText("Istruzioni per l'AI: mantieni le formule, evidenzia le definizioni…", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        notesInput.setMinLines(2);
        notesInput.setGravity(Gravity.TOP);
        card.addView(field("Istruzioni per l'AI", notesInput), matchTop(dp(10)));

        LinearLayout actionRow = new LinearLayout(this);
        actionRow.setOrientation(LinearLayout.HORIZONTAL);
        actionRow.setGravity(Gravity.CENTER_VERTICAL);
        uploadButton = primaryButton("Carica e analizza");
        uploadButton.setOnClickListener(view -> uploadNotes());
        actionRow.addView(uploadButton, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        uploadProgress = new ProgressBar(this);
        uploadProgress.setVisibility(View.GONE);
        actionRow.addView(uploadProgress, new LinearLayout.LayoutParams(dp(34), dp(34)));
        card.addView(actionRow, matchTop(dp(16)));

        uploadStatus = text("", 12, MUTED, Typeface.NORMAL);
        card.addView(uploadStatus, matchTop(dp(6)));
        return card;
    }

    private void renderSelectedFiles() {
        if (selectedContainer == null) return;
        selectedContainer.removeAllViews();
        if (selectedFiles.isEmpty()) {
            TextView empty = text("Nessuna immagine selezionata.", 12, MUTED, Typeface.NORMAL);
            empty.setPadding(dp(2), dp(8), dp(2), dp(8));
            selectedContainer.addView(empty);
            return;
        }

        for (int index = 0; index < selectedFiles.size(); index++) {
            UploadPart part = selectedFiles.get(index);
            FrameLayout frame = new FrameLayout(this);
            LinearLayout.LayoutParams frameParams = new LinearLayout.LayoutParams(dp(88), dp(88));
            if (index > 0) frameParams.setMarginStart(dp(8));
            frame.setLayoutParams(frameParams);

            ImageView image = new ImageView(this);
            image.setScaleType(ImageView.ScaleType.CENTER_CROP);
            image.setBackgroundColor(Color.rgb(238, 235, 248));
            try {
                image.setImageURI(part.uri);
            } catch (Exception ignored) {
            }
            frame.addView(image, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

            TextView remove = text("×", 18, Color.WHITE, Typeface.BOLD);
            remove.setGravity(Gravity.CENTER);
            GradientDrawable removeBg = new GradientDrawable();
            removeBg.setColor(Color.argb(190, 20, 16, 45));
            removeBg.setCornerRadius(dp(12));
            remove.setBackground(removeBg);
            FrameLayout.LayoutParams removeParams = new FrameLayout.LayoutParams(dp(24), dp(24), Gravity.TOP | Gravity.END);
            removeParams.setMargins(0, dp(4), dp(4), 0);
            final int removeIndex = index;
            remove.setOnClickListener(view -> {
                selectedFiles.remove(removeIndex);
                renderSelectedFiles();
            });
            frame.addView(remove, removeParams);
            selectedContainer.addView(frame);
        }
    }

    private void saveServerAndConnect() {
        String value = serverUrlInput.getText().toString().trim();
        if (value.isEmpty()) {
            toast("Inserisci l'URL del server.");
            return;
        }
        api.setBaseUrl(value);
        api.clearCookie();
        prefs.edit()
            .putString("server_url", api.getBaseUrl())
            .remove("session_cookie")
            .apply();
        serverUrlInput.setText(api.getBaseUrl());
        checkServerAndAuth();
    }

    private void checkServerAndAuth() {
        uploadStatus.setText("Connessione al server…");
        executor.execute(() -> {
            try {
                ApiResponse response = api.get("/api/auth/status");
                if (!response.isOk()) throw new IOException(response.errorMessage());
                JSONObject status = new JSONObject(response.body);
                passwordRequired = status.optBoolean("passwordRequired", false);
                authenticated = status.optBoolean("authenticated", !passwordRequired);
                runOnUiThread(() -> {
                    uploadStatus.setText(authenticated ? "Server connesso." : "Server connesso, accesso richiesto.");
                    loginCard.setVisibility(passwordRequired && !authenticated ? View.VISIBLE : View.GONE);
                    if (authenticated) loadJobs(true);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    uploadStatus.setText("Server non raggiungibile: " + safeMessage(error));
                    toast("Controlla l'URL del server e la rete.");
                });
            }
        });
    }

    private void login() {
        String password = passwordInput.getText().toString();
        if (password.isEmpty()) {
            toast("Inserisci la password.");
            return;
        }
        executor.execute(() -> {
            try {
                JSONObject payload = new JSONObject().put("password", password);
                ApiResponse response = api.postJson("/api/login", payload.toString());
                if (!response.isOk()) throw new IOException(response.errorMessage());
                if (!api.getCookie().isEmpty()) {
                    prefs.edit().putString("session_cookie", api.getCookie()).apply();
                }
                runOnUiThread(() -> {
                    passwordInput.setText("");
                    loginCard.setVisibility(View.GONE);
                    authenticated = true;
                    toast("Accesso effettuato.");
                    checkServerAndAuth();
                });
            } catch (Exception error) {
                runOnUiThread(() -> toast(safeMessage(error)));
            }
        });
    }

    private void pickImages() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        try {
            startActivityForResult(intent, REQUEST_PICK_IMAGES);
        } catch (ActivityNotFoundException error) {
            toast("Nessuna app per scegliere immagini disponibile.");
        }
    }

    private void takePhoto() {
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, "uniai_" + System.currentTimeMillis() + ".jpg");
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            cameraOutputUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (cameraOutputUri == null) throw new IOException("Impossibile creare il file della fotocamera.");
            creatingCameraFile = true;
            intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutputUri);
            startActivityForResult(intent, REQUEST_CAMERA);
        } catch (ActivityNotFoundException error) {
            cleanupCameraUri();
            toast("Nessuna fotocamera disponibile.");
        } catch (Exception error) {
            cleanupCameraUri();
            toast(safeMessage(error));
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_CAMERA) {
            if (resultCode == RESULT_OK && cameraOutputUri != null) {
                addSelectedUri(cameraOutputUri);
            } else {
                cleanupCameraUri();
            }
            cameraOutputUri = null;
            creatingCameraFile = false;
            return;
        }
        if (requestCode == REQUEST_PICK_IMAGES && resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                    addSelectedUri(data.getClipData().getItemAt(i).getUri());
                }
            } else if (data.getData() != null) {
                addSelectedUri(data.getData());
            }
        }
    }

    private void addSelectedUri(Uri uri) {
        if (uri == null) return;
        if (selectedFiles.size() >= 10) {
            toast("Puoi caricare al massimo 10 immagini per volta.");
            return;
        }
        ContentResolver resolver = getContentResolver();
        String mime = resolver.getType(uri);
        String name = ApiClient.displayName(resolver, uri);
        selectedFiles.add(new UploadPart(uri, mime == null ? "image/jpeg" : mime, name));
        renderSelectedFiles();
    }

    private void cleanupCameraUri() {
        if (cameraOutputUri == null) return;
        try {
            getContentResolver().delete(cameraOutputUri, null, null);
        } catch (Exception ignored) {
        }
        cameraOutputUri = null;
    }

    private void chooseDate() {
        Calendar calendar = Calendar.getInstance();
        String current = dateInput.getText().toString().trim();
        try {
            Date parsed = new SimpleDateFormat("yyyy-MM-dd", Locale.ITALY).parse(current);
            if (parsed != null) calendar.setTime(parsed);
        } catch (Exception ignored) {
        }
        DatePickerDialog dialog = new DatePickerDialog(this, (view, year, month, day) -> {
            dateInput.setText(String.format(Locale.ITALY, "%04d-%02d-%02d", year, month + 1, day));
        }, calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH), calendar.get(Calendar.DAY_OF_MONTH));
        dialog.show();
    }

    private void uploadNotes() {
        if (selectedFiles.isEmpty()) {
            toast("Seleziona almeno una foto degli appunti.");
            return;
        }
        if (!authenticated && passwordRequired) {
            toast("Accedi prima di caricare gli appunti.");
            loginCard.setVisibility(View.VISIBLE);
            return;
        }
        List<UploadPart> files = new ArrayList<>(selectedFiles);
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("course", courseInput.getText().toString().trim());
        fields.put("lesson_date", dateInput.getText().toString().trim());
        fields.put("title", titleInput.getText().toString().trim());
        fields.put("tags", tagsInput.getText().toString().trim());
        fields.put("user_notes", notesInput.getText().toString().trim());

        uploadButton.setEnabled(false);
        uploadProgress.setVisibility(View.VISIBLE);
        uploadStatus.setText("Caricamento di " + files.size() + (files.size() == 1 ? " immagine…" : " immagini…"));

        executor.execute(() -> {
            try {
                ApiResponse response = api.upload("/api/uploads", getContentResolver(), fields, files);
                if (response.code == 401) {
                    runOnUiThread(() -> {
                        authenticated = false;
                        loginCard.setVisibility(View.VISIBLE);
                        toast("Sessione scaduta: effettua di nuovo l'accesso.");
                    });
                    return;
                }
                if (!response.isOk()) throw new IOException(response.errorMessage());
                JSONObject payload = new JSONObject(response.body);
                String jobId = payload.optJSONObject("job") == null ? "" : payload.getJSONObject("job").optString("id");
                runOnUiThread(() -> {
                    selectedFiles.clear();
                    renderSelectedFiles();
                    courseInput.setText("");
                    dateInput.setText("");
                    titleInput.setText("");
                    tagsInput.setText("");
                    notesInput.setText("");
                    uploadStatus.setText("Elaborazione avviata. La nota apparirà nello storico.");
                    toast("Caricamento completato: analisi avviata.");
                    loadJobs(true);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    uploadStatus.setText("Errore: " + safeMessage(error));
                    toast(safeMessage(error));
                });
            } finally {
                runOnUiThread(() -> {
                    uploadButton.setEnabled(true);
                    uploadProgress.setVisibility(View.GONE);
                });
            }
        });
    }

    private void loadJobs(boolean silent) {
        if (!authenticated && passwordRequired) return;
        executor.execute(() -> {
            try {
                ApiResponse response = api.get("/api/jobs?limit=30");
                if (response.code == 401) {
                    runOnUiThread(() -> {
                        authenticated = false;
                        loginCard.setVisibility(View.VISIBLE);
                    });
                    return;
                }
                if (!response.isOk()) throw new IOException(response.errorMessage());
                JSONObject payload = new JSONObject(response.body);
                JSONArray rows = payload.optJSONArray("rows");
                runOnUiThread(() -> renderJobs(rows));
            } catch (Exception error) {
                if (!silent) runOnUiThread(() -> toast(safeMessage(error)));
                runOnUiThread(() -> historyStatus.setText("Storico non disponibile: " + safeMessage(error)));
            }
        });
    }

    private void renderJobs(JSONArray rows) {
        historyContainer.removeAllViews();
        historyStatus.setText(rows == null || rows.length() == 0 ? "Nessuna elaborazione. Carica i tuoi primi appunti." : rows.length() + " elaborazioni");
        if (rows == null) return;

        for (int i = 0; i < rows.length(); i++) {
            JSONObject job = rows.optJSONObject(i);
            if (job == null) continue;
            LinearLayout row = card();
            row.setPadding(dp(15), dp(14), dp(15), dp(14));
            row.setClickable(true);
            row.setFocusable(true);

            LinearLayout top = new LinearLayout(this);
            top.setOrientation(LinearLayout.HORIZONTAL);
            top.setGravity(Gravity.CENTER_VERTICAL);

            String jobTitle = firstNonEmpty(job.optString("result_title"), job.optString("requested_title"), job.optString("course"), "Elaborazione senza titolo");
            TextView name = text(jobTitle, 16, TEXT, Typeface.BOLD);
            top.addView(name, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            String status = job.optString("status", "uploaded");
            TextView badge = badge(statusLabel(status), statusColor(status), statusBackground(status));
            top.addView(badge);
            row.addView(top);

            String course = job.optString("course", "");
            String date = job.optString("lesson_date", "");
            String meta = (course.isEmpty() ? "Corso non indicato" : course) + (date.isEmpty() ? "" : " · " + date);
            row.addView(text(meta, 12, MUTED, Typeface.NORMAL), matchTop(dp(5)));
            String error = job.optString("error", "");
            if (!error.isEmpty()) row.addView(text(error, 12, DANGER, Typeface.NORMAL), matchTop(dp(5)));

            String id = job.optString("id", "");
            row.setOnClickListener(view -> openJob(id));
            historyContainer.addView(row, matchTop(dp(9)));
        }
    }

    private void openJob(String jobId) {
        if (jobId.isEmpty()) return;
        toast("Caricamento dettaglio…");
        executor.execute(() -> {
            try {
                ApiResponse response = api.get("/api/jobs/" + jobId);
                if (response.code == 401) {
                    runOnUiThread(() -> {
                        authenticated = false;
                        loginCard.setVisibility(View.VISIBLE);
                    });
                    return;
                }
                if (!response.isOk()) throw new IOException(response.errorMessage());
                JSONObject payload = new JSONObject(response.body);
                JSONObject job = payload.getJSONObject("job");
                runOnUiThread(() -> showJobDialog(job));
            } catch (Exception error) {
                runOnUiThread(() -> toast(safeMessage(error)));
            }
        });
    }

    private void showJobDialog(JSONObject job) {
        String id = job.optString("id", "");
        String status = job.optString("status", "");
        String title = firstNonEmpty(job.optString("requested_title"), job.optString("course"), "Dettaglio elaborazione");

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(20), dp(12), dp(20), dp(12));

        TextView statusView = badge(statusLabel(status), statusColor(status), statusBackground(status));
        content.addView(statusView);

        content.addView(text(firstNonEmpty(job.optString("course", ""), "Corso non indicato"), 16, TEXT, Typeface.BOLD), matchTop(dp(10)));
        content.addView(text("Data: " + firstNonEmpty(job.optString("lesson_date", ""), "non indicata"), 12, MUTED, Typeface.NORMAL), matchTop(dp(4)));

        String error = job.optString("error", "");
        if (!error.isEmpty()) {
            TextView errorView = text(error, 13, DANGER, Typeface.NORMAL);
            errorView.setBackgroundColor(Color.rgb(255, 233, 238));
            errorView.setPadding(dp(10), dp(10), dp(10), dp(10));
            content.addView(errorView, matchTop(dp(10)));
        }

        JSONArray warnings = job.optJSONArray("warnings_json");
        if (warnings != null && warnings.length() > 0) {
            StringBuilder warningText = new StringBuilder("Da verificare:\n");
            for (int i = 0; i < warnings.length(); i++) warningText.append("• ").append(warnings.optString(i)).append("\n");
            TextView warningView = text(warningText.toString().trim(), 12, WARNING, Typeface.NORMAL);
            warningView.setBackgroundColor(Color.rgb(255, 244, 216));
            warningView.setPadding(dp(10), dp(10), dp(10), dp(10));
            content.addView(warningView, matchTop(dp(10)));
        }

        JSONArray links = job.optJSONArray("links_json");
        if (links != null && links.length() > 0) {
            StringBuilder linkText = new StringBuilder("Wikilink verificati:\n");
            for (int i = 0; i < links.length(); i++) {
                JSONObject link = links.optJSONObject(i);
                if (link == null) continue;
                linkText.append("[[")
                    .append(link.optString("target"))
                    .append("]]")
                    .append(link.optBoolean("exists", false) ? "" : " · da creare")
                    .append("\n");
            }
            content.addView(text(linkText.toString().trim(), 13, PRIMARY_DARK, Typeface.NORMAL), matchTop(dp(10)));
        }

        String markdown = job.optString("markdown", "");
        EditText editor = null;
        if (!markdown.isEmpty()) {
            content.addView(text("Markdown modificabile", 13, TEXT, Typeface.BOLD), matchTop(dp(14)));
            editor = new EditText(this);
            editor.setText(markdown);
            editor.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            editor.setTypeface(Typeface.MONOSPACE);
            editor.setGravity(Gravity.TOP);
            editor.setMinLines(12);
            editor.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
            editor.setBackgroundColor(Color.WHITE);
            editor.setPadding(dp(10), dp(10), dp(10), dp(10));
            content.addView(editor, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(300)));

            content.addView(text("Anteprima", 13, TEXT, Typeface.BOLD), matchTop(dp(12)));
            TextView preview = text(simpleMarkdownPreview(markdown), 13, TEXT, Typeface.NORMAL);
            preview.setBackgroundColor(Color.WHITE);
            preview.setPadding(dp(10), dp(10), dp(10), dp(10));
            content.addView(preview, matchTop(dp(6)));
        }

        ScrollView dialogScroll = new ScrollView(this);
        dialogScroll.addView(content);

        AlertDialog.Builder builder = new AlertDialog.Builder(this)
            .setTitle(title)
            .setView(dialogScroll)
            .setNegativeButton("Chiudi", null);

        final EditText editorFinal = editor;
        if ("failed".equals(status)) {
            builder.setPositiveButton("Riprova", (dialog, which) -> retryJob(id));
        } else if ("completed".equals(status)) {
            builder.setPositiveButton("Salva nel vault", (dialog, which) -> saveJobToVault(id, editorFinal));
            builder.setNeutralButton("Salva modifiche", (dialog, which) -> saveMarkdown(id, editorFinal));
        }

        builder.show();
    }

    private void saveMarkdown(String jobId, EditText editor) {
        if (editor == null) return;
        String markdown = editor.getText().toString();
        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject().put("markdown", markdown);
                ApiResponse response = api.putJson("/api/jobs/" + jobId + "/markdown", body.toString());
                if (!response.isOk()) throw new IOException(response.errorMessage());
                runOnUiThread(() -> toast("Modifiche al Markdown salvate."));
            } catch (Exception error) {
                runOnUiThread(() -> toast(safeMessage(error)));
            }
        });
    }

    private void saveJobToVault(String jobId, EditText editor) {
        String markdown = editor == null ? null : editor.getText().toString();
        executor.execute(() -> {
            try {
                if (markdown != null && !markdown.isEmpty()) {
                    JSONObject body = new JSONObject().put("markdown", markdown);
                    ApiResponse update = api.putJson("/api/jobs/" + jobId + "/markdown", body.toString());
                    if (!update.isOk()) throw new IOException(update.errorMessage());
                }
                ApiResponse response = api.postJson("/api/jobs/" + jobId + "/save-to-vault", "{}");
                if (!response.isOk()) throw new IOException(response.errorMessage());
                JSONObject payload = new JSONObject(response.body);
                String vaultPath = payload.optString("vaultPath", "");
                runOnUiThread(() -> {
                    toast("Nota salvata: " + vaultPath);
                    loadJobs(true);
                });
            } catch (Exception error) {
                runOnUiThread(() -> toast(safeMessage(error)));
            }
        });
    }

    private void retryJob(String jobId) {
        executor.execute(() -> {
            try {
                ApiResponse response = api.postJson("/api/jobs/" + jobId + "/retry", "{}");
                if (!response.isOk()) throw new IOException(response.errorMessage());
                runOnUiThread(() -> {
                    toast("Elaborazione riavviata.");
                    loadJobs(true);
                });
            } catch (Exception error) {
                runOnUiThread(() -> toast(safeMessage(error)));
            }
        });
    }

    private LinearLayout card() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(16), dp(16), dp(16), dp(16));
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.WHITE);
        background.setCornerRadius(dp(18));
        background.setStroke(dp(1), Color.argb(24, 36, 30, 80));
        layout.setBackground(background);
        layout.setElevation(dp(2));
        return layout;
    }

    private LinearLayout field(String label, EditText input) {
        LinearLayout field = new LinearLayout(this);
        field.setOrientation(LinearLayout.VERTICAL);
        TextView labelView = text(label, 12, Color.rgb(62, 57, 82), Typeface.BOLD);
        field.addView(labelView);
        field.addView(input, matchTop(dp(6)));
        return field;
    }

    private EditText editText(String hint, int inputType) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        input.setInputType(inputType);
        input.setSingleLine(!((inputType & InputType.TYPE_TEXT_FLAG_MULTI_LINE) != 0));
        input.setBackgroundColor(Color.rgb(252, 251, 255));
        input.setPadding(dp(11), dp(10), dp(11), dp(10));
        return input;
    }

    private TextView text(String value, int sizeSp, int color, int style) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
        view.setTextColor(color);
        view.setTypeface(Typeface.create("sans-serif", style));
        view.setLineSpacing(dp(1), 1f);
        return view;
    }

    private TextView badge(String label, int color, int background) {
        TextView view = text(label, 11, color, Typeface.BOLD);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(background);
        bg.setCornerRadius(dp(20));
        view.setBackground(bg);
        view.setPadding(dp(9), dp(5), dp(9), dp(5));
        return view;
    }

    private Button primaryButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextColor(Color.WHITE);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setBackgroundTintList(ColorStateList.valueOf(PRIMARY));
        button.setMinHeight(dp(48));
        return button;
    }

    private Button secondaryButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextColor(PRIMARY_DARK);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setBackgroundTintList(ColorStateList.valueOf(Color.rgb(238, 235, 255)));
        button.setMinHeight(dp(46));
        return button;
    }

    private Button smallButton(String label) {
        Button button = secondaryButton(label);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        button.setMinHeight(dp(38));
        button.setPadding(dp(12), dp(4), dp(12), dp(4));
        return button;
    }

    private String statusLabel(String status) {
        switch (status) {
            case "uploaded": return "In attesa";
            case "processing": return "Elaborazione";
            case "completed": return "Completato";
            case "failed": return "Fallito";
            default: return status;
        }
    }

    private int statusColor(String status) {
        switch (status) {
            case "completed": return SUCCESS;
            case "processing": return WARNING;
            case "failed": return DANGER;
            default: return MUTED;
        }
    }

    private int statusBackground(String status) {
        switch (status) {
            case "completed": return Color.rgb(227, 248, 239);
            case "processing": return Color.rgb(255, 244, 216);
            case "failed": return Color.rgb(255, 233, 238);
            default: return Color.rgb(238, 236, 246);
        }
    }

    private LinearLayout.LayoutParams matchTop(int topMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = topMargin;
        return params;
    }

    private LinearLayout.LayoutParams weighted() {
        return new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    }

    private LinearLayout.LayoutParams weightedWithStart(int startMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        params.setMarginStart(startMargin);
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    private String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? "Errore sconosciuto." : message;
    }

    private String simpleMarkdownPreview(String markdown) {
        String value = String.valueOf(markdown);
        value = value.replaceFirst("(?s)^---\s*.*?\n---\s*", "");
        value = value.replaceAll("(?m)^#{1,6}\s*", "");
        value = value.replaceAll("(?m)^[-*]\s+", "• ");
        value = value.replaceAll("\\[\\[([^\\]|#]+)(?:\\|[^\\]]+)?\\]\\]", "$1");
        value = value.replace("**", "").replace("__", "").replace("`", "");
        value = value.replaceAll("\n{3,}", "\n\n");
        return value.trim().isEmpty() ? "Anteprima non disponibile." : value.trim();
    }

    private String firstNonEmpty(String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) return value;
        }
        return "";
    }
}
