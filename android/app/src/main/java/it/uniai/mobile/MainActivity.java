package it.uniai.mobile;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.Settings;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int REQUEST_PICK_IMAGES = 4001;
    private static final int REQUEST_CAMERA = 4002;
    private static final int REQUEST_NETWORK_PERMISSIONS = 4003;
    private static final int TAB_UPLOAD = 0;
    private static final int TAB_QUEUE = 1;
    private static final int TAB_ACTIVITY = 2;
    private static final int TAB_SETTINGS = 3;
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
    private FrameLayout tabContentFrame;
    private final List<View> tabViews = new ArrayList<>();
    private LinearLayout[] tabItems;
    private ImageView[] tabIcons;
    private TextView[] tabLabels;
    private TextView topStatusView;
    private TextView queueTabLabel;
    private int currentTab = TAB_UPLOAD;
    private Uri cameraOutputUri;

    private EditText serverUrlInput;
    private EditText passwordInput;
    private Spinner courseSpinner;
    private ArrayAdapter<String> courseAdapter;
    private final List<String> courseNames = new ArrayList<>();
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
    private LinearLayout networkPanel;
    private TextView networkStatusView;
    private Button networkActionButton;
    private Button networkManageButton;
    private LinearLayout queuePanel;
    private LinearLayout queueItemsContainer;
    private TextView queueStatusView;
    private ProgressBar queueProgress;
    private Button queueRetryButton;
    private BroadcastReceiver queueReceiver;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
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
        UploadQueueStore.requeueUploading(this);
        buildUi();
        loadCourses();
        refreshQueueStatus();
        refreshNetworkStatus();
        UploadScheduler.ensurePeriodic(this);
        checkServerAndAuth();
    }

    @Override
    protected void onResume() {
        super.onResume();
        registerQueueUpdates();
        registerNetworkUpdates();
        refreshQueueStatus();
        refreshNetworkStatus();
        if (serverNetworkAllowed(false) && UploadQueueStore.pendingCount(this) > 0) UploadScheduler.schedule(this);
        handler.removeCallbacks(pollRunnable);
        handler.postDelayed(pollRunnable, 6000);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(pollRunnable);
        unregisterQueueUpdates();
        unregisterNetworkUpdates();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private void buildUi() {
        LinearLayout appRoot = new LinearLayout(this);
        appRoot.setOrientation(LinearLayout.VERTICAL);
        appRoot.setBackgroundColor(BG);
        appRoot.setFitsSystemWindows(true);

        appRoot.addView(buildTopBar(), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        tabContentFrame = new FrameLayout(this);
        appRoot.addView(tabContentFrame, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        LinearLayout uploadTab = createTabContent();
        uploadTab.addView(text("Nuova lezione", 26, TEXT, Typeface.BOLD));
        uploadTab.addView(text("Scatta o scegli più foto, controlla l'ordine e mettile in coda. Il caricamento partirà appena il server sarà raggiungibile.", 13, MUTED, Typeface.NORMAL), matchTop(dp(4)));
        uploadTab.addView(uploadCard(), matchTop(dp(14)));

        LinearLayout queueTab = createTabContent();
        queueTab.addView(text("Coda di caricamento", 26, TEXT, Typeface.BOLD));
        queueTab.addView(text("Gestisci i caricamenti locali, riprova quelli falliti o elimina quelli non più necessari.", 13, MUTED, Typeface.NORMAL), matchTop(dp(4)));
        queueTab.addView(queueCard(), matchTop(dp(14)));

        LinearLayout activityTab = createTabContent();
        LinearLayout historyHeader = new LinearLayout(this);
        historyHeader.setOrientation(LinearLayout.HORIZONTAL);
        historyHeader.setGravity(Gravity.CENTER_VERTICAL);
        TextView historyTitle = text("Attività", 26, TEXT, Typeface.BOLD);
        historyHeader.addView(historyTitle, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button refresh = smallButton("Aggiorna");
        refresh.setOnClickListener(view -> loadJobs(false));
        historyHeader.addView(refresh);
        activityTab.addView(historyHeader);
        historyStatus = text("", 12, MUTED, Typeface.NORMAL);
        activityTab.addView(historyStatus, matchTop(dp(6)));
        historyContainer = new LinearLayout(this);
        historyContainer.setOrientation(LinearLayout.VERTICAL);
        activityTab.addView(historyContainer, matchTop(dp(8)));

        LinearLayout settingsTab = createTabContent();
        settingsTab.addView(text("Impostazioni", 26, TEXT, Typeface.BOLD));
        settingsTab.addView(text("Server, sicurezza della rete e accesso.", 13, MUTED, Typeface.NORMAL), matchTop(dp(4)));
        settingsTab.addView(networkCard(), matchTop(dp(14)));
        settingsTab.addView(serverCard(), matchTop(dp(12)));
        loginCard = loginCard();
        loginCard.setVisibility(View.GONE);
        settingsTab.addView(loginCard, matchTop(dp(12)));
        settingsTab.addView(infoCard(), matchTop(dp(12)));

        appRoot.addView(buildBottomNavigation(), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(appRoot);
        selectTab(TAB_UPLOAD);
    }

    private LinearLayout buildTopBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(18), dp(12), dp(10), dp(8));
        bar.setBackgroundColor(BG);

        TextView mark = text("U", 19, Color.WHITE, Typeface.BOLD);
        mark.setGravity(Gravity.CENTER);
        GradientDrawable markBg = new GradientDrawable();
        markBg.setColor(PRIMARY);
        markBg.setCornerRadius(dp(13));
        mark.setBackground(markBg);
        bar.addView(mark, new LinearLayout.LayoutParams(dp(42), dp(42)));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setPadding(dp(11), 0, 0, 0);
        TextView title = text("UniAi", 20, TEXT, Typeface.BOLD);
        topStatusView = text("Verifica rete…", 11, MUTED, Typeface.NORMAL);
        titles.addView(title);
        titles.addView(topStatusView);
        bar.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        ImageView settings = new ImageView(this);
        settings.setImageResource(R.drawable.ic_settings);
        settings.setColorFilter(TEXT);
        settings.setContentDescription("Apri impostazioni");
        settings.setPadding(dp(10), dp(10), dp(10), dp(10));
        settings.setBackgroundColor(Color.TRANSPARENT);
        settings.setOnClickListener(view -> selectTab(TAB_SETTINGS));
        bar.addView(settings, new LinearLayout.LayoutParams(dp(48), dp(48)));
        return bar;
    }

    private LinearLayout createTabContent() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(18), dp(12), dp(18), dp(28));
        scroll.addView(content, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        tabContentFrame.addView(scroll, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        tabViews.add(scroll);
        return content;
    }

    private LinearLayout buildBottomNavigation() {
        LinearLayout nav = new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        nav.setGravity(Gravity.CENTER);
        nav.setPadding(dp(8), dp(5), dp(8), dp(7));
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.WHITE);
        background.setStroke(dp(1), Color.argb(24, 36, 30, 80));
        nav.setBackground(background);

        tabItems = new LinearLayout[4];
        tabIcons = new ImageView[4];
        tabLabels = new TextView[4];
        tabItems[0] = addTabItem(nav, R.drawable.ic_upload, "Carica", TAB_UPLOAD);
        tabItems[1] = addTabItem(nav, R.drawable.ic_queue, "Coda", TAB_QUEUE);
        tabItems[2] = addTabItem(nav, R.drawable.ic_activity, "Attività", TAB_ACTIVITY);
        tabItems[3] = addTabItem(nav, R.drawable.ic_settings, "Impostazioni", TAB_SETTINGS);
        queueTabLabel = tabLabels[TAB_QUEUE];
        return nav;
    }

    private LinearLayout addTabItem(LinearLayout parent, int iconRes, String label, int index) {
        LinearLayout item = new LinearLayout(this);
        item.setOrientation(LinearLayout.VERTICAL);
        item.setGravity(Gravity.CENTER);
        item.setPadding(dp(4), dp(7), dp(4), dp(5));
        item.setClickable(true);
        item.setFocusable(true);
        item.setContentDescription(label);
        ImageView icon = new ImageView(this);
        icon.setImageResource(iconRes);
        icon.setColorFilter(MUTED);
        item.addView(icon, new LinearLayout.LayoutParams(dp(23), dp(23)));
        TextView textLabel = text(label, 10, MUTED, Typeface.BOLD);
        textLabel.setGravity(Gravity.CENTER);
        item.addView(textLabel);
        item.setOnClickListener(view -> selectTab(index));
        parent.addView(item, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        tabIcons[index] = icon;
        tabLabels[index] = textLabel;
        return item;
    }

    private void selectTab(int index) {
        if (index < 0 || index >= tabViews.size()) return;
        currentTab = index;
        for (int i = 0; i < tabViews.size(); i += 1) {
            tabViews.get(i).setVisibility(i == index ? View.VISIBLE : View.GONE);
            int color = i == index ? PRIMARY : MUTED;
            if (tabIcons[i] != null) tabIcons[i].setColorFilter(color);
            if (tabLabels[i] != null) tabLabels[i].setTextColor(color);
        }
        if (index == TAB_ACTIVITY) loadJobs(true);
        if (index == TAB_SETTINGS) refreshNetworkStatus();
        if (index == TAB_QUEUE) refreshQueueStatus();
    }

    private View infoCard() {
        LinearLayout card = card();
        card.addView(text("Informazioni", 17, TEXT, Typeface.BOLD));
        card.addView(text("UniAi 1.8 · Android 17 ready\nLe foto vengono compresse sul telefono. Il server viene contattato solo su reti fidate, VPN o emulatore locale.", 12, MUTED, Typeface.NORMAL), matchTop(dp(6)));
        return card;
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
        card.addView(text("Seleziona più foto dalla galleria o scatta con la fotocamera. Le foto vengono salvate localmente e caricate automaticamente appena il server è raggiungibile.", 12, MUTED, Typeface.NORMAL), matchTop(dp(4)));

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
        LinearLayout reviewRow = new LinearLayout(this);
        reviewRow.setOrientation(LinearLayout.HORIZONTAL);
        reviewRow.setGravity(Gravity.CENTER_VERTICAL);
        reviewRow.setPadding(0, dp(6), 0, 0);
        TextView reviewHint = text("Tocca una miniatura per riordinare o rimuovere.", 11, MUTED, Typeface.NORMAL);
        reviewRow.addView(reviewHint, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button reviewImages = smallButton("Rivedi");
        reviewImages.setOnClickListener(view -> showReviewImagesDialog());
        reviewRow.addView(reviewImages);
        card.addView(reviewRow);
        renderSelectedFiles();

        LinearLayout courseField = new LinearLayout(this);
        courseField.setOrientation(LinearLayout.VERTICAL);
        courseField.addView(text("Corso", 12, Color.rgb(62, 57, 82), Typeface.BOLD));
        LinearLayout courseRow = new LinearLayout(this);
        courseRow.setOrientation(LinearLayout.HORIZONTAL);
        courseRow.setGravity(Gravity.CENTER_VERTICAL);
        courseSpinner = new Spinner(this);
        courseAdapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, courseNames);
        courseAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        courseSpinner.setAdapter(courseAdapter);
        courseSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                prefs.edit().putString("selected_course", getSelectedCourse()).apply();
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });
        courseRow.addView(courseSpinner, weighted());
        Button addCourse = secondaryButton("+ Corso");
        addCourse.setMinHeight(dp(42));
        addCourse.setOnClickListener(view -> showCreateCourseDialog());
        LinearLayout.LayoutParams addCourseParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        addCourseParams.setMarginStart(dp(8));
        courseRow.addView(addCourse, addCourseParams);
        Button manageCourses = smallButton("Gestisci");
        LinearLayout.LayoutParams manageCourseParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        manageCourseParams.setMarginStart(dp(6));
        manageCourses.setOnClickListener(view -> showManageCoursesDialog());
        courseRow.addView(manageCourses, manageCourseParams);
        courseField.addView(courseRow, matchTop(dp(6)));
        card.addView(courseField, matchTop(dp(12)));

        dateInput = editText("AAAA-MM-GG (facoltativa)", InputType.TYPE_CLASS_DATETIME);
        dateInput.setFocusable(false);
        dateInput.setClickable(true);
        dateInput.setOnClickListener(view -> chooseDate());
        card.addView(field("Data lezione (opzionale)", dateInput), matchTop(dp(10)));

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
        uploadButton = primaryButton("Metti in coda");
        uploadButton.setOnClickListener(view -> uploadNotes());
        actionRow.addView(uploadButton, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        uploadProgress = new ProgressBar(this);
        uploadProgress.setVisibility(View.GONE);
        actionRow.addView(uploadProgress, new LinearLayout.LayoutParams(dp(34), dp(34)));
        card.addView(actionRow, matchTop(dp(16)));

        uploadStatus = text("Le foto vengono salvate sul telefono e caricate automaticamente quando il server è raggiungibile.", 12, MUTED, Typeface.NORMAL);
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
            image.setContentDescription("Anteprima " + (index + 1));
            image.setOnClickListener(view -> showReviewImagesDialog());
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
            remove.setContentDescription("Rimuovi immagine " + (index + 1));
            remove.setOnClickListener(view -> {
                selectedFiles.remove(removeIndex);
                renderSelectedFiles();
            });
            frame.addView(remove, removeParams);
            selectedContainer.addView(frame);
        }
    }

    private static final String COURSE_PLACEHOLDER = "— Seleziona un corso —";

    private void loadCourses() {
        courseNames.clear();
        courseNames.add(COURSE_PLACEHOLDER);
        String stored = prefs.getString("courses_json", "[]");
        try {
            JSONArray array = new JSONArray(stored);
            for (int i = 0; i < array.length(); i++) {
                String name = array.optString(i, "").trim();
                if (!name.isEmpty() && !courseNames.contains(name)) courseNames.add(name);
            }
        } catch (Exception ignored) {
        }
        if (courseAdapter != null) courseAdapter.notifyDataSetChanged();
        String selected = prefs.getString("selected_course", "");
        int index = selected.isEmpty() ? 0 : courseNames.indexOf(selected);
        if (index > 0 && courseSpinner != null) courseSpinner.setSelection(index);
    }

    private void saveCourses() {
        JSONArray array = new JSONArray();
        for (String name : courseNames) {
            if (!COURSE_PLACEHOLDER.equals(name)) array.put(name);
        }
        prefs.edit().putString("courses_json", array.toString()).apply();
    }

    private void addCourse(String name) {
        String clean = name == null ? "" : name.trim();
        if (clean.isEmpty()) {
            toast("Inserisci il nome del corso.");
            return;
        }
        int existing = courseNames.indexOf(clean);
        if (existing <= 0) {
            unhideCourse(clean);
            courseNames.add(clean);
            courseAdapter.notifyDataSetChanged();
            existing = courseNames.size() - 1;
            saveCourses();
        }
        courseSpinner.setSelection(existing);
        prefs.edit().putString("selected_course", clean).apply();
        toast("Corso salvato: " + clean);
    }

    private void showCreateCourseDialog() {
        EditText input = editText("Es. Meccanica del volo", InputType.TYPE_CLASS_TEXT);
        input.setPadding(dp(14), dp(10), dp(14), dp(10));
        new AlertDialog.Builder(this)
            .setTitle("Nuovo corso")
            .setMessage("Il corso resterà salvato sul telefono e potrai selezionarlo ai prossimi caricamenti.")
            .setView(input)
            .setNegativeButton("Annulla", null)
            .setPositiveButton("Crea corso", (dialog, which) -> addCourse(input.getText().toString()))
            .show();
    }

    private String getSelectedCourse() {
        if (courseSpinner == null || courseSpinner.getSelectedItem() == null) return "";
        String value = courseSpinner.getSelectedItem().toString();
        return COURSE_PLACEHOLDER.equals(value) ? "" : value;
    }

    private void fetchServerCourses() {
        if (!serverNetworkAllowed(false)) return;
        executor.execute(() -> {
            try {
                ApiResponse response = api.get("/api/courses");
                if (!response.isOk()) return;
                JSONObject payload = new JSONObject(response.body);
                JSONArray rows = payload.optJSONArray("courses");
                if (rows == null) return;
                List<String> names = new ArrayList<>();
                for (int i = 0; i < rows.length(); i++) {
                    JSONObject row = rows.optJSONObject(i);
                    if (row == null) continue;
                    String name = row.optString("course", "").trim();
                    if (!name.isEmpty()) names.add(name);
                }
                runOnUiThread(() -> mergeServerCourses(names));
            } catch (Exception ignored) {
            }
        });
    }

    private void mergeServerCourses(List<String> names) {
        boolean changed = false;
        String selected = getSelectedCourse();
        List<String> hidden = hiddenCourses();
        for (String name : names) {
            if (!name.isEmpty() && !hidden.contains(name) && !courseNames.contains(name)) {
                courseNames.add(name);
                changed = true;
            }
        }
        if (changed) {
            courseAdapter.notifyDataSetChanged();
            saveCourses();
        }
        int index = selected.isEmpty() ? 0 : courseNames.indexOf(selected);
        if (index > 0) courseSpinner.setSelection(index);
    }

    private View networkCard() {
        networkPanel = card();
        networkPanel.addView(text("Rete Wi-Fi", 20, TEXT, Typeface.BOLD));
        networkPanel.addView(text("Per proteggere foto e sessione, l'app contatta il server solo da reti Wi-Fi che hai autorizzato.", 12, MUTED, Typeface.NORMAL), matchTop(dp(4)));
        networkStatusView = text("Verifica rete…", 13, MUTED, Typeface.NORMAL);
        networkPanel.addView(networkStatusView, matchTop(dp(10)));

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setPadding(0, dp(8), 0, 0);
        networkActionButton = secondaryButton("Rendi questa rete fidata");
        networkActionButton.setOnClickListener(view -> onNetworkAction());
        actions.addView(networkActionButton, weighted());
        networkManageButton = smallButton("Gestisci");
        networkManageButton.setOnClickListener(view -> showTrustedNetworks());
        LinearLayout.LayoutParams manageParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        manageParams.setMarginStart(dp(8));
        actions.addView(networkManageButton, manageParams);
        networkPanel.addView(actions);
        return networkPanel;
    }

    private void refreshNetworkStatus() {
        if (networkStatusView == null) return;
        boolean fineLocation = TrustedNetworkManager.hasFineLocationPermission(this);
        boolean nearbyWifi = TrustedNetworkManager.hasNearbyWifiPermission(this);
        boolean locationEnabled = TrustedNetworkManager.isLocationEnabled(this);
        String label = TrustedNetworkManager.currentNetworkLabel(this);
        if (topStatusView != null) {
            boolean trusted = TrustedNetworkManager.isOnVpn(this) || TrustedNetworkManager.isCurrentNetworkTrusted(this);
            topStatusView.setText(trusted ? "Rete sicura" : "Rete non autorizzata");
            topStatusView.setTextColor(trusted ? SUCCESS : WARNING);
        }
        networkStatusView.setText("Rete attuale: " + label
            + "\nPermesso posizione precisa: " + (fineLocation ? "sì" : "no")
            + " · Permesso Wi-Fi: " + (nearbyWifi ? "sì" : "no")
            + " · Posizione di sistema: " + (locationEnabled ? "attiva" : "disattiva"));
        if (!fineLocation || !nearbyWifi) {
            networkActionButton.setText("Consenti accesso rete");
            networkActionButton.setEnabled(true);
        } else if (!locationEnabled && TrustedNetworkManager.isOnWifi(this)) {
            networkActionButton.setText("Apri impostazioni posizione");
            networkActionButton.setEnabled(true);
        } else if (TrustedNetworkManager.isOnVpn(this)) {
            networkActionButton.setText("VPN attiva");
            networkActionButton.setEnabled(false);
        } else if (!TrustedNetworkManager.isOnWifi(this)) {
            networkActionButton.setText("Nessun Wi-Fi connesso");
            networkActionButton.setEnabled(false);
        } else {
            String ssid = TrustedNetworkManager.currentSsid(this);
            if (ssid.isEmpty()) {
                String fingerprint = TrustedNetworkManager.currentNetworkFingerprint(this);
                if (fingerprint.isEmpty()) {
                    networkActionButton.setText("Apri impostazioni posizione");
                } else if (TrustedNetworkManager.trustedFingerprints(this).contains(fingerprint)) {
                    networkActionButton.setText("Rimuovi fiducia dall'impronta rete");
                } else {
                    networkActionButton.setText("Autorizza impronta rete corrente");
                }
                networkActionButton.setEnabled(true);
            } else if (TrustedNetworkManager.trustedSsids(this).contains(ssid)) {
                networkActionButton.setText("Rimuovi fiducia da questa rete");
                networkActionButton.setEnabled(true);
            } else {
                networkActionButton.setText("Rendi questa rete fidata");
                networkActionButton.setEnabled(true);
            }
        }
        boolean hasTrusted = !TrustedNetworkManager.trustedSsids(this).isEmpty() || !TrustedNetworkManager.trustedFingerprints(this).isEmpty();
        networkManageButton.setVisibility(hasTrusted ? View.VISIBLE : View.GONE);
    }

    private void onNetworkAction() {
        if (!TrustedNetworkManager.hasFineLocationPermission(this) || !TrustedNetworkManager.hasNearbyWifiPermission(this)) {
            requestNetworkPermissions();
            return;
        }
        if (!TrustedNetworkManager.isLocationEnabled(this)) {
            openLocationSettings();
            return;
        }
        String ssid = TrustedNetworkManager.currentSsid(this);
        String fingerprint = TrustedNetworkManager.currentNetworkFingerprint(this);
        if (ssid.isEmpty() && fingerprint.isEmpty()) {
            toast("Android non espone l'SSID e non è possibile calcolare l'impronta della rete.");
            openLocationSettings();
            return;
        }
        boolean trusted = (!ssid.isEmpty() && TrustedNetworkManager.trustedSsids(this).contains(ssid))
            || (!fingerprint.isEmpty() && TrustedNetworkManager.trustedFingerprints(this).contains(fingerprint));
        if (trusted) {
            TrustedNetworkManager.forgetCurrentNetwork(this);
            toast("Rete rimossa dalle reti fidate.");
            refreshNetworkStatus();
            return;
        }
        TrustedNetworkManager.trustCurrentNetwork(this);
        toast(ssid.isEmpty()
            ? "Impronta rete autorizzata: " + TrustedNetworkManager.shortFingerprint(fingerprint)
            : "Rete fidata salvata: " + ssid);
        refreshNetworkStatus();
        if (serverNetworkAllowed(false)) {
            UploadScheduler.schedule(this);
            checkServerAndAuth();
        }
    }

    private void showTrustedNetworks() {
        List<String> ssids = TrustedNetworkManager.trustedSsids(this);
        List<String> fingerprints = TrustedNetworkManager.trustedFingerprints(this);
        List<String> labels = new ArrayList<>();
        List<String> types = new ArrayList<>();
        List<String> values = new ArrayList<>();
        for (String ssid : ssids) {
            labels.add("Wi-Fi: " + ssid);
            types.add("ssid");
            values.add(ssid);
        }
        for (String fingerprint : fingerprints) {
            labels.add("Impronta rete: " + TrustedNetworkManager.shortFingerprint(fingerprint));
            types.add("fingerprint");
            values.add(fingerprint);
        }
        if (labels.isEmpty()) {
            toast("Nessuna rete fidata configurata.");
            return;
        }
        String[] items = labels.toArray(new String[0]);
        new AlertDialog.Builder(this)
            .setTitle("Reti fidate")
            .setItems(items, (dialog, which) -> new AlertDialog.Builder(this)
                .setTitle("Rimuovere questa fiducia?")
                .setMessage(items[which])
                .setNegativeButton("Annulla", null)
                .setPositiveButton("Rimuovi", (confirm, ignored) -> {
                    if ("ssid".equals(types.get(which))) {
                        TrustedNetworkManager.removeTrustedSsid(this, values.get(which));
                    } else {
                        TrustedNetworkManager.removeTrustedFingerprint(this, values.get(which));
                    }
                    refreshNetworkStatus();
                    toast("Rete rimossa.");
                })
                .show())
            .setNegativeButton("Chiudi", null)
            .show();
    }

    private void requestNetworkPermissions() {
        TrustedNetworkManager.markLocationPrompted(this);
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.NEARBY_WIFI_DEVICES}, REQUEST_NETWORK_PERMISSIONS);
        } else {
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION}, REQUEST_NETWORK_PERMISSIONS);
        }
    }

    private void openLocationSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
        } catch (Exception error) {
            toast("Apri manualmente le impostazioni Android → Posizione.");
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_NETWORK_PERMISSIONS) {
            refreshNetworkStatus();
            if (TrustedNetworkManager.hasWifiPermission(this)) {
                if (!TrustedNetworkManager.isLocationEnabled(this)) {
                    toast("Permesso concesso. Attiva ora la posizione di sistema per leggere l'SSID.");
                    openLocationSettings();
                } else {
                    toast("Permesso rete concesso. Ora puoi rendere fidata questa rete Wi-Fi.");
                }
            } else {
                toast("Servono sia la posizione precisa sia il permesso Dispositivi Wi-Fi vicini.");
            }
        }
    }

    private boolean serverNetworkAllowed(boolean showMessage) {
        if (TrustedNetworkManager.canContactServer(this, api.getBaseUrl())) return true;
        if (showMessage) {
            String reason = TrustedNetworkManager.connectionBlockReason(this, api.getBaseUrl());
            uploadStatus.setText("Connessione bloccata: " + reason);
            toast(reason);
            refreshNetworkStatus();
            selectTab(TAB_SETTINGS);
        }
        return false;
    }

    private View queueCard() {
        queuePanel = card();
        queuePanel.addView(text("Coda di caricamento", 20, TEXT, Typeface.BOLD));
        queuePanel.addView(text("Le foto restano sul telefono e vengono inviate automaticamente quando la rete e il server sono disponibili.", 12, MUTED, Typeface.NORMAL), matchTop(dp(4)));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        queueStatusView = text("Nessun caricamento in sospeso.", 13, MUTED, Typeface.NORMAL);
        row.addView(queueStatusView, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        queueProgress = new ProgressBar(this);
        queueProgress.setVisibility(View.GONE);
        row.addView(queueProgress, new LinearLayout.LayoutParams(dp(32), dp(32)));
        queuePanel.addView(row, matchTop(dp(10)));
        queueItemsContainer = new LinearLayout(this);
        queueItemsContainer.setOrientation(LinearLayout.VERTICAL);
        queuePanel.addView(queueItemsContainer);

        queueRetryButton = secondaryButton("Riprova caricamenti falliti");
        queueRetryButton.setVisibility(View.GONE);
        queueRetryButton.setOnClickListener(view -> {
            UploadQueueStore.retryFailed(this);
            refreshQueueStatus();
            UploadScheduler.schedule(this);
            toast("Coda riattivata.");
        });
        queuePanel.addView(queueRetryButton, matchTop(dp(8)));
        return queuePanel;
    }

    private void refreshQueueStatus() {
        if (queueStatusView == null) return;
        int pending = UploadQueueStore.pendingCount(this);
        int failed = UploadQueueStore.failedCount(this);
        if (queueTabLabel != null) queueTabLabel.setText(pending + failed > 0 ? "Coda (" + (pending + failed) + ")" : "Coda");
        if (pending == 0 && failed == 0) {
            queueStatusView.setText("Nessun caricamento in sospeso.");
            queueProgress.setVisibility(View.GONE);
            queueRetryButton.setVisibility(View.GONE);
            if (queueItemsContainer != null) queueItemsContainer.removeAllViews();
            return;
        }
        StringBuilder textValue = new StringBuilder();
        if (pending > 0) textValue.append(pending).append(pending == 1 ? " caricamento in attesa" : " caricamenti in attesa");
        if (failed > 0) {
            if (textValue.length() > 0) textValue.append(" · ");
            textValue.append(failed).append(failed == 1 ? " fallito" : " falliti");
            String lastError = UploadQueueStore.lastError(this);
            if (!lastError.isEmpty()) textValue.append("\n").append(lastError);
        }
        queueStatusView.setText(textValue.toString());
        queueProgress.setVisibility(pending > 0 ? View.VISIBLE : View.GONE);
        queueRetryButton.setVisibility(failed > 0 ? View.VISIBLE : View.GONE);
        renderQueueItems();
    }

    private void registerQueueUpdates() {
        if (queueReceiver != null) return;
        queueReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                refreshQueueStatus();
                loadJobs(true);
            }
        };
        IntentFilter filter = new IntentFilter(UploadQueueStore.ACTION_QUEUE_UPDATED);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(queueReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(queueReceiver, filter);
    }

    private void unregisterQueueUpdates() {
        if (queueReceiver == null) return;
        try { unregisterReceiver(queueReceiver); } catch (Exception ignored) {}
        queueReceiver = null;
    }

    private void registerNetworkUpdates() {
        if (networkCallback != null) return;
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivityManager == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                runOnUiThread(() -> {
                    refreshQueueStatus();
                    refreshNetworkStatus();
                    if (TrustedNetworkManager.canContactServer(MainActivity.this, api.getBaseUrl()) && UploadQueueStore.pendingCount(MainActivity.this) > 0) {
                        UploadScheduler.schedule(MainActivity.this);
                    }
                });
            }
        };
        try { connectivityManager.registerDefaultNetworkCallback(networkCallback); } catch (Exception ignored) {}
    }

    private void unregisterNetworkUpdates() {
        if (connectivityManager == null || networkCallback == null) return;
        try { connectivityManager.unregisterNetworkCallback(networkCallback); } catch (Exception ignored) {}
        networkCallback = null;
    }

    private void showReviewImagesDialog() {
        if (selectedFiles.isEmpty()) {
            toast("Nessuna immagine selezionata.");
            return;
        }
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(16), dp(8), dp(16), dp(8));
        content.addView(text("L'ordine delle immagini sarà l'ordine delle pagine inviate all'AI.", 12, MUTED, Typeface.NORMAL));

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Rivedi immagini")
            .setView(new ScrollView(this) {{ addView(content); }})
            .setNegativeButton("Chiudi", null)
            .create();

        for (int index = 0; index < selectedFiles.size(); index += 1) {
            UploadPart part = selectedFiles.get(index);
            final int position = index;
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(0, dp(8), 0, dp(8));

            ImageView image = new ImageView(this);
            image.setScaleType(ImageView.ScaleType.CENTER_CROP);
            image.setContentDescription("Immagine " + (index + 1));
            try { image.setImageURI(part.uri); } catch (Exception ignored) {}
            row.addView(image, new LinearLayout.LayoutParams(dp(72), dp(72)));

            TextView name = text((index + 1) + ". " + part.fileName, 12, TEXT, Typeface.NORMAL);
            LinearLayout.LayoutParams nameParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            nameParams.setMarginStart(dp(10));
            row.addView(name, nameParams);

            Button up = smallButton("↑");
            up.setContentDescription("Sposta su immagine " + (index + 1));
            up.setEnabled(index > 0);
            up.setOnClickListener(view -> {
                Collections.swap(selectedFiles, position, position - 1);
                renderSelectedFiles();
                dialog.dismiss();
                showReviewImagesDialog();
            });
            row.addView(up);

            Button down = smallButton("↓");
            down.setContentDescription("Sposta giù immagine " + (index + 1));
            down.setEnabled(index < selectedFiles.size() - 1);
            down.setOnClickListener(view -> {
                Collections.swap(selectedFiles, position, position + 1);
                renderSelectedFiles();
                dialog.dismiss();
                showReviewImagesDialog();
            });
            row.addView(down);

            Button remove = smallButton("×");
            remove.setContentDescription("Rimuovi immagine " + (index + 1));
            remove.setOnClickListener(view -> {
                selectedFiles.remove(position);
                renderSelectedFiles();
                dialog.dismiss();
                if (!selectedFiles.isEmpty()) showReviewImagesDialog();
            });
            row.addView(remove);
            content.addView(row);
        }
        dialog.show();
    }

    private List<String> hiddenCourses() {
        List<String> result = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(prefs.getString("hidden_courses_json", "[]"));
            for (int i = 0; i < array.length(); i += 1) {
                String value = array.optString(i, "").trim();
                if (!value.isEmpty() && !result.contains(value)) result.add(value);
            }
        } catch (Exception ignored) {
        }
        return result;
    }

    private void saveHiddenCourses(List<String> values) {
        JSONArray array = new JSONArray();
        for (String value : values) array.put(value);
        prefs.edit().putString("hidden_courses_json", array.toString()).apply();
    }

    private void hideCourse(String name) {
        List<String> hidden = hiddenCourses();
        if (!hidden.contains(name)) hidden.add(name);
        saveHiddenCourses(hidden);
    }

    private void unhideCourse(String name) {
        List<String> hidden = hiddenCourses();
        hidden.remove(name);
        saveHiddenCourses(hidden);
    }

    private void showManageCoursesDialog() {
        List<String> available = new ArrayList<>();
        for (String name : courseNames) {
            if (!COURSE_PLACEHOLDER.equals(name)) available.add(name);
        }
        if (available.isEmpty()) {
            toast("Non ci sono ancora corsi. Creane uno con + Corso.");
            return;
        }
        String[] items = available.toArray(new String[0]);
        new AlertDialog.Builder(this)
            .setTitle("Gestisci corsi")
            .setItems(items, (dialog, which) -> showCourseOptions(items[which]))
            .setNegativeButton("Chiudi", null)
            .show();
    }

    private void showCourseOptions(String course) {
        String[] actions = {"Seleziona", "Rinomina", "Elimina"};
        new AlertDialog.Builder(this)
            .setTitle(course)
            .setItems(actions, (dialog, which) -> {
                if (which == 0) {
                    int index = courseNames.indexOf(course);
                    if (index > 0) courseSpinner.setSelection(index);
                } else if (which == 1) {
                    renameCourse(course);
                } else {
                    deleteCourse(course);
                }
            })
            .setNegativeButton("Annulla", null)
            .show();
    }

    private void renameCourse(String oldName) {
        EditText input = editText("Nuovo nome corso", InputType.TYPE_CLASS_TEXT);
        input.setText(oldName);
        input.setPadding(dp(14), dp(10), dp(14), dp(10));
        new AlertDialog.Builder(this)
            .setTitle("Rinomina corso")
            .setView(input)
            .setNegativeButton("Annulla", null)
            .setPositiveButton("Rinomina", (dialog, which) -> {
                String newName = input.getText().toString().trim();
                if (newName.isEmpty()) {
                    toast("Inserisci un nome valido.");
                    return;
                }
                if (!newName.equals(oldName) && courseNames.contains(newName)) {
                    toast("Esiste già un corso con questo nome.");
                    return;
                }
                int index = courseNames.indexOf(oldName);
                if (index > 0) courseNames.set(index, newName);
                if (oldName.equals(prefs.getString("selected_course", ""))) {
                    prefs.edit().putString("selected_course", newName).apply();
                }
                hideCourse(oldName);
                unhideCourse(newName);
                saveCourses();
                courseAdapter.notifyDataSetChanged();
                int newIndex = courseNames.indexOf(newName);
                if (newIndex > 0) courseSpinner.setSelection(newIndex);
                toast("Corso rinominato.");
            })
            .show();
    }

    private void deleteCourse(String course) {
        new AlertDialog.Builder(this)
            .setTitle("Eliminare il corso?")
            .setMessage(course + "\n\nLe note già generate sul server non verranno eliminate.")
            .setNegativeButton("Annulla", null)
            .setPositiveButton("Elimina", (dialog, which) -> {
                courseNames.remove(course);
                if (course.equals(prefs.getString("selected_course", ""))) {
                    courseSpinner.setSelection(0);
                    prefs.edit().remove("selected_course").apply();
                }
                hideCourse(course);
                saveCourses();
                courseAdapter.notifyDataSetChanged();
                toast("Corso rimosso dall'elenco locale.");
            })
            .show();
    }

    private void renderQueueItems() {
        if (queueItemsContainer == null) return;
        queueItemsContainer.removeAllViews();
        JSONArray queue = UploadQueueStore.read(this);
        for (int i = 0; i < queue.length(); i += 1) {
            JSONObject item = queue.optJSONObject(i);
            if (item == null) continue;
            String id = item.optString("id", "");
            String status = item.optString("status", "pending");
            String course = item.optString("course", "");
            String title = item.optString("title", "");
            int fileCount = item.optJSONArray("files") == null ? 0 : item.optJSONArray("files").length();
            String displayTitle = !title.isEmpty() ? title : (!course.isEmpty() ? course : "Appunti");
            if (!course.isEmpty() && !title.isEmpty()) displayTitle = title + " · " + course;

            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.VERTICAL);
            row.setPadding(dp(10), dp(9), dp(10), dp(9));
            GradientDrawable background = new GradientDrawable();
            background.setColor(Color.rgb(247, 245, 255));
            background.setCornerRadius(dp(10));
            row.setBackground(background);
            row.addView(text(displayTitle, 13, TEXT, Typeface.BOLD));
            String statusLabel = "pending".equals(status) ? "In attesa di rete/server" : ("uploading".equals(status) ? "Caricamento in corso" : "Fallito");
            row.addView(text(fileCount + (fileCount == 1 ? " immagine" : " immagini") + " · " + statusLabel, 11, "failed".equals(status) ? DANGER : MUTED, Typeface.NORMAL), matchTop(dp(3)));
            String error = item.optString("error", "");
            if (!error.isEmpty()) row.addView(text(error, 11, DANGER, Typeface.NORMAL), matchTop(dp(3)));

            if (!"uploading".equals(status)) {
                LinearLayout actions = new LinearLayout(this);
                actions.setOrientation(LinearLayout.HORIZONTAL);
                actions.setPadding(0, dp(6), 0, 0);
                if ("failed".equals(status)) {
                    Button retry = smallButton("Riprova");
                    retry.setOnClickListener(view -> {
                        UploadQueueStore.retryItem(this, id);
                        refreshQueueStatus();
                        if (serverNetworkAllowed(false)) UploadScheduler.schedule(this);
                    });
                    actions.addView(retry);
                }
                Button delete = smallButton("Elimina");
                LinearLayout.LayoutParams deleteParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                deleteParams.setMarginStart(dp(8));
                delete.setOnClickListener(view -> {
                    UploadQueueStore.deleteItem(this, id);
                    refreshQueueStatus();
                });
                actions.addView(delete, deleteParams);
                row.addView(actions);
            }
            queueItemsContainer.addView(row, matchTop(dp(8)));
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
        if (!serverNetworkAllowed(true)) return;
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
                    if (passwordRequired && !authenticated) selectTab(TAB_SETTINGS);
                    if (authenticated) {
                        loadJobs(true);
                        fetchServerCourses();
                        if (UploadQueueStore.pendingCount(MainActivity.this) > 0) UploadScheduler.schedule(MainActivity.this);
                        refreshQueueStatus();
                    }
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
        if (!serverNetworkAllowed(true)) return;
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
                    UploadScheduler.schedule(MainActivity.this);
                });
            } catch (Exception error) {
                runOnUiThread(() -> toast(safeMessage(error)));
            }
        });
    }

    private void pickImages() {
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                Intent picker = new Intent(MediaStore.ACTION_PICK_IMAGES);
                picker.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, 10);
                startActivityForResult(picker, REQUEST_PICK_IMAGES);
                return;
            } catch (ActivityNotFoundException ignored) {
                // Fallback al selettore documenti.
            }
        }
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
            toast("Accedi prima di mettere gli appunti in coda.");
            loginCard.setVisibility(View.VISIBLE);
            return;
        }

        List<UploadPart> files = new ArrayList<>(selectedFiles);
        String course = getSelectedCourse();
        String lessonDate = dateInput.getText().toString().trim();
        String title = titleInput.getText().toString().trim();
        String tags = tagsInput.getText().toString().trim();
        String userNotes = notesInput.getText().toString().trim();
        String queueId = UUID.randomUUID().toString();

        uploadButton.setEnabled(false);
        uploadProgress.setVisibility(View.VISIBLE);
        uploadStatus.setText("Ottimizzazione e salvataggio locale di " + files.size() + (files.size() == 1 ? " immagine…" : " immagini…"));

        executor.execute(() -> {
            try {
                List<Uri> uris = new ArrayList<>();
                for (UploadPart file : files) uris.add(file.uri);
                List<PreparedImage> prepared = ImagePreparer.prepare(MainActivity.this, uris, queueId);
                JSONArray fileArray = new JSONArray();
                for (PreparedImage image : prepared) {
                    JSONObject file = new JSONObject();
                    file.put("path", image.file.getAbsolutePath());
                    file.put("name", image.fileName);
                    file.put("mimeType", image.mimeType);
                    fileArray.put(file);
                }
                JSONObject item = new JSONObject();
                item.put("course", course);
                item.put("lesson_date", lessonDate);
                item.put("title", title);
                item.put("tags", tags);
                item.put("user_notes", userNotes);
                item.put("files", fileArray);
                UploadQueueStore.enqueue(MainActivity.this, item);
                UploadScheduler.schedule(MainActivity.this);
                runOnUiThread(() -> {
                    selectedFiles.clear();
                    renderSelectedFiles();
                    dateInput.setText("");
                    titleInput.setText("");
                    tagsInput.setText("");
                    notesInput.setText("");
                    uploadStatus.setText("Foto salvate nella coda locale. Il caricamento partirà automaticamente appena il server sarà raggiungibile.");
                    refreshQueueStatus();
                    toast("Foto aggiunte alla coda: verranno caricate appena possibile.");
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
        if (!serverNetworkAllowed(!silent)) return;
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
            int noteCount = job.optInt("note_count", 1);
            String meta = (course.isEmpty() ? "Corso non indicato" : course)
                + (date.isEmpty() ? "" : " · " + date)
                + (noteCount > 1 ? " · " + noteCount + " note" : "");
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
        if (!serverNetworkAllowed(true)) return;
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
        JSONObject resultJson = job.optJSONObject("result_json");
        JSONArray generatedNotes = resultJson == null ? null : resultJson.optJSONArray("notes");
        boolean multiNote = generatedNotes != null && generatedNotes.length() > 1;
        String title = resultJson == null
            ? firstNonEmpty(job.optString("requested_title"), job.optString("course"), "Dettaglio elaborazione")
            : resultJson.optString("title", firstNonEmpty(job.optString("requested_title"), job.optString("course"), "Dettaglio elaborazione"));

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

        if (multiNote) {
            content.addView(text(generatedNotes.length() + " note separate", 15, TEXT, Typeface.BOLD), matchTop(dp(14)));
            content.addView(text("Il gruppo di immagini è stato diviso per argomenti. Tutte le note verranno salvate nel vault.", 12, MUTED, Typeface.NORMAL), matchTop(dp(4)));
            for (int i = 0; i < generatedNotes.length(); i++) {
                JSONObject note = generatedNotes.optJSONObject(i);
                if (note == null) continue;
                content.addView(text((i + 1) + ". " + note.optString("title", "Nota"), 14, TEXT, Typeface.BOLD), matchTop(dp(10)));
                String summary = note.optString("summary", "");
                if (!summary.isEmpty()) content.addView(text(summary, 12, MUTED, Typeface.NORMAL), matchTop(dp(3)));
                String noteMarkdown = note.optString("markdown", "");
                if (!noteMarkdown.isEmpty()) {
                    TextView preview = text(simpleMarkdownPreview(noteMarkdown), 12, TEXT, Typeface.NORMAL);
                    preview.setBackgroundColor(Color.WHITE);
                    preview.setPadding(dp(10), dp(8), dp(10), dp(8));
                    content.addView(preview, matchTop(dp(6)));
                }
            }
        }

        String markdown = job.optString("markdown", "");
        EditText editor = null;
        if (!multiNote && !markdown.isEmpty()) {
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
            if (!multiNote && editorFinal != null) {
                builder.setNeutralButton("Salva modifiche", (dialog, which) -> saveMarkdown(id, editorFinal));
            }
        }

        builder.show();
    }

    private void saveMarkdown(String jobId, EditText editor) {
        if (editor == null) return;
        if (!serverNetworkAllowed(true)) return;
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
        if (!serverNetworkAllowed(true)) return;
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
                JSONArray vaultPaths = payload.optJSONArray("vaultPaths");
                String message = vaultPaths != null && vaultPaths.length() > 1
                    ? vaultPaths.length() + " note salvate nel vault."
                    : "Nota salvata: " + payload.optString("vaultPath", "");
                runOnUiThread(() -> {
                    toast(message);
                    loadJobs(true);
                });
            } catch (Exception error) {
                runOnUiThread(() -> toast(safeMessage(error)));
            }
        });
    }

    private void retryJob(String jobId) {
        if (!serverNetworkAllowed(true)) return;
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
