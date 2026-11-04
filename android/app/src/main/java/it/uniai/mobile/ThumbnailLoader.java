package it.uniai.mobile;

import android.content.ContentResolver;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.widget.ImageView;

import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class ThumbnailLoader {
    private static final ExecutorService EXECUTOR = Executors.newFixedThreadPool(2, runnable -> {
        Thread thread = new Thread(runnable, "uniai-thumbnail");
        thread.setDaemon(true);
        return thread;
    });

    private ThumbnailLoader() {
    }

    static void load(Context context, Uri uri, int targetPx, ImageView view) {
        if (uri == null || view == null) return;
        final String tag = uri.toString();
        view.setTag(tag);
        view.setImageDrawable(null);
        final ContentResolver resolver = context.getContentResolver();
        final int target = Math.max(48, targetPx);
        EXECUTOR.execute(() -> {
            Bitmap bitmap = null;
            try {
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                try (InputStream input = resolver.openInputStream(uri)) {
                    if (input != null) BitmapFactory.decodeStream(input, null, bounds);
                }
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return;

                int sample = 1;
                while (Math.max(bounds.outWidth / sample, bounds.outHeight / sample) > target * 2) {
                    sample *= 2;
                }
                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inSampleSize = sample;
                options.inPreferredConfig = Bitmap.Config.RGB_565;
                try (InputStream input = resolver.openInputStream(uri)) {
                    if (input != null) bitmap = BitmapFactory.decodeStream(input, null, options);
                }
                if (bitmap == null) return;

                int orientation = ExifInterface.ORIENTATION_NORMAL;
                try (InputStream input = resolver.openInputStream(uri)) {
                    if (input != null) {
                        orientation = new ExifInterface(input)
                            .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                    }
                } catch (Exception ignored) {
                }
                bitmap = orient(bitmap, orientation);
                final Bitmap result = bitmap;
                view.post(() -> {
                    if (tag.equals(view.getTag())) view.setImageBitmap(result);
                });
            } catch (Exception ignored) {
                if (bitmap != null) bitmap.recycle();
            }
        });
    }

    private static Bitmap orient(Bitmap bitmap, int orientation) {
        Matrix matrix = new Matrix();
        switch (orientation) {
            case ExifInterface.ORIENTATION_ROTATE_90: matrix.postRotate(90); break;
            case ExifInterface.ORIENTATION_ROTATE_180: matrix.postRotate(180); break;
            case ExifInterface.ORIENTATION_ROTATE_270: matrix.postRotate(270); break;
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: matrix.postScale(-1f, 1f); break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL: matrix.postScale(1f, -1f); break;
            default: return bitmap;
        }
        Bitmap rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
        if (rotated != bitmap) bitmap.recycle();
        return rotated;
    }
}
