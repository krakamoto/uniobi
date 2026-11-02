package it.uniai.mobile;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.LinkProperties;
import android.net.NetworkCapabilities;
import android.net.RouteInfo;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;

import org.json.JSONArray;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class TrustedNetworkManager {
    private static final String PREFS = "uniai";
    private static final String KEY_TRUSTED_SSIDS = "trusted_wifi_ssids";
    private static final String KEY_TRUSTED_FINGERPRINTS = "trusted_wifi_fingerprints";
    private static final String KEY_COMPATIBILITY_MODE = "network_compatibility_mode";
    private static final String KEY_LOCATION_PROMPTED = "wifi_location_prompted";

    private TrustedNetworkManager() {
    }

    static boolean hasFineLocationPermission(Context context) {
        return context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean hasNearbyWifiPermission(Context context) {
        if (Build.VERSION.SDK_INT < 33) return true;
        return context.checkSelfPermission("android.permission.NEARBY_WIFI_DEVICES") == PackageManager.PERMISSION_GRANTED;
    }

    static boolean hasLocalNetworkPermission(Context context) {
        if (Build.VERSION.SDK_INT < 37) return true;
        return context.checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK") == PackageManager.PERMISSION_GRANTED;
    }

    static boolean hasWifiPermission(Context context) {
        return hasFineLocationPermission(context) && hasNearbyWifiPermission(context);
    }

    static boolean isLocationEnabled(Context context) {
        try {
            LocationManager manager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
            if (manager == null) return false;
            if (Build.VERSION.SDK_INT >= 28) return manager.isLocationEnabled();
            return manager.isProviderEnabled(LocationManager.GPS_PROVIDER) || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Exception ignored) {
            return false;
        }
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

    static void trustCurrentNetwork(Context context) {
        String ssid = currentSsid(context);
        String fingerprint = currentNetworkFingerprint(context);
        if (!ssid.isEmpty()) addTrustedSsid(context, ssid);
        if (!fingerprint.isEmpty()) addTrustedFingerprint(context, fingerprint);
    }

    static void forgetCurrentNetwork(Context context) {
        String ssid = currentSsid(context);
        String fingerprint = currentNetworkFingerprint(context);
        if (!ssid.isEmpty()) removeTrustedSsid(context, ssid);
        if (!fingerprint.isEmpty()) removeTrustedFingerprint(context, fingerprint);
    }

    private static void save(Context context, List<String> values) {
        JSONArray array = new JSONArray();
        for (String value : values) array.put(value);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_TRUSTED_SSIDS, array.toString())
            .apply();
    }

    static String currentNetworkFingerprint(Context context) {
        try {
            ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return "";
            Network network = cm.getActiveNetwork();
            if (network == null) return "";
            NetworkCapabilities caps = cm.getNetworkCapabilities(network);
            if (caps == null || !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "";
            LinkProperties properties = cm.getLinkProperties(network);
            if (properties == null) return "";
            StringBuilder raw = new StringBuilder("wifi");
            raw.append('|').append(properties.getInterfaceName() == null ? "" : properties.getInterfaceName());
            for (RouteInfo route : properties.getRoutes()) {
                if (route.isDefaultRoute() && route.getGateway() != null) {
                    raw.append("|gw:").append(route.getGateway().getHostAddress());
                }
            }
            ArrayList<String> dns = new ArrayList<>();
            for (java.net.InetAddress address : properties.getDnsServers()) dns.add(address.getHostAddress());
            Collections.sort(dns);
            raw.append("|dns:").append(String.join(",", dns));
            if (Build.VERSION.SDK_INT >= 30 && properties.getDhcpServerAddress() != null) {
                raw.append("|dhcp:").append(properties.getDhcpServerAddress().getHostAddress());
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(raw.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (int i = 0; i < 8; i += 1) hex.append(String.format("%02x", hash[i]));
            return hex.toString();
        } catch (Exception ignored) {
            return "";
        }
    }

    static List<String> trustedFingerprints(Context context) {
        List<String> result = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_TRUSTED_FINGERPRINTS, "[]"));
            for (int i = 0; i < array.length(); i += 1) {
                String value = array.optString(i, "").trim();
                if (!value.isEmpty() && !result.contains(value)) result.add(value);
            }
        } catch (Exception ignored) {
        }
        return result;
    }

    private static void saveFingerprints(Context context, List<String> values) {
        JSONArray array = new JSONArray();
        for (String value : values) array.put(value);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_TRUSTED_FINGERPRINTS, array.toString()).apply();
    }

    static void addTrustedFingerprint(Context context, String fingerprint) {
        String clean = fingerprint == null ? "" : fingerprint.trim();
        if (clean.isEmpty()) return;
        List<String> values = trustedFingerprints(context);
        if (!values.contains(clean)) values.add(clean);
        saveFingerprints(context, values);
    }

    static void removeTrustedFingerprint(Context context, String fingerprint) {
        List<String> values = trustedFingerprints(context);
        values.remove(fingerprint);
        saveFingerprints(context, values);
    }

    static boolean isCurrentFingerprintTrusted(Context context) {
        String fingerprint = currentNetworkFingerprint(context);
        return !fingerprint.isEmpty() && trustedFingerprints(context).contains(fingerprint);
    }

    static boolean isCurrentNetworkTrusted(Context context) {
        return isCurrentWifiTrusted(context) || isCurrentFingerprintTrusted(context);
    }

    static String shortFingerprint(String fingerprint) {
        if (fingerprint == null || fingerprint.length() <= 8) return fingerprint == null ? "" : fingerprint;
        return fingerprint.substring(0, 8).toUpperCase();
    }

    static boolean isCurrentWifiTrusted(Context context) {
        String ssid = currentSsid(context);
        return !ssid.isEmpty() && trustedSsids(context).contains(ssid);
    }

    static boolean isCompatibilityMode(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_COMPATIBILITY_MODE, false);
    }

    static void setCompatibilityMode(Context context, boolean enabled) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_COMPATIBILITY_MODE, enabled).apply();
    }

    static boolean canContactServer(Context context, String baseUrl) {
        String host = hostFromUrl(baseUrl);
        if (!hasLocalNetworkPermission(context)) return false;
        if (host.equals("10.0.2.2") || host.equals("127.0.0.1") || host.equals("localhost")) return true;
        if (!isHttps(baseUrl) && !isPrivateHost(host)) return false;
        if (isCompatibilityMode(context) && isOnWifi(context)) return true;
        if (isOnVpn(context)) return true;
        return isCurrentNetworkTrusted(context);
    }

    static String connectionBlockReason(Context context, String baseUrl) {
        String host = hostFromUrl(baseUrl);
        if (!hasLocalNetworkPermission(context)) return "Concedi il permesso Rete locale (Android 17+).";
        if (host.equals("10.0.2.2") || host.equals("127.0.0.1") || host.equals("localhost")) return "";
        if (!isHttps(baseUrl) && !isPrivateHost(host)) {
            return "HTTP è consentito solo verso server locali. Configura HTTPS o usa una VPN.";
        }
        if (isCompatibilityMode(context) && isOnWifi(context)) return "";
        if (isOnVpn(context)) return "";
        if (!hasFineLocationPermission(context)) return "Concedi il permesso di posizione precisa.";
        if (!hasNearbyWifiPermission(context)) return "Concedi il permesso Dispositivi Wi-Fi vicini (Android 13+).";
        if (!isLocationEnabled(context)) return "La posizione di sistema è disattivata: attivala nelle impostazioni Android.";
        if (!isOnWifi(context)) return "Nessun Wi-Fi connesso. Il server non verrà contattato.";
        if (isCurrentNetworkTrusted(context)) return "";
        String ssid = currentSsid(context);
        if (ssid.isEmpty()) {
            String fingerprint = currentNetworkFingerprint(context);
            if (fingerprint.isEmpty()) return "Android non espone l'SSID e la rete non è identificabile.";
            return "SSID non disponibile: autorizza l'impronta della rete corrente.";
        }
        return "La rete Wi-Fi attuale non è autorizzata.";
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
        if (!ssid.isEmpty()) {
            return isCurrentNetworkTrusted(context) ? ssid + " · rete fidata" : ssid + " · rete NON fidata";
        }
        String fingerprint = currentNetworkFingerprint(context);
        if (fingerprint.isEmpty()) return "Wi-Fi connesso · rete non identificabile";
        return "Wi-Fi connesso · SSID non disponibile · impronta " + shortFingerprint(fingerprint)
            + (isCurrentFingerprintTrusted(context) ? " · rete fidata" : " · rete NON fidata");
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
