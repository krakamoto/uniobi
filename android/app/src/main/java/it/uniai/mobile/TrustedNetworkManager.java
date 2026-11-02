package it.uniai.mobile;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;

import org.json.JSONArray;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;

final class TrustedNetworkManager {
    private static final String PREFS = "uniai";
    private static final String KEY_TRUSTED_SSIDS = "trusted_wifi_ssids";
    private static final String KEY_LOCATION_PROMPTED = "wifi_location_prompted";

    private TrustedNetworkManager() {
    }

    static boolean hasWifiPermission(Context context) {
        return context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    static String currentSsid(Context context) {
        if (!hasWifiPermission(context)) return "";
        try {
            WifiManager manager = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (manager == null) return "";
            WifiInfo info = manager.getConnectionInfo();
            if (info == null) return "";
            String ssid = info.getSSID();
            if (ssid == null) return "";
            ssid = ssid.trim();
            if (ssid.startsWith("\"") && ssid.endsWith("\"") && ssid.length() > 1) ssid = ssid.substring(1, ssid.length() - 1);
            if (ssid.equals("<unknown ssid>") || ssid.equals("0x")) return "";
            return ssid;
        } catch (Exception ignored) {
            return "";
        }
    }

    static boolean isOnWifi(Context context) {
        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        Network network = cm.getActiveNetwork();
        if (network == null) return false;
        NetworkCapabilities caps = cm.getNetworkCapabilities(network);
        return caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
    }

    static boolean isOnVpn(Context context) {
        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        Network network = cm.getActiveNetwork();
        if (network == null) return false;
        NetworkCapabilities caps = cm.getNetworkCapabilities(network);
        return caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
    }

    static List<String> trustedSsids(Context context) {
        List<String> result = new ArrayList<>();
        SharedPreferences pref = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray array = new JSONArray(pref.getString(KEY_TRUSTED_SSIDS, "[]"));
            for (int i = 0; i < array.length(); i += 1) {
                String ssid = array.optString(i, "").trim();
                if (!ssid.isEmpty() && !result.contains(ssid)) result.add(ssid);
            }
        } catch (Exception ignored) {
        }
        return result;
    }

    static void addTrustedSsid(Context context, String ssid) {
        String clean = ssid == null ? "" : ssid.trim();
        if (clean.isEmpty()) return;
        List<String> values = trustedSsids(context);
        if (!values.contains(clean)) values.add(clean);
        save(context, values);
    }

    static void removeTrustedSsid(Context context, String ssid) {
        List<String> values = trustedSsids(context);
        values.remove(ssid);
        save(context, values);
    }

    private static void save(Context context, List<String> values) {
        JSONArray array = new JSONArray();
        for (String value : values) array.put(value);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_TRUSTED_SSIDS, array.toString())
            .apply();
    }

    static boolean isCurrentWifiTrusted(Context context) {
        String ssid = currentSsid(context);
        return !ssid.isEmpty() && trustedSsids(context).contains(ssid);
    }

    static boolean canContactServer(Context context, String baseUrl) {
        String host = hostFromUrl(baseUrl);
        if (host.equals("10.0.2.2") || host.equals("127.0.0.1") || host.equals("localhost")) return true;
        if (!isHttps(baseUrl) && !isPrivateHost(host)) return false;
        if (isOnVpn(context)) return true;
        return isCurrentWifiTrusted(context);
    }

    static String connectionBlockReason(Context context, String baseUrl) {
        String host = hostFromUrl(baseUrl);
        if (host.equals("10.0.2.2") || host.equals("127.0.0.1") || host.equals("localhost")) return "";
        if (!isHttps(baseUrl) && !isPrivateHost(host)) {
            return "HTTP è consentito solo verso server locali. Configura HTTPS o usa una VPN.";
        }
        if (isOnVpn(context)) return "";
        if (!hasWifiPermission(context)) return "Concedi il permesso di localizzazione per identificare il Wi-Fi.";
        if (!isOnWifi(context)) return "Nessun Wi-Fi connesso. Il server non verrà contattato.";
        String ssid = currentSsid(context);
        if (ssid.isEmpty()) return "SSID non disponibile. Attiva la posizione del telefono.";
        if (!trustedSsids(context).contains(ssid)) return "La rete Wi-Fi attuale non è autorizzata.";
        return "";
    }

    private static boolean isHttps(String baseUrl) {
        try {
            String value = String.valueOf(baseUrl == null ? "" : baseUrl).trim();
            if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://" + value;
            return "https".equalsIgnoreCase(URI.create(value).getScheme());
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean isPrivateHost(String host) {
        if (host == null || host.isEmpty()) return false;
        if (host.equals("localhost") || host.endsWith(".local") || host.endsWith(".ts.net")) return true;
        if (host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.")) return true;
        if (host.startsWith("172.")) {
            try {
                int second = Integer.parseInt(host.split("\\.")[1]);
                return second >= 16 && second <= 31;
            } catch (Exception ignored) {
                return false;
            }
        }
        if (host.startsWith("100.")) {
            try {
                int second = Integer.parseInt(host.split("\\.")[1]);
                return second >= 64 && second <= 127;
            } catch (Exception ignored) {
                return false;
            }
        }
        return false;
    }

    static String currentNetworkLabel(Context context) {
        if (!hasWifiPermission(context)) return "Permesso posizione non concesso";
        if (isOnVpn(context)) return "VPN attiva";
        if (!isOnWifi(context)) return "Nessun Wi-Fi connesso";
        String ssid = currentSsid(context);
        if (ssid.isEmpty()) return "Wi-Fi connesso · SSID non disponibile (attiva la posizione)";
        return isCurrentWifiTrusted(context) ? ssid + " · rete fidata" : ssid + " · rete NON fidata";
    }

    static boolean hasLocationPrompted(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_LOCATION_PROMPTED, false);
    }

    static void markLocationPrompted(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_LOCATION_PROMPTED, true).apply();
    }

    private static String hostFromUrl(String baseUrl) {
        try {
            String value = String.valueOf(baseUrl == null ? "" : baseUrl).trim();
            if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://" + value;
            String host = URI.create(value).getHost();
            return host == null ? "" : host.toLowerCase();
        } catch (Exception ignored) {
            return "";
        }
    }
}
