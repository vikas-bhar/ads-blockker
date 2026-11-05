package org.shieldad.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.shieldad.ShieldAdApplication

class UpdateBlocklistWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = try {
        (applicationContext as ShieldAdApplication).blocklists.updateBlocklists()
        Result.success()
    } catch (_: Exception) {
        if (runAttemptCount < 3) Result.retry() else Result.failure()
    }
}
