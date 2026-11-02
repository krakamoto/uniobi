package it.uniai.mobile;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

final class ApiResponse {
    final int code;
    final String body;
    final String setCookie;

    ApiResponse(int code, String body, String setCookie) {
        this.code = code;
        this.body = body;
        this.setCookie = setCookie;
    }

    boolean isOk() {
        return code >= 200 && code < 300;
    }

    String errorMessage() {
        try {
            JSONObject object = new JSONObject(body);
            String error = object.optString("error", "");
            if (!error.isEmpty()) return error;
        } catch (Exception ignored) {
        }
        if (body == null || body.trim().isEmpty()) return "Errore HTTP " + code;
        return body.length() > 400 ? body.substring(0, 400) : body;
    }
}

final class UploadPart {
    final Uri uri;
    final String mimeType;
    final String fileName;

    UploadPart(Uri uri, String mimeType, String fileName) {
        this.uri = uri;
        this.mimeType = mimeType;
        this.fileName = fileName;
    }
}

final class ApiClient {
    private String baseUrl;
    private String cookie = "";
    private String certificatePin = "";

    ApiClient(String baseUrl) {
        setBaseUrl(baseUrl);
    }

    void setBaseUrl(String baseUrl) {
        String value = baseUrl == null ? "" : baseUrl.trim();
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://" + value;
        this.baseUrl = value;
    }

    String getBaseUrl() {
        return baseUrl;
    }

    void setCookie(String cookie) {
        this.cookie = cookie == null ? "" : cookie;
    }

    String getCookie() {
        return cookie;
    }

    void clearCookie() {
        cookie = "";
    }

    void setCertificatePin(String certificatePin) {
        this.certificatePin = normalizePin(certificatePin);
    }

    String getCertificatePin() {
        return certificatePin;
    }

    ApiResponse get(String path) throws IOException {
        return request("GET", path, null, null, false);
    }

    ApiResponse postJson(String path, String json) throws IOException {
        return request("POST", path, json.getBytes(StandardCharsets.UTF_8), "application/json; charset=utf-8", false);
    }

    ApiResponse putJson(String path, String json) throws IOException {
        return request("PUT", path, json.getBytes(StandardCharsets.UTF_8), "application/json; charset=utf-8", false);
    }

    ApiResponse upload(String path, ContentResolver resolver, Map<String, String> fields, List<UploadPart> files) throws IOException {
        String boundary = "----UniAiBoundary" + System.currentTimeMillis();
        HttpURLConnection connection = open("POST", path);
        connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
        connection.setDoOutput(true);
        connection.setChunkedStreamingMode(0);

        try (DataOutputStream output = new DataOutputStream(connection.getOutputStream())) {
            for (Map.Entry<String, String> field : fields.entrySet()) {
                writeUtf8(output, "--" + boundary + "\r\n");
                writeUtf8(output, "Content-Disposition: form-data; name=\"" + escape(field.getKey()) + "\"\r\n\r\n");
                writeUtf8(output, field.getValue() == null ? "" : field.getValue());
                writeUtf8(output, "\r\n");
            }

            for (UploadPart file : files) {
                String safeName = asciiFileName(file.fileName);
                writeUtf8(output, "--" + boundary + "\r\n");
                writeUtf8(output, "Content-Disposition: form-data; name=\"files\"; filename=\"" + safeName + "\"\r\n");
                writeUtf8(output, "Content-Type: " + (file.mimeType == null ? "image/jpeg" : file.mimeType) + "\r\n\r\n");
                try (InputStream input = resolver.openInputStream(file.uri)) {
                    if (input == null) throw new IOException("Impossibile leggere l'immagine selezionata.");
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                }
                writeUtf8(output, "\r\n");
            }
            writeUtf8(output, "--" + boundary + "--\r\n");
            output.flush();
        }

        return readResponse(connection);
    }

    private HttpURLConnection open(String method, String path) throws IOException {
        String cleanPath = path.startsWith("/") ? path : "/" + path;
        HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl + cleanPath).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(180000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "UniAi-Android/1.0");
        if (!cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
        if (connection instanceof HttpsURLConnection && !certificatePin.isEmpty()) {
            applyCertificatePin((HttpsURLConnection) connection, certificatePin);
        }
        return connection;
    }

    private static void applyCertificatePin(HttpsURLConnection connection, String expectedPin) throws IOException {
        try {
            TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            factory.init((java.security.KeyStore) null);
            X509TrustManager defaultTrustManager = null;
            for (TrustManager manager : factory.getTrustManagers()) {
                if (manager instanceof X509TrustManager) {
                    defaultTrustManager = (X509TrustManager) manager;
                    break;
                }
            }
            if (defaultTrustManager == null) throw new IOException("Trust manager TLS non disponibile.");
            final X509TrustManager delegate = defaultTrustManager;
            X509TrustManager pinnedManager = new X509TrustManager() {
                @Override
                public void checkClientTrusted(X509Certificate[] chain, String authType) throws java.security.cert.CertificateException {
                    delegate.checkClientTrusted(chain, authType);
                }

                @Override
                public void checkServerTrusted(X509Certificate[] chain, String authType) throws java.security.cert.CertificateException {
                    delegate.checkServerTrusted(chain, authType);
                    if (chain == null || chain.length == 0) throw new java.security.cert.CertificateException("Certificato server assente.");
                    try {
                        MessageDigest digest = MessageDigest.getInstance("SHA-256");
                        byte[] hash = digest.digest(chain[0].getEncoded());
                        StringBuilder hex = new StringBuilder();
                        for (byte value : hash) hex.append(String.format("%02x", value));
                        if (!expectedPin.equalsIgnoreCase(hex.toString())) {
                            throw new java.security.cert.CertificateException("Certificate pin non valido.");
                        }
                    } catch (java.security.NoSuchAlgorithmException error) {
                        throw new java.security.cert.CertificateException(error);
                    }
                }

                @Override
                public X509Certificate[] getAcceptedIssuers() {
                    return delegate.getAcceptedIssuers();
                }
            };
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(null, new TrustManager[]{pinnedManager}, new SecureRandom());
            connection.setSSLSocketFactory(context.getSocketFactory());
        } catch (Exception error) {
            throw new IOException("Impossibile applicare il certificate pin: " + error.getMessage(), error);
        }
    }

    private static String normalizePin(String value) {
        return String.valueOf(value == null ? "" : value).replaceAll("[^0-9A-Fa-f]", "").toLowerCase();
    }

    private ApiResponse request(String method, String path, byte[] body, String contentType, boolean multipart) throws IOException {
        HttpURLConnection connection = open(method, path);
        if (body != null) {
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", contentType);
            connection.setFixedLengthStreamingMode(body.length);
            try (DataOutputStream output = new DataOutputStream(connection.getOutputStream())) {
                output.write(body);
            }
        }
        return readResponse(connection);
    }

    private ApiResponse readResponse(HttpURLConnection connection) throws IOException {
        int code = connection.getResponseCode();
        InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
        String body = stream == null ? "" : readAll(stream);
        String setCookie = connection.getHeaderField("Set-Cookie");
        if (setCookie != null && setCookie.contains("uniai_session=")) {
            String first = setCookie.split(";", 2)[0].trim();
            if (first.equals("uniai_session=")) cookie = "";
            else cookie = first;
        }
        connection.disconnect();
        return new ApiResponse(code, body, setCookie);
    }

    private static String readAll(InputStream input) throws IOException {
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = stream.read(buffer)) != -1) output.write(buffer, 0, read);
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static void writeUtf8(DataOutputStream output, String value) throws IOException {
        output.write(value.getBytes(StandardCharsets.UTF_8));
    }

    private static String escape(String value) {
        return value == null ? "" : value.replace("\\", "_").replace("\"", "_").replace("\r", " ").replace("\n", " ");
    }

    private static String asciiFileName(String value) {
        String safe = value == null ? "appunti.jpg" : value.replaceAll("[^A-Za-z0-9._-]", "_");
        if (safe.isEmpty()) safe = "appunti.jpg";
        return safe;
    }

    static String displayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null && !name.isEmpty()) return name;
                }
            }
        } catch (Exception ignored) {
        }
        String last = uri.getLastPathSegment();
        return last == null || last.isEmpty() ? "appunti.jpg" : last;
    }
}
