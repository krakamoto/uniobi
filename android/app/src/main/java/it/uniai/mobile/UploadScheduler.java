package it.uniai.mobile;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;

final class UploadScheduler {
    private static final int JOB_ID = 4101;

    private UploadScheduler() {
    }

    static void schedule(Context context) {
        JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null) return;
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, UploadJobService.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .setBackoffCriteria(5_000, JobInfo.BACKOFF_POLICY_LINEAR)
            .setMinimumLatency(0)
            .setOverrideDeadline(0)
            .build();
        scheduler.schedule(job);
    }

    static void cancel(Context context) {
        JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler != null) scheduler.cancel(JOB_ID);
    }
}
