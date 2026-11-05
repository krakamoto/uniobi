package it.uniai.mobile;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

final class PreparedImage {
    final File file;
    final String fileName;
    final String mimeType;

    PreparedImage(File file, String fileName, String mimeType) {
        this.file = file;
        this.fileName = fileName;
        this.mimeType = mimeType;
    }
}

final class ImagePreparer {
    private static final int MAX_DIMENSION = 2200;
    private static final int JPEG_QUALITY = 86;

    static List<PreparedImage> prepare(Context context, List<Uri> uris, String queueId) throws IOException {
        File outputDir = new File(new File(context.getFilesDir(), "outbox"), queueId);
        if (!outputDir.exists() && !outputDir.mkdirs()) throw new IOException("Impossibile creare la coda locale.");
        List<PreparedImage> result = new ArrayList<>();
        ContentResolver resolver = context.getContentResolver();

        for (int index = 0; index < uris.size(); index += 1) {
            Uri uri = uris.get(index);
            String originalName = displayName(resolver, uri);
            String mime = resolver.getType(uri);
            if (isPdf(mime, originalName)) {
                String base = baseName(originalName, "documento", index);
                File output = new File(outputDir, String.format(java.util.Locale.ITALY, "%03d-%s.pdf", index + 1, base));
                try (InputStream input = resolver.openInputStream(uri); FileOutputStream stream = new FileOutputStream(output)) {
                    if (input == null) throw new IOException("PDF non leggibile.");
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = input.read(buffer)) != -1) stream.write(buffer, 0, read);
                }
                result.add(new PreparedImage(output, output.getName(), "application/pdf"));
                continue;
            }

            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            String base = baseName(originalName, "foto", index);
            String outputName = String.format(java.util.Locale.ITALY, "%03d-%s.jpg", index + 1, base);
            File output = new File(outputDir, outputName);
            try (InputStream input = resolver.openInputStream(uri)) {
                if (input == null) throw new IOException("Immagine non leggibile.");
                BitmapFactory.decodeStream(input, null, bounds);
            }
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("Formato immagine non supportato.");

            int sampleSize = 1;
            while (Math.max(bounds.outWidth, bounds.outHeight) / sampleSize > MAX_DIMENSION * 2) sampleSize *= 2;
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = sampleSize;
            Bitmap bitmap;
            try (InputStream input = resolver.openInputStream(uri)) {
                bitmap = BitmapFactory.decodeStream(input, null, options);
            }
            if (bitmap == null) throw new IOException("Impossibile decodificare l'immagine.");

            int orientation = ExifInterface.ORIENTATION_NORMAL;
            try (InputStream input = resolver.openInputStream(uri)) {
                if (input != null) orientation = new ExifInterface(input).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            } catch (Exception ignored) {
            }
            bitmap = orient(bitmap, orientation);
            bitmap = resizeIfNeeded(bitmap, MAX_DIMENSION);

            try (FileOutputStream stream = new FileOutputStream(output)) {
                if (!bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, stream)) {
                    throw new IOException("Compressione immagine fallita.");
                }
            } finally {
                bitmap.recycle();
            }
            result.add(new PreparedImage(output, output.getName(), "image/jpeg"));
        }
        return result;
    }

    private static Bitmap orient(Bitmap bitmap, int orientation) {
        Matrix matrix = new Matrix();
        switch (orientation) {
            case ExifInterface.ORIENTATION_ROTATE_90: matrix.postRotate(90); break;
            case ExifInterface.ORIENTATION_ROTATE_180: matrix.postRotate(180); break;
            case ExifInterface.ORIENTATION_ROTATE_270: matrix.postRotate(270); break;
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: matrix.postScale(-1f, 1f); break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL: matrix.postScale(1f, -1f); break;
            case ExifInterface.ORIENTATION_TRANSPOSE:
                matrix.postRotate(90); matrix.postScale(-1f, 1f); break;
            case ExifInterface.ORIENTATION_TRANSVERSE:
                matrix.postRotate(270); matrix.postScale(-1f, 1f); break;
            default: return bitmap;
        }
        Bitmap rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
        if (rotated != bitmap) bitmap.recycle();
        return rotated;
    }

    private static Bitmap resizeIfNeeded(Bitmap bitmap, int maxDimension) {
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int largest = Math.max(width, height);
        if (largest <= maxDimension) return bitmap;
        float scale = (float) maxDimension / largest;
        Bitmap resized = Bitmap.createScaledBitmap(bitmap, Math.round(width * scale), Math.round(height * scale), true);
        if (resized != bitmap) bitmap.recycle();
        return resized;
    }

    private static boolean isPdf(String mime, String name) {
        return "application/pdf".equalsIgnoreCase(mime) || (name != null && name.toLowerCase(java.util.Locale.ITALY).endsWith(".pdf"));
    }

    private static String baseName(String originalName, String fallback, int index) {
        String base = originalName == null ? "" : originalName.replaceFirst("\\.[A-Za-z0-9]+$", "").replaceAll("[^A-Za-z0-9_-]", "-");
        if (base.isEmpty()) base = fallback + "-" + (index + 1);
        return base;
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
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
        String fallback = uri.getLastPathSegment();
        return fallback == null || fallback.isEmpty() ? "foto.jpg" : fallback;
    }
}
